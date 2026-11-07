import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { TrackList } from './components/TrackList';
import { CoachingHUD } from './components/CoachingHUD';
import { HarmonyPanel } from './components/HarmonyPanel';
import { VisualizerCanvas } from './components/VisualizerCanvas';
import { TimelineScrollbar } from './components/TimelineScrollbar';

import { MultiTrackMixer, AudioTrackState, DEFAULT_TRACK_COLORS } from './audio/MultiTrackMixer';
import { PitchFrame, PraatPitchEngine } from './audio/PraatPitchEngine';
import { BatchPitchExtractor, PITCH_ANALYSIS_VERSION } from './audio/BatchPitchExtractor';
import { PitchComparator, CoachingFeedback } from './audio/PitchComparator';
import { 
  MusicalHarmonyEngine, 
  MusicalMode, 
  HarmonyPreset, 
  STANDARD_HARMONY_PRESETS,
  DetectedKeyResult 
} from './audio/MusicalHarmonyEngine';
import { ThemeId, THEMES, NoteLabelMode } from './visualizer/ThemeManager';
import { db } from './storage/db';

// Timeline viewport limits
const BASE_VISIBLE = 8.0;  // Seconds visible at zoom 1.0
const MIN_VISIBLE = 1.0;   // Most zoomed-in: 1 second across the screen

/** Clamps a viewport so it stays inside the song. With no audio loaded, only the start is clamped. */
function clampView(offset: number, visible: number, duration: number) {
  const maxVisible = Math.max(BASE_VISIBLE, duration);
  const v = Math.max(MIN_VISIBLE, Math.min(maxVisible, visible));
  const maxOffset = duration > 0 ? Math.max(0, duration - v) : Number.POSITIVE_INFINITY;
  const o = Math.max(0, Math.min(maxOffset, offset));
  return { offset: o, visible: v };
}

export function App() {
  // Mixer & Audio Engine instances
  const mixerRef = useRef<MultiTrackMixer | null>(null);
  const comparatorRef = useRef<PitchComparator>(new PitchComparator());
  const harmonyEngineRef = useRef<MusicalHarmonyEngine>(new MusicalHarmonyEngine(0, 'major'));

  // 6 Track States
  const [tracks, setTracks] = useState<AudioTrackState[]>(() =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `track-${i}`,
      index: i,
      name: `Track ${i + 1}`,
      audioBuffer: null,
      pitchFrames: [],
      volume: 0.85,
      muted: false,
      solo: false,
      color: DEFAULT_TRACK_COLORS[i],
      isMain: i === 0, // Default track 1 as main
      isAnalyzing: false,
      analysisProgress: 0,
      duration: 0
    }))
  );

  // Playback & Timeline State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Visible window of the song diagram: start time and length in seconds
  const [view, setView] = useState({ offset: 0, visible: BASE_VISIBLE });
  const [autoFollow, setAutoFollow] = useState(true);
  const timeOffset = view.offset;
  const visibleDuration = view.visible;
  const zoom = BASE_VISIBLE / view.visible;

  // Refs for callbacks registered once (playback tick, keyboard)
  const viewRef = useRef(view);
  viewRef.current = view;
  const autoFollowRef = useRef(autoFollow);
  autoFollowRef.current = autoFollow;
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;

  // Microphone & Real-time Pitch State
  const [isMicActive, setIsMicActive] = useState(false);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default');
  const [micHistory, setMicHistory] = useState<PitchFrame[]>([]);
  const [latestMicFrame, setLatestMicFrame] = useState<PitchFrame | null>(null);

  // Filter & Vocal Preset for Full-Band / Chords
  const [enableBandpass, setEnableBandpass] = useState(true);
  const [vocalPreset, setVocalPreset] = useState<'all' | 'male' | 'female' | 'soprano' | 'custom'>('all');

  // Themes & Note Display Mode
  const [theme, setTheme] = useState<ThemeId>('dark_studio');
  const [noteLabelMode, setNoteLabelMode] = useState<NoteLabelMode>('cs_only');
  const [enharmonic, setEnharmonic] = useState<'sharp' | 'flat'>('sharp');

  // Harmony & Interval State
  const [activeHarmonyPreset, setActiveHarmonyPreset] = useState<HarmonyPreset>(STANDARD_HARMONY_PRESETS[2]); // Diatonic 3rd
  const [rootIndex, setRootIndex] = useState(0); // 0 = C
  const [activeMode, setActiveMode] = useState<MusicalMode>('major');
  const [customSemitones, setCustomSemitones] = useState(0);
  const [detectedKey, setDetectedKey] = useState<DetectedKeyResult | null>(null);

  // Pitch Coaching Feedback
  const [coachingFeedback, setCoachingFeedback] = useState<CoachingFeedback>({
    status: 'idle',
    centsDiff: 0,
    suggestion: 'Sing into the microphone to begin tuning',
    targetNote: '—',
    micNote: '—',
    inTunePercentage: 100,
    targetHz: 0,
    micHz: 0
  });

  // Initialize MultiTrackMixer
  useEffect(() => {
    const mixer = new MultiTrackMixer();
    mixerRef.current = mixer;

    // Load available audio input devices
    MultiTrackMixer.getAvailableInputDevices().then(devices => {
      setInputDevices(devices);
      if (devices.length > 0) {
        setSelectedDeviceId(devices[0].deviceId);
      }
    });

    // Playback time tick
    mixer.onPlaybackTick = (time) => {
      setCurrentTime(time);
      if (!autoFollowRef.current) return;
      // Page the viewport forward when the playhead nears the right edge (or left the view)
      const { offset, visible } = viewRef.current;
      if (time > offset + visible * 0.85 || time < offset) {
        setView(clampView(time - visible * 0.1, visible, durationRef.current));
      }
    };

    mixer.onPlaybackEnded = () => {
      setIsPlaying(false);
    };

    // Load persisted tracks from IndexedDB
    for (let i = 0; i < 6; i++) {
      db.getTrack(i).then(async (stored) => {
        if (stored && mixerRef.current) {
          try {
            const buffer = await mixerRef.current.decodeAudioFile(stored.track.audioBlob as File);
            let frames = stored.frames;
            if (stored.track.analysisVersion !== PITCH_ANALYSIS_VERSION) {
              // Stored with an older pitch algorithm: re-analyze and update the cache
              setTracks(prev => prev.map(t => t.index === i ? { ...t, isAnalyzing: true, analysisProgress: 0, name: stored.track.name } : t));
              frames = await BatchPitchExtractor.extractPitchFromAudioBuffer(buffer, {
                onProgress: (p) => {
                  setTracks(prev => prev.map(t => t.index === i ? { ...t, analysisProgress: p.percent } : t));
                }
              });
              await db.saveTrack(i, stored.track.name, stored.track.audioBlob, frames, stored.track.color, stored.track.volume, PITCH_ANALYSIS_VERSION);
            }
            const keyResult = MusicalHarmonyEngine.detectKeyAndMode(frames);
            if (keyResult && keyResult.confidence > 0.45) {
              setDetectedKey(prev => prev ?? keyResult);
            }
            setTracks(prev => prev.map(t => {
              if (t.index === i) {
                return {
                  ...t,
                  name: stored.track.name.replace(/\.[^/.]+$/, ''),
                  audioBuffer: buffer,
                  pitchFrames: frames,
                  isAnalyzing: false,
                  analysisProgress: 100,
                  color: stored.track.color || t.color,
                  volume: stored.track.volume || t.volume,
                  duration: buffer.duration
                };
              }
              return t;
            }));
          } catch (e) {
            console.error('Failed restoring track from IndexedDB:', e);
            setTracks(prev => prev.map(t => t.index === i ? { ...t, isAnalyzing: false } : t));
          }
        }
      });
    }

    return () => {
      mixer.stopAll();
      mixer.stopMicrophone();
    };
  }, []);

  // Update Gain Matrix whenever tracks change
  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.initTrackChannels(6);
      mixerRef.current.updateGainMatrix(tracks);
    }
  }, [tracks]);

  // Compute maximum audio duration
  const maxDuration = useMemo(() => {
    return Math.max(0, ...tracks.map(t => t.duration));
  }, [tracks]);
  durationRef.current = maxDuration;

  // Re-clamp the viewport when the song length changes (track loaded / cleared)
  useEffect(() => {
    setView(v => clampView(v.offset, v.visible, maxDuration));
  }, [maxDuration]);

  // ---- Timeline viewport (scroll & zoom) ----
  const scrollTo = useCallback((offset: number) => {
    setView(v => clampView(offset, v.visible, durationRef.current));
    if (mixerRef.current?.isPlaying) setAutoFollow(false);
  }, []);

  const scrollBy = useCallback((deltaSeconds: number) => {
    setView(v => clampView(v.offset + deltaSeconds, v.visible, durationRef.current));
    if (mixerRef.current?.isPlaying) setAutoFollow(false);
  }, []);

  const setViewWindow = useCallback((offset: number, visible: number) => {
    setView(clampView(offset, visible, durationRef.current));
  }, []);

  /** Zoom by `factor` (>1 = in) keeping `anchorTime` fixed on screen. */
  const zoomAt = useCallback((factor: number, anchorTime?: number) => {
    setView(v => {
      const anchor = anchorTime ?? v.offset + v.visible / 2;
      const fraction = Math.max(0, Math.min(1, (anchor - v.offset) / v.visible));
      const newVisible = clampView(0, v.visible / factor, durationRef.current).visible;
      return clampView(anchor - fraction * newVisible, newVisible, durationRef.current);
    });
  }, []);

  // Zoom buttons keep the playhead in place when it is on screen, otherwise the view centre
  const zoomButton = useCallback((factor: number) => {
    const v = viewRef.current;
    const t = currentTimeRef.current;
    zoomAt(factor, t >= v.offset && t <= v.offset + v.visible ? t : undefined);
  }, [zoomAt]);

  const fitSong = useCallback(() => {
    setView(clampView(0, Math.max(durationRef.current, BASE_VISIBLE), durationRef.current));
  }, []);

  // Keyboard shortcuts: +/- zoom, 0 fit, arrows scroll, Home/End, F follow, Space play/pause
  const playPauseRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const v = viewRef.current;
      switch (e.key) {
        case '+':
        case '=':
          zoomButton(1.25);
          break;
        case '-':
        case '_':
          zoomButton(1 / 1.25);
          break;
        case '0':
          fitSong();
          break;
        case 'ArrowRight':
          scrollBy(v.visible * (e.shiftKey ? 0.5 : 0.1));
          break;
        case 'ArrowLeft':
          scrollBy(-v.visible * (e.shiftKey ? 0.5 : 0.1));
          break;
        case 'Home':
          scrollTo(0);
          break;
        case 'End':
          scrollTo(durationRef.current);
          break;
        case 'f':
        case 'F':
          setAutoFollow(a => !a);
          break;
        case ' ':
          if (target && target.tagName === 'BUTTON') return; // let the focused button handle it
          playPauseRef.current();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomButton, fitSong, scrollBy, scrollTo]);

  // Current Main reference track
  const mainTrack = useMemo(() => {
    return tracks.find(t => t.isMain && t.audioBuffer) || null;
  }, [tracks]);

  // Compute current target pitch at currentTime
  const currentTargetPitch = useMemo(() => {
    if (!mainTrack || mainTrack.pitchFrames.length === 0) {
      return { targetMidi: 0, targetHz: 0, targetNoteName: '—' };
    }

    // Binary search for frame at currentTime
    const frames = mainTrack.pitchFrames;
    let low = 0;
    let high = frames.length - 1;
    let bestIdx = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (frames[mid].timestamp < currentTime) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const frame = frames[bestIdx];
    if (!frame || !frame.voiced || frame.frequency <= 0) {
      return { targetMidi: 0, targetHz: 0, targetNoteName: '—' };
    }

    // Apply Diatonic / Chromatic interval transform from HarmonyEngine
    const harmonized = harmonyEngineRef.current.computeTargetPitch(frame.exactMidi, frame.frequency);
    const targetNoteInfo = PraatPitchEngine.frequencyToNote(harmonized.targetHz, enharmonic);

    return {
      targetMidi: harmonized.targetMidi,
      targetHz: harmonized.targetHz,
      targetNoteName: targetNoteInfo.noteName
    };
  }, [mainTrack, currentTime, enharmonic, activeHarmonyPreset, rootIndex, activeMode, customSemitones]);

  // Handle incoming microphone frame
  const handleMicFrame = useCallback((frame: PitchFrame) => {
    setLatestMicFrame(frame);

    // Keep rolling 12 seconds in mic history
    setMicHistory(prev => {
      const updated = [...prev, frame];
      const cutoff = frame.timestamp - 12.0;
      return updated.filter(f => f.timestamp >= cutoff);
    });

    // Run real-time comparison against current target pitch
    const comparison = comparatorRef.current.compare(
      frame,
      currentTargetPitch.targetMidi,
      currentTargetPitch.targetHz,
      currentTargetPitch.targetNoteName
    );
    setCoachingFeedback(comparison);
  }, [currentTargetPitch]);

  // Toggle Microphone
  const handleToggleMic = async () => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    if (isMicActive) {
      mixer.stopMicrophone();
      setIsMicActive(false);
      comparatorRef.current.resetScore();
    } else {
      mixer.onMicFrame = handleMicFrame;
      const success = await mixer.startMicrophone(selectedDeviceId);
      setIsMicActive(success);
    }
  };

  // Play / Pause transport
  const handlePlayPause = () => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    if (isPlaying) {
      mixer.pauseAll();
      setIsPlaying(false);
    } else {
      mixer.playAll(tracks, currentTime);
      setIsPlaying(true);
      setAutoFollow(true);
    }
  };
  playPauseRef.current = handlePlayPause;

  // Stop transport
  const handleStop = () => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.stopAll();
    setIsPlaying(false);
    setCurrentTime(0);
    setView(v => clampView(0, v.visible, durationRef.current));
  };

  // Seek timeline
  const handleSeek = (seekTime: number) => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    setCurrentTime(seekTime);
    if (isPlaying) {
      mixer.playAll(tracks, seekTime);
    }
  };

  // File Upload & Batch Pitch Extraction
  const handleUploadFile = async (index: number, file: File) => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    // Set analyzing state
    setTracks(prev => prev.map(t => t.index === index ? { ...t, isAnalyzing: true, analysisProgress: 0, name: file.name } : t));

    try {
      const audioBuffer = await mixer.decodeAudioFile(file);

      // Run Praat batch pitch extraction with Dominant Tone filtering
      const pitchFrames = await BatchPitchExtractor.extractPitchFromAudioBuffer(audioBuffer, {
        enableBandpass,
        vocalPreset,
        onProgress: (p) => {
          setTracks(prev => prev.map(t => t.index === index ? { ...t, analysisProgress: p.percent } : t));
        }
      });

      // Update track state
      setTracks(prev => prev.map(t => {
        if (t.index === index) {
          return {
            ...t,
            name: file.name.replace(/\.[^/.]+$/, ''),
            audioBuffer,
            pitchFrames,
            isAnalyzing: false,
            analysisProgress: 100,
            duration: audioBuffer.duration
          };
        }
        return t;
      }));

      // Automatically run Key & Mode detection if this is track 1 or main track
      const keyResult = MusicalHarmonyEngine.detectKeyAndMode(pitchFrames);
      if (keyResult && keyResult.confidence > 0.45) {
        setDetectedKey(keyResult);
      }

      // Persist to IndexedDB
      const currentTrack = tracks[index];
      await db.saveTrack(
        index,
        file.name,
        file,
        pitchFrames,
        currentTrack.color,
        currentTrack.volume,
        PITCH_ANALYSIS_VERSION
      );
    } catch (err) {
      console.error('Failed to process audio file:', err);
      alert('Could not decode or analyze audio file. Please check audio format (MP3, WAV, AAC, FLAC supported).');
      setTracks(prev => prev.map(t => t.index === index ? { ...t, isAnalyzing: false } : t));
    }
  };

  // Track Solo / Mute / Volume / Color / Main
  const handleToggleMute = (index: number) => {
    setTracks(prev => prev.map(t => t.index === index ? { ...t, muted: !t.muted } : t));
  };

  const handleToggleSolo = (index: number) => {
    setTracks(prev => prev.map(t => t.index === index ? { ...t, solo: !t.solo } : t));
  };

  const handleChangeVolume = (index: number, vol: number) => {
    setTracks(prev => prev.map(t => t.index === index ? { ...t, volume: vol } : t));
  };

  const handleChangeColor = (index: number, color: string) => {
    setTracks(prev => prev.map(t => t.index === index ? { ...t, color } : t));
  };

  const handleSetMainTrack = (index: number) => {
    setTracks(prev => prev.map(t => ({ ...t, isMain: t.index === index })));
    comparatorRef.current.resetScore();
  };

  const handleClearTrack = async (index: number) => {
    setTracks(prev => prev.map(t => {
      if (t.index === index) {
        return {
          ...t,
          name: `Track ${index + 1}`,
          audioBuffer: null,
          pitchFrames: [],
          duration: 0
        };
      }
      return t;
    }));
    await db.clearTrack(index);
  };

  // Apply Detected Key
  const handleApplyDetectedKey = () => {
    if (detectedKey) {
      setRootIndex(detectedKey.rootIndex);
      setActiveMode(detectedKey.mode);
      harmonyEngineRef.current.rootIndex = detectedKey.rootIndex;
      harmonyEngineRef.current.activeMode = detectedKey.mode;
    }
  };

  // Preset demo sound generator for immediate zero-upload testing
  const handleLoadDemo = async () => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    const ctx = mixer.getAudioContext();
    const sampleRate = ctx.sampleRate;
    const duration = 6.0;
    const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);

    // Synthesize a pleasant vocal-like harmonic melody: C4 -> E4 -> G4 -> A4 -> G4
    const notes = [
      { midi: 60, dur: 1.2 }, // C4
      { midi: 64, dur: 1.2 }, // E4
      { midi: 67, dur: 1.2 }, // G4
      { midi: 69, dur: 1.2 }, // A4
      { midi: 67, dur: 1.2 }  // G4
    ];

    let offset = 0;
    for (const note of notes) {
      const freq = PraatPitchEngine.midiToFrequency(note.midi);
      const samples = Math.floor(note.dur * sampleRate);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        // Vocal timbre: Fundamental + 2nd & 3rd harmonics + gentle vibrato
        const vibrato = 1.0 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t);
        const f = freq * vibrato;
        const wave = 0.5 * Math.sin(2 * Math.PI * f * t) +
                     0.25 * Math.sin(4 * Math.PI * f * t) +
                     0.12 * Math.sin(6 * Math.PI * f * t);
        // Envelope: attack & release
        const env = Math.min(1.0, i / 800) * Math.min(1.0, (samples - i) / 800);
        data[offset + i] = wave * env * 0.4;
      }
      offset += samples;
    }

    // Extract pitch directly
    const frames = await BatchPitchExtractor.extractPitchFromAudioBuffer(buffer);

    setTracks(prev => prev.map(t => {
      if (t.index === 0) {
        return {
          ...t,
          name: 'Demo Reference Melody',
          audioBuffer: buffer,
          pitchFrames: frames,
          duration,
          isMain: true
        };
      }
      return t;
    }));

    setDetectedKey({
      rootIndex: 0,
      rootName: 'C',
      mode: 'major',
      confidence: 0.98,
      fullKeyName: 'C Major'
    });
  };

  // Note range on the grid: fit to the pitches of the loaded tracks (default A2..F5)
  const { minMidi, maxMidi } = useMemo(() => {
    const pitches: number[] = [];
    for (const t of tracks) {
      if (t.muted) continue;
      for (const f of t.pitchFrames) {
        if (f.voiced && f.exactMidi > 0) pitches.push(f.exactMidi);
      }
    }
    if (pitches.length < 10) return { minMidi: 45, maxMidi: 77 };
    pitches.sort((a, b) => a - b);
    let lo = Math.floor(pitches[Math.floor(pitches.length * 0.01)]) - 3;
    let hi = Math.ceil(pitches[Math.floor(pitches.length * 0.99)]) + 3;
    const MIN_SPAN = 20;
    if (hi - lo < MIN_SPAN) {
      const extra = MIN_SPAN - (hi - lo);
      lo -= Math.floor(extra / 2);
      hi += Math.ceil(extra / 2);
    }
    return { minMidi: lo, maxMidi: hi };
  }, [tracks]);

  const currentTheme = THEMES[theme];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans select-none">
      {/* Top Bar: Playback, Mic Device, Labels, Themes */}
      <TopBar
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        currentTime={currentTime}
        duration={maxDuration}
        isMicActive={isMicActive}
        onToggleMic={handleToggleMic}
        inputDevices={inputDevices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={(id) => {
          setSelectedDeviceId(id);
          if (isMicActive && mixerRef.current) {
            mixerRef.current.startMicrophone(id);
          }
        }}
        theme={theme}
        onSelectTheme={setTheme}
        noteLabelMode={noteLabelMode}
        onSelectNoteLabelMode={setNoteLabelMode}
        enharmonic={enharmonic}
        onToggleEnharmonic={() => setEnharmonic(prev => prev === 'sharp' ? 'flat' : 'sharp')}
        zoom={zoom}
        onZoomIn={() => zoomButton(1.25)}
        onZoomOut={() => zoomButton(1 / 1.25)}
        onFitSong={fitSong}
      />

      {/* Real-Time Pitch Coaching Feedback Bar */}
      <CoachingHUD
        feedback={coachingFeedback}
        hasMainTrack={!!mainTrack}
      />

      {/* Musical Harmony & Interval Settings */}
      <HarmonyPanel
        activePreset={activeHarmonyPreset}
        onSelectPreset={(p) => {
          setActiveHarmonyPreset(p);
          harmonyEngineRef.current.activePreset = p;
        }}
        rootIndex={rootIndex}
        onSelectRoot={(r) => {
          setRootIndex(r);
          harmonyEngineRef.current.rootIndex = r;
        }}
        activeMode={activeMode}
        onSelectMode={(m) => {
          setActiveMode(m);
          harmonyEngineRef.current.activeMode = m;
        }}
        customSemitones={customSemitones}
        onChangeCustomSemitones={(st) => {
          setCustomSemitones(st);
          harmonyEngineRef.current.customSemitones = st;
        }}
        detectedKey={detectedKey}
        onApplyDetectedKey={handleApplyDetectedKey}
      />

      {/* Main Pitch Visualizer Canvas (Reference UI) */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <VisualizerCanvas
          tracks={tracks}
          micHistory={micHistory}
          options={{
            theme: currentTheme,
            noteLabelMode,
            enharmonic,
            minMidi,
            maxMidi,
            visibleDuration,
            timeOffset,
            currentTime,
            targetPitchMidi: currentTargetPitch.targetMidi
          }}
          onSeek={handleSeek}
          onScrollBy={scrollBy}
          onZoomAt={zoomAt}
        />

        {/* Floating Quick Demo Button if no track loaded */}
        {!tracks.some(t => t.audioBuffer) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-slate-900/90 border border-slate-700/80 p-5 rounded-2xl shadow-2xl backdrop-blur max-w-sm text-center pointer-events-auto">
              <h3 className="font-bold text-sm text-white mb-1">Welcome to Praat Vocal Studio</h3>
              <p className="text-xs text-slate-400 mb-4">
                Enable your microphone to sing in real time, upload audio files into the 6 track slots below, or try the instant demo.
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={handleLoadDemo}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg transition active:scale-95"
                >
                  Load Demo Reference
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Song timeline: scrollbar, overview, zoom */}
      <TimelineScrollbar
        duration={maxDuration}
        currentTime={currentTime}
        timeOffset={timeOffset}
        visibleDuration={visibleDuration}
        minVisibleDuration={MIN_VISIBLE}
        tracks={tracks}
        autoFollow={autoFollow}
        onScrollTo={scrollTo}
        onSetView={setViewWindow}
        onZoomIn={() => zoomButton(1.25)}
        onZoomOut={() => zoomButton(1 / 1.25)}
        onToggleAutoFollow={() => setAutoFollow(a => !a)}
        onFitSong={fitSong}
      />

      {/* Bottom: 6 Audio Tracks Management & Filter Matrix */}
      <TrackList
        tracks={tracks}
        onUploadFile={handleUploadFile}
        onToggleMute={handleToggleMute}
        onToggleSolo={handleToggleSolo}
        onChangeVolume={handleChangeVolume}
        onChangeColor={handleChangeColor}
        onSetMainTrack={handleSetMainTrack}
        onClearTrack={handleClearTrack}
        enableBandpass={enableBandpass}
        onToggleBandpass={() => setEnableBandpass(prev => !prev)}
        vocalPreset={vocalPreset}
        onSelectVocalPreset={setVocalPreset}
      />
    </div>
  );
}
export default App;
