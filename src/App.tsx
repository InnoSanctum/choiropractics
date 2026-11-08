import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TopBar, TopBarProps } from './components/TopBar';
import { TrackList, TrackListProps } from './components/TrackList';
import { CoachingHUD, CoachingHUDProps } from './components/CoachingHUD';
import { HarmonyPanel, HarmonyPanelProps } from './components/HarmonyPanel';
import { VisualizerCanvas, VisualizerCanvasProps } from './components/VisualizerCanvas';
import { TimelineScrollbar, TimelineScrollbarProps } from './components/TimelineScrollbar';
import { PracticePanel, PracticePanelProps, CountInMode } from './components/PracticePanel';
import { TunerPanel, TunerPanelProps } from './components/TunerPanel';
import { CanvasOverlays } from './components/CanvasOverlays';
import { ReviewControls, ReviewControlsProps, MISTAKE_LEVELS } from './components/ReviewControls';
import { exportDiagram, saveFile, ExportFormat, ExportRange } from './visualizer/DiagramExport';
import { TargetNote } from './audio/MistakeDetector';
import { MobileLayout } from './components/mobile/MobileLayout';
import { useIsMobile } from './hooks/useIsMobile';

import { MultiTrackMixer, AudioTrackState, DEFAULT_TRACK_COLORS } from './audio/MultiTrackMixer';
import { PitchFrame, PraatPitchEngine } from './audio/PraatPitchEngine';
import { BatchPitchExtractor, PITCH_ANALYSIS_VERSION } from './audio/BatchPitchExtractor';
import { PitchComparator, CoachingFeedback } from './audio/PitchComparator';
import { detectTempo } from './audio/TempoDetector';
import { filterLatestFrames, OctaveStabilizer, PitchDeadband } from './audio/LivePitchFilter';
import {
  MusicalHarmonyEngine,
  MusicalMode,
  HarmonyPreset,
  STANDARD_HARMONY_PRESETS,
  DetectedKeyResult
} from './audio/MusicalHarmonyEngine';
import { ThemeId, THEMES, NoteLabelMode } from './visualizer/ThemeManager';
import { NoteGridRenderer, MicTake, HarmonyNote } from './visualizer/NoteGridRenderer';
import { db } from './storage/db';

// Timeline viewport limits
const BASE_VISIBLE = 8.0;  // Seconds visible at zoom 1.0
const MIN_VISIBLE = 1.0;   // Most zoomed-in: 1 second across the screen

// Distinct colors for successive sung takes (chosen to differ from the track colors)
const TAKE_COLORS = ['#f43f5e', '#22d3ee', '#a3e635', '#c084fc', '#f472b6', '#2dd4bf', '#e879f9', '#facc15'];
const MAX_TAKES = 12;
const MIC_ANALYSIS_DELAY = 1024 / 44100; // Half the mic analysis buffer (approx.)

/** Clamps a viewport so it stays inside the song. With no audio loaded, only the start is clamped. */
function clampView(offset: number, visible: number, duration: number) {
  const maxVisible = Math.max(BASE_VISIBLE, duration);
  const v = Math.max(MIN_VISIBLE, Math.min(maxVisible, visible));
  const maxOffset = duration > 0 ? Math.max(0, duration - v) : Number.POSITIVE_INFINITY;
  const o = Math.max(0, Math.min(maxOffset, offset));
  return { offset: o, visible: v };
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiName = (midi: number, enharmonic: 'sharp' | 'flat') =>
  `${(enharmonic === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

type AppMode = 'practice' | 'tuner';

export function App() {
  const isMobile = useIsMobile();

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
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  // App mode: practice with tracks, or free tuner
  const [appMode, setAppMode] = useState<AppMode>('practice');
  const appModeRef = useRef(appMode);
  appModeRef.current = appMode;

  // Playback & Timeline State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Visible window of the song diagram: start time and length in seconds
  const [view, setView] = useState({ offset: 0, visible: BASE_VISIBLE });
  const [autoFollow, setAutoFollow] = useState(true);
  const timeOffset = view.offset;
  const visibleDuration = view.visible;

  // Refs for callbacks registered once (playback tick, keyboard, mic)
  const viewRef = useRef(view);
  viewRef.current = view;
  const autoFollowRef = useRef(autoFollow);
  autoFollowRef.current = autoFollow;
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;

  // Playback speed (pitch preserved)
  const [speed, setSpeed] = useState(1);
  const [speedProgress, setSpeedProgress] = useState<number | null>(null);

  // Metronome & count-in
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [firstBeat, setFirstBeat] = useState(0);
  const [tempoStatus, setTempoStatus] = useState<string | null>(null);
  const [countInMode, setCountInMode] = useState<CountInMode>('off');
  const [countInCustomBeats, setCountInCustomBeats] = useState(4);
  const [countInLeft, setCountInLeft] = useState(0);
  const tapTimesRef = useRef<number[]>([]);
  const tempoTouchedRef = useRef(false); // tempo typed/tapped by the user -> no auto-detection

  // Microphone & Real-time Pitch State
  const [isMicActive, setIsMicActive] = useState(false);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default');

  // Sung takes (mutable for performance; `takesVersion` triggers re-render when the list changes)
  const takesRef = useRef<MicTake[]>([]);
  const [, setTakesVersion] = useState(0);
  const [keepTakes, setKeepTakes] = useState(true);
  const keepTakesRef = useRef(keepTakes);
  keepTakesRef.current = keepTakes;
  const takeCounterRef = useRef(0);
  const forceNewTakeRef = useRef(true);

  // Tuner
  const [tunerClockStart, setTunerClockStart] = useState<number | null>(null);
  const tunerClockStartRef = useRef<number | null>(null);
  tunerClockStartRef.current = tunerClockStart;
  const tunerTakeRef = useRef<MicTake>({ id: -1, color: '#f43f5e', frames: [] });
  const [referenceA4, setReferenceA4] = useState(440);
  const referenceA4Ref = useRef(referenceA4);
  referenceA4Ref.current = referenceA4;
  const [tunerRange, setTunerRange] = useState({ min: 48, max: 72 });
  const [tunerNote, setTunerNote] = useState<number | null>(null);

  // Filter & Vocal Preset for Full-Band / Chords
  const [enableBandpass, setEnableBandpass] = useState(true);
  const [vocalPreset, setVocalPreset] = useState<'all' | 'male' | 'female' | 'soprano' | 'custom'>('all');

  // Themes & Note Display Mode
  const [theme, setTheme] = useState<ThemeId>('dark_studio');
  const [noteLabelMode, setNoteLabelMode] = useState<NoteLabelMode>('cs_only');
  const [enharmonic, setEnharmonic] = useState<'sharp' | 'flat'>('sharp');
  const enharmonicRef = useRef(enharmonic);
  enharmonicRef.current = enharmonic;

  // Harmony & Interval State
  const [activeHarmonyPreset, setActiveHarmonyPreset] = useState<HarmonyPreset>(STANDARD_HARMONY_PRESETS[0]); // Unison
  const [rootIndex, setRootIndex] = useState(0); // 0 = C
  const [activeMode, setActiveMode] = useState<MusicalMode>('major');
  const [customSemitones, setCustomSemitones] = useState(0);
  const [detectedKey, setDetectedKey] = useState<DetectedKeyResult | null>(null);
  const keyTouchedRef = useRef(false); // user picked a key manually -> don't auto-apply detection
  // Octave-free scoring: singing the target in any octave counts (e.g. men singing a melody an octave down)
  const [anyOctave, setAnyOctave] = useState(false);
  // Pitch precision (cents): in-tune window and readout step, remembered between visits
  const [precisionCents, setPrecisionCents] = useState(() => {
    try {
      const v = Number(localStorage.getItem('choiro.precisionCents'));
      return v >= 1 && v <= 10 ? v : 10;
    } catch {
      return 10;
    }
  });
  const precisionRef = useRef(precisionCents);
  precisionRef.current = precisionCents;
  useEffect(() => {
    comparatorRef.current.toleranceCents = precisionCents;
    comparatorRef.current.resetScore();
    try { localStorage.setItem('choiro.precisionCents', String(precisionCents)); } catch { /* storage unavailable */ }
  }, [precisionCents]);
  const tunerNoteRef = useRef<number | null>(null);

  // Mistake highlighting (off by default) and its sensitivity, remembered between visits
  const [highlightMistakes, setHighlightMistakes] = useState(() => {
    try { return localStorage.getItem('choiro.highlightMistakes') === '1'; } catch { return false; }
  });
  const [mistakeCents, setMistakeCents] = useState(() => {
    try {
      const v = Number(localStorage.getItem('choiro.mistakeCents'));
      return MISTAKE_LEVELS.includes(v) ? v : 25;
    } catch {
      return 25;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('choiro.highlightMistakes', highlightMistakes ? '1' : '0');
      localStorage.setItem('choiro.mistakeCents', String(mistakeCents));
    } catch { /* storage unavailable */ }
  }, [highlightMistakes, mistakeCents]);
  const [exporting, setExporting] = useState(false);
  const anyOctaveRef = useRef(anyOctave);
  anyOctaveRef.current = anyOctave;

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

  // Keep the harmony engine in sync with the UI state
  useEffect(() => {
    const eng = harmonyEngineRef.current;
    eng.activePreset = activeHarmonyPreset;
    eng.rootIndex = rootIndex;
    eng.activeMode = activeMode;
    eng.customSemitones = customSemitones;
  }, [activeHarmonyPreset, rootIndex, activeMode, customSemitones]);

  // Auto-apply the detected key unless the user chose one manually
  useEffect(() => {
    if (detectedKey && !keyTouchedRef.current) {
      setRootIndex(detectedKey.rootIndex);
      setActiveMode(detectedKey.mode);
    }
  }, [detectedKey]);

  // Current Main reference track
  const mainTrack = useMemo(() => {
    return tracks.find(t => t.isMain && t.audioBuffer) || null;
  }, [tracks]);
  const mainTrackRef = useRef(mainTrack);
  mainTrackRef.current = mainTrack;

  /** Target pitch (reference transposed by the active interval) at a song time. */
  const getTargetAt = useCallback((time: number) => {
    const track = mainTrackRef.current;
    const none = { targetMidi: 0, targetHz: 0, targetNoteName: '—' };
    if (!track || track.pitchFrames.length === 0) return none;

    const frames = track.pitchFrames;
    let low = 0;
    let high = frames.length - 1;
    let bestIdx = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (frames[mid].timestamp <= time) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const frame = frames[bestIdx];
    if (!frame || !frame.voiced || frame.frequency <= 0 || Math.abs(frame.timestamp - time) > 0.05) return none;

    const harmonized = harmonyEngineRef.current.computeTargetPitch(frame.exactMidi, frame.frequency);
    return {
      targetMidi: harmonized.targetMidi,
      targetHz: harmonized.targetHz,
      targetNoteName: PraatPitchEngine.frequencyToNote(harmonized.targetHz, enharmonicRef.current).noteName
    };
  }, []);

  // ---- Live pitch clean-up ----
  // Each live frame list has its own octave stabilizer (flickering octave errors are held back,
  // real leaps are followed after ~185 ms).
  const takeStabRef = useRef(new OctaveStabilizer());
  const tunerStabRef = useRef(new OctaveStabilizer());
  const idleStabRef = useRef(new OctaveStabilizer());
  const idleFramesRef = useRef<PitchFrame[]>([]); // mic frames while not recording (coach display only)
  const deadbands = useRef(new WeakMap<OctaveStabilizer, PitchDeadband>());

  /** Appends a live frame, cleans it up, and returns the cleaned latest frame. */
  const appendLive = (frames: PitchFrame[], frame: PitchFrame, stab: OctaveStabilizer, maxLen: number, trim: number) => {
    frames.push(frame);
    stab.process(frames);
    filterLatestFrames(frames);
    // Pitch changes within the precision setting are not registered (flat line instead of wobble)
    let deadband = deadbands.current.get(stab);
    if (!deadband) {
      deadband = new PitchDeadband();
      deadbands.current.set(stab, deadband);
    }
    deadband.process(frames, precisionRef.current);
    const cleaned = frames[frames.length - 1];
    if (frames.length > maxLen) {
      frames.splice(0, trim);
      stab.shiftIndices(trim);
    }
    return cleaned;
  };

  // ---- Sung takes ----
  const startNewTake = useCallback(() => {
    const n = takeCounterRef.current++;
    const color = keepTakesRef.current ? TAKE_COLORS[n % TAKE_COLORS.length] : TAKE_COLORS[0];
    const kept = keepTakesRef.current ? takesRef.current : [];
    const next = [...kept, { id: n, color, frames: [] as PitchFrame[] }];
    takesRef.current = next.slice(-MAX_TAKES);
    forceNewTakeRef.current = false;
    takeStabRef.current.reset();
    deadbands.current.get(takeStabRef.current)?.reset();
    setTakesVersion(v => v + 1);
    return takesRef.current[takesRef.current.length - 1];
  }, []);

  const recordToTake = useCallback((frame: PitchFrame): PitchFrame => {
    const takes = takesRef.current;
    let take = takes[takes.length - 1];
    const last = take?.frames[take.frames.length - 1];
    // Continue the take only while song time keeps moving forward without big jumps
    const continuous = take && (!last || (frame.timestamp >= last.timestamp - 0.05 && frame.timestamp - last.timestamp < 0.5));
    if (!take || forceNewTakeRef.current || !continuous) {
      take = startNewTake();
    }
    return appendLive(take.frames, frame, takeStabRef.current, Number.POSITIVE_INFINITY, 0);
  }, [startNewTake]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearTakes = useCallback(() => {
    takesRef.current = [];
    takeCounterRef.current = 0;
    tunerTakeRef.current.frames.length = 0;
    tunerStabRef.current.reset();
    forceNewTakeRef.current = true;
    comparatorRef.current.resetScore();
    setTakesVersion(v => v + 1);
  }, []);

  // ---- Microphone frames (handler kept in a ref so it always sees the latest state) ----
  const micHandlerRef = useRef<(frame: PitchFrame) => void>(() => {});
  micHandlerRef.current = (frame: PitchFrame) => {
    if (appModeRef.current === 'tuner') {
      const start = tunerClockStartRef.current ?? performance.now();
      const t = (performance.now() - start) / 1000 - MIC_ANALYSIS_DELAY;
      const take = tunerTakeRef.current;
      frame = appendLive(take.frames, { ...frame, timestamp: t }, tunerStabRef.current, 4000, 1500);

      if (!frame.voiced || frame.frequency <= 0) {
        setCoachingFeedback(comparatorRef.current.compare(frame, 0, 0, '—'));
        return;
      }
      // Nearest equal-tempered note for the calibrated A4, with hysteresis: between two notes the
      // name stays on the current one until the voice is clearly (> 60 cents) away from it
      const calOffset = 12 * Math.log2(referenceA4Ref.current / 440);
      const calMidi = frame.exactMidi - calOffset;
      const previous = tunerNoteRef.current;
      const nearest = previous !== null && Math.abs(calMidi - previous) < 0.6 ? previous : Math.round(calMidi);
      tunerNoteRef.current = nearest;
      const targetMidi = nearest + calOffset;
      const name = midiName(nearest, enharmonicRef.current);
      const fb = comparatorRef.current.compare(frame, targetMidi, PraatPitchEngine.midiToFrequency(targetMidi), name);
      setCoachingFeedback({ ...fb, micNote: name });
      setTunerNote(nearest);
      // Re-centre the view only when the recent (median) pitch leaves it, not on single frames
      const recent = take.frames.slice(-8).filter(f => f.voiced).map(f => f.exactMidi).sort((a, b) => a - b);
      if (recent.length >= 4) {
        const centre = Math.round(recent[recent.length >> 1]);
        setTunerRange(r => (centre < r.min + 3 || centre > r.max - 3) ? { min: centre - 12, max: centre + 12 } : r);
      }
      return;
    }

    const mixer = mixerRef.current;
    const running = !!mixer && mixer.isRunning();
    frame = running
      ? recordToTake(frame)
      : appendLive(idleFramesRef.current, frame, idleStabRef.current, 200, 100);
    let target = getTargetAt(running ? frame.timestamp : currentTimeRef.current);
    if (anyOctaveRef.current && frame.voiced && frame.exactMidi > 0 && target.targetMidi > 0) {
      // Move the target by whole octaves to the octave closest to what is being sung
      const octaves = Math.round((frame.exactMidi - target.targetMidi) / 12);
      if (octaves !== 0) {
        const targetMidi = target.targetMidi + 12 * octaves;
        const targetHz = PraatPitchEngine.midiToFrequency(targetMidi);
        target = { targetMidi, targetHz, targetNoteName: PraatPitchEngine.frequencyToNote(targetHz, enharmonicRef.current).noteName };
      }
    }
    setCoachingFeedback(comparatorRef.current.compare(frame, target.targetMidi, target.targetHz, target.targetNoteName));
  };

  // Initialize MultiTrackMixer
  useEffect(() => {
    const mixer = new MultiTrackMixer();
    mixerRef.current = mixer;
    mixer.onMicFrame = (frame) => micHandlerRef.current(frame);

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
      setCountInLeft(mixer.getCountInBeatsRemaining());
      if (!autoFollowRef.current) return;
      // Page the viewport forward when the playhead nears the right edge (or left the view)
      const { offset, visible } = viewRef.current;
      if (time > offset + visible * 0.85 || time < offset) {
        setView(clampView(time - visible * 0.1, visible, durationRef.current));
      }
    };

    mixer.onPlaybackEnded = () => {
      setIsPlaying(false);
      setCountInLeft(0);
      forceNewTakeRef.current = true;
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

  // Metronome / count-in settings -> mixer
  const countInBeats = countInMode === 'off' ? 0
    : countInMode === '1bar' ? beatsPerBar
    : countInMode === '2bars' ? beatsPerBar * 2
    : countInCustomBeats;
  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.metronome = { ...mixer.metronome, enabled: metronomeOn, bpm, beatsPerBar, firstBeat };
    mixer.countInBeats = countInBeats;
    mixer.resetMetronomeSchedule();
  }, [metronomeOn, bpm, beatsPerBar, firstBeat, countInBeats]);

  // Compute maximum audio duration
  const maxDuration = useMemo(() => {
    return Math.max(0, ...tracks.map(t => t.duration));
  }, [tracks]);
  durationRef.current = maxDuration;

  // Phones start with a shorter window so notes stay readable
  useEffect(() => {
    setView(v => clampView(v.offset, isMobile ? BASE_VISIBLE / 2 : BASE_VISIBLE, durationRef.current));
  }, [isMobile]);

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

  // ---- Microphone ----
  const startMic = async () => {
    const mixer = mixerRef.current;
    if (!mixer) return false;
    const success = await mixer.startMicrophone(selectedDeviceId);
    setIsMicActive(success);
    return success;
  };

  const handleToggleMic = async () => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    if (isMicActive) {
      mixer.stopMicrophone();
      setIsMicActive(false);
      comparatorRef.current.resetScore();
    } else {
      await startMic();
    }
  };

  // ---- Transport ----
  const loadedBuffers = () => tracksRef.current.filter(t => t.audioBuffer).map(t => t.audioBuffer!);

  /** Makes sure pitch-preserved audio exists for the current speed (shows progress). */
  const ensureSpeedPrepared = async (rate: number) => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    const buffers = loadedBuffers();
    if (!mixer.isRatePrepared(buffers, rate)) {
      setSpeedProgress(0);
      await mixer.prepareRate(buffers, rate, setSpeedProgress);
      setSpeedProgress(null);
    }
  };

  const handlePlayPause = async () => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.getAudioContext(); // resume within the user gesture (iOS)

    if (mixer.isPlaying) {
      mixer.pauseAll();
      setIsPlaying(false);
      setCountInLeft(0);
      return;
    }
    if (speedProgress !== null) return; // still preparing
    await ensureSpeedPrepared(speed);
    mixer.playbackRate = speed;
    const start = currentTimeRef.current >= durationRef.current - 0.05 ? 0 : currentTimeRef.current;
    mixer.playAll(tracksRef.current, start, true);
    setIsPlaying(mixer.isPlaying);
    setAutoFollow(true);
  };
  const playPauseRef = useRef<() => void>(() => {});
  playPauseRef.current = handlePlayPause;

  // Stop transport
  const handleStop = () => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.stopAll();
    setIsPlaying(false);
    setCountInLeft(0);
    setCurrentTime(0);
    forceNewTakeRef.current = true;
    setView(v => clampView(0, v.visible, durationRef.current));
  };

  // Seek timeline
  const handleSeek = (seekTime: number) => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    setCurrentTime(seekTime);
    forceNewTakeRef.current = true;
    if (mixer.isPlaying) {
      mixer.playAll(tracksRef.current, seekTime);
    } else {
      mixer.setPosition(seekTime);
    }
  };

  // Speed change: prepare stretched audio, then continue playing at the same position
  const handleSpeedChange = async (rate: number) => {
    const mixer = mixerRef.current;
    if (!mixer || rate === speed) return;
    setSpeed(rate);
    const wasPlaying = mixer.isPlaying;
    const pos = mixer.getCurrentTime();
    if (wasPlaying) {
      mixer.pauseAll();
      setIsPlaying(false);
    }
    await ensureSpeedPrepared(rate);
    mixer.playbackRate = rate;
    if (wasPlaying) {
      forceNewTakeRef.current = true;
      mixer.playAll(tracksRef.current, pos);
      setIsPlaying(true);
    }
  };

  // ---- Tempo ----
  const handleTap = () => {
    const mixer = mixerRef.current;
    const now = performance.now();
    const taps = tapTimesRef.current.filter(t => now - t < 2500);
    taps.push(now);
    tapTimesRef.current = taps.slice(-8);
    mixer?.clickNow(taps.length === 1);
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];
      // Taps are in song tempo at the current playback speed
      const tapped = Math.round((60000 / median) / speed);
      tempoTouchedRef.current = true;
      setBpm(Math.max(30, Math.min(260, tapped)));
      setTempoStatus(`Tap: ${tapped} BPM (${taps.length})`);
      // While playing, align the beat grid to the taps
      if (mixer?.isRunning()) setFirstBeat(mixer.getCurrentTime());
    } else {
      setTempoStatus('Tap again…');
    }
  };

  const runTempoDetection = (manual: boolean) => {
    const track = mainTrackRef.current ?? tracksRef.current.find(t => t.audioBuffer) ?? null;
    if (!track?.audioBuffer) return;
    const result = detectTempo(track.audioBuffer, track.pitchFrames, beatsPerBar);
    if (!result) {
      if (manual) setTempoStatus('Could not detect tempo');
      return;
    }
    const rounded = Math.abs(result.bpm - Math.round(result.bpm)) < 0.6 ? Math.round(result.bpm) : result.bpm;
    if (manual) tempoTouchedRef.current = false;
    setBpm(rounded);
    setFirstBeat(result.firstBeat);
    setTempoStatus(`${manual ? 'Detected' : 'Auto'} ${rounded} BPM${result.confidence < 0.1 ? ' (uncertain)' : ''}`);
  };
  const handleDetectTempo = () => runTempoDetection(true);

  // Auto-detect tempo & bar position for a newly loaded reference track (or a new time signature),
  // unless the user has set the tempo themselves
  const mainBuffer = mainTrack?.audioBuffer ?? null;
  const mainFrames = mainTrack?.pitchFrames ?? null;
  useEffect(() => {
    if (!mainBuffer || !mainFrames || mainFrames.length === 0 || tempoTouchedRef.current) return;
    runTempoDetection(false);
  }, [mainBuffer, mainFrames, beatsPerBar]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Moves the bar lines by whole beats (when the detected bar start is on the wrong beat). */
  const shiftDownbeat = (beats: number) => {
    setFirstBeat(fb => fb + (beats * 60) / bpm);
  };

  // ---- Mode ----
  const handleSetAppMode = async (mode: AppMode) => {
    if (mode === appMode) return;
    const mixer = mixerRef.current;
    if (mode === 'tuner') {
      if (mixer?.isPlaying) {
        mixer.pauseAll();
        setIsPlaying(false);
      }
      tunerTakeRef.current = { id: -1, color: TAKE_COLORS[0], frames: [] };
      tunerStabRef.current.reset();
      setTunerClockStart(performance.now());
      setTunerNote(null);
      comparatorRef.current.resetScore();
      setAppMode('tuner');
      if (!isMicActive) await startMic();
    } else {
      setTunerClockStart(null);
      comparatorRef.current.resetScore();
      setAppMode('practice');
    }
  };

  // Keyboard shortcuts
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
        case 'm':
        case 'M':
          setMetronomeOn(m => !m);
          break;
        case 't':
        case 'T':
          tapRef.current();
          break;
        case 'c':
        case 'C':
          clearTakes();
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
  }, [zoomButton, fitSong, scrollBy, scrollTo, clearTakes]);
  const tapRef = useRef(handleTap);
  tapRef.current = handleTap;

  // ---- Track management ----
  const handleUploadFile = async (index: number, file: File) => {
    const mixer = mixerRef.current;
    if (!mixer) return;

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

      const keyResult = MusicalHarmonyEngine.detectKeyAndMode(pitchFrames);
      if (keyResult && keyResult.confidence > 0.45) {
        setDetectedKey(keyResult);
      }

      const currentTrack = tracksRef.current[index];
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

  const handleApplyDetectedKey = () => {
    if (detectedKey) {
      setRootIndex(detectedKey.rootIndex);
      setActiveMode(detectedKey.mode);
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
      { midi: 60, dur: 1.2 },
      { midi: 64, dur: 1.2 },
      { midi: 67, dur: 1.2 },
      { midi: 69, dur: 1.2 },
      { midi: 67, dur: 1.2 }
    ];

    let offset = 0;
    for (const note of notes) {
      const freq = PraatPitchEngine.midiToFrequency(note.midi);
      const samples = Math.floor(note.dur * sampleRate);
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        const vibrato = 1.0 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t);
        const f = freq * vibrato;
        const wave = 0.5 * Math.sin(2 * Math.PI * f * t) +
                     0.25 * Math.sin(4 * Math.PI * f * t) +
                     0.12 * Math.sin(6 * Math.PI * f * t);
        const env = Math.min(1.0, i / 800) * Math.min(1.0, (samples - i) / 800);
        data[offset + i] = wave * env * 0.4;
      }
      offset += samples;
    }

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

  // Harmony target notes for the diagram: reference notes transposed by the active interval
  const harmonyNotes = useMemo<HarmonyNote[]>(() => {
    if (!mainTrack || activeHarmonyPreset.group === 'unison') return [];
    const eng = new MusicalHarmonyEngine(rootIndex, activeMode);
    eng.activePreset = activeHarmonyPreset;
    eng.customSemitones = customSemitones;
    if (activeHarmonyPreset.id === 'custom_chromatic' && customSemitones === 0) return [];
    return NoteGridRenderer.getSegments(mainTrack.pitchFrames).map(s => ({
      startTime: s.startTime,
      endTime: s.endTime,
      midi: eng.transposeMidi(s.nearestMidi)
    }));
  }, [mainTrack, activeHarmonyPreset, rootIndex, activeMode, customSemitones]);

  // Target notes for mistake detection: reference notes, or the harmony notes when an interval is
  // active (keeping the reference's own tuning offset)
  const targetNotes = useMemo<TargetNote[]>(() => {
    if (!mainTrack) return [];
    const segs = NoteGridRenderer.getSegments(mainTrack.pitchFrames);
    if (harmonyNotes.length === segs.length && harmonyNotes.length > 0) {
      return segs.map((s, i) => ({ startTime: s.startTime, endTime: s.endTime, midi: harmonyNotes[i].midi + (s.medianMidi - s.nearestMidi) }));
    }
    return segs.map(s => ({ startTime: s.startTime, endTime: s.endTime, midi: s.medianMidi }));
  }, [mainTrack, harmonyNotes]);

  // Note range on the grid: fit to the pitches of the loaded tracks and harmony (default A2..F5)
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
    for (const n of harmonyNotes) {
      lo = Math.min(lo, Math.floor(n.midi) - 2);
      hi = Math.max(hi, Math.ceil(n.midi) + 2);
    }
    const MIN_SPAN = 20;
    if (hi - lo < MIN_SPAN) {
      const extra = MIN_SPAN - (hi - lo);
      lo -= Math.floor(extra / 2);
      hi += Math.ceil(extra / 2);
    }
    return { minMidi: lo, maxMidi: hi };
  }, [tracks, harmonyNotes]);

  const currentTheme = THEMES[theme];
  // Whole-app theme (see index.css): the palette is re-mapped per theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[theme].bgPanel);
  }, [theme]);
  const isTuner = appMode === 'tuner';
  // The tuner take object is replaced whenever tuner mode starts (tunerClockStart changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tunerTakes = useMemo(() => [tunerTakeRef.current], [tunerClockStart]);

  // Keep the screen awake while practising (phones dim/lock otherwise)
  useEffect(() => {
    if (!isPlaying && !isMicActive) return;
    type WakeLockSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      nav.wakeLock!.request('screen').then(l => {
        if (cancelled) l.release(); else lock = l;
      }).catch(() => { /* not allowed (e.g. hidden tab) */ });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [isPlaying, isMicActive]);

  // Mobile browsers (iOS Safari) only allow audio after a user gesture: resume on first touch
  useEffect(() => {
    const unlock = () => {
      mixerRef.current?.getAudioContext();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // ---- Shared props for both layouts ----
  const topBarProps: TopBarProps = {
    isPlaying,
    onPlayPause: handlePlayPause,
    onStop: handleStop,
    currentTime,
    duration: maxDuration,
    isMicActive,
    onToggleMic: handleToggleMic,
    inputDevices,
    selectedDeviceId,
    onSelectDevice: (id) => {
      setSelectedDeviceId(id);
      if (isMicActive && mixerRef.current) {
        mixerRef.current.startMicrophone(id);
      }
    },
    theme,
    onSelectTheme: setTheme,
    noteLabelMode,
    onSelectNoteLabelMode: setNoteLabelMode,
    enharmonic,
    onToggleEnharmonic: () => setEnharmonic(prev => prev === 'sharp' ? 'flat' : 'sharp'),
    appMode,
    onSetAppMode: handleSetAppMode,
    keepTakes,
    onToggleKeepTakes: () => setKeepTakes(k => !k),
    takeCount: takesRef.current.length,
    onClearTakes: clearTakes
  };

  const hudProps: CoachingHUDProps = {
    feedback: coachingFeedback,
    hasMainTrack: !!mainTrack,
    tunerMode: isTuner,
    referenceA4,
    precisionCents,
    onPrecisionChange: setPrecisionCents
  };

  const harmonyProps: HarmonyPanelProps = {
    activePreset: activeHarmonyPreset,
    onSelectPreset: setActiveHarmonyPreset,
    rootIndex,
    onSelectRoot: (r) => {
      keyTouchedRef.current = true;
      setRootIndex(r);
    },
    activeMode,
    onSelectMode: (m) => {
      keyTouchedRef.current = true;
      setActiveMode(m);
    },
    customSemitones,
    onChangeCustomSemitones: setCustomSemitones,
    detectedKey,
    onApplyDetectedKey: handleApplyDetectedKey,
    anyOctave,
    onToggleAnyOctave: () => {
      setAnyOctave(a => !a);
      comparatorRef.current.resetScore();
    }
  };

  const practiceProps: PracticePanelProps = {
    speed,
    onSpeedChange: handleSpeedChange,
    speedProgress,
    metronomeOn,
    onToggleMetronome: () => setMetronomeOn(m => !m),
    bpm,
    onBpmChange: (v) => {
      tempoTouchedRef.current = true;
      setBpm(v);
    },
    onShiftDownbeat: shiftDownbeat,
    beatsPerBar,
    onBeatsPerBarChange: setBeatsPerBar,
    onTap: handleTap,
    onDetectTempo: handleDetectTempo,
    tempoStatus,
    canDetectTempo: tracks.some(t => t.audioBuffer),
    countInMode,
    onCountInModeChange: setCountInMode,
    countInCustomBeats,
    onCountInCustomBeatsChange: setCountInCustomBeats
  };

  const tunerProps: TunerPanelProps = {
    referenceA4,
    onChangeReferenceA4: setReferenceA4,
    isMicActive,
    onEnableMic: startMic
  };

  const visualizerProps: VisualizerCanvasProps = {
    tracks: isTuner ? [] : tracks,
    takes: isTuner ? tunerTakes : takesRef.current,
    liveClockStart: isTuner ? tunerClockStart : null,
    options: {
      theme: currentTheme,
      noteLabelMode: isTuner && noteLabelMode === 'cs_only' ? 'all_notes' : noteLabelMode,
      enharmonic,
      minMidi: isTuner ? tunerRange.min : minMidi,
      maxMidi: isTuner ? tunerRange.max : maxMidi,
      visibleDuration: isTuner ? 8 : visibleDuration,
      timeOffset,
      currentTime,
      harmonyNotes: isTuner ? undefined : harmonyNotes,
      beatGrid: !isTuner && metronomeOn ? { bpm, firstBeat, beatsPerBar } : null,
      highlightMidi: isTuner ? tunerNote : null,
      hidePlayhead: isTuner,
      mistakes: !isTuner && highlightMistakes && targetNotes.length > 0
        ? { targets: targetNotes, thresholdCents: mistakeCents, anyOctave }
        : null
    },
    onSeek: handleSeek,
    onScrollBy: scrollBy,
    onZoomAt: zoomAt
  };

  // ---- Export (same renderer and settings as on screen) ----
  const handleExport = async (format: ExportFormat, range: ExportRange) => {
    const el = document.querySelector('[data-diagram]');
    if (!el || exporting) return;
    const rect = el.getBoundingClientRect();
    let options = visualizerProps.options;
    if (isTuner && tunerClockStart != null) {
      const now = (performance.now() - tunerClockStart) / 1000;
      options = { ...options, currentTime: now, timeOffset: now - options.visibleDuration * 0.85 };
    }
    const song = range === 'song' && !isTuner;
    if (song) options = { ...options, hidePlayhead: true };

    const takes = visualizerProps.takes.filter(t => t.frames.length > 0);
    const shownTracks = visualizerProps.tracks.filter(t => !t.muted && t.pitchFrames.length > 0);
    const details = [new Date().toLocaleString()];
    if (!isTuner) {
      if (activeHarmonyPreset.group !== 'unison') details.push(activeHarmonyPreset.name);
      if (anyOctave) details.push('any octave');
      if (speed !== 1) details.push(`speed ×${speed}`);
      if (metronomeOn) details.push(`${bpm} BPM ${beatsPerBar}/4`);
    } else {
      details.push(`A4 = ${referenceA4} Hz`);
    }
    details.push(`precision ±${precisionCents}¢`);
    if (options.mistakes) details.push(`mistakes > ${mistakeCents}¢`);

    setExporting(true);
    try {
      const file = await exportDiagram({
        tracks: visualizerProps.tracks,
        takes,
        options,
        width: rect.width,
        height: rect.height,
        duration: maxDuration,
        title: isTuner ? 'Choiropractics · Tuner' : `Choiropractics · ${mainTrack?.name ?? shownTracks[0]?.name ?? 'Practice'}`,
        details,
        legend: [
          ...shownTracks.map(t => ({ color: t.color, label: t.isMain ? `★ ${t.name}` : t.name })),
          ...(options.harmonyNotes?.length ? [{ color: options.harmonyColor || '#a78bfa', label: 'Harmony' }] : []),
          ...(isTuner ? [] : takes.map(t => ({ color: t.color, label: `Take ${t.id + 1}` })))
        ]
      }, format, range);
      await saveFile(file, isMobile);
    } catch (e) {
      console.error('Export failed', e);
      alert('Export failed: ' + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const reviewProps: ReviewControlsProps = {
    showMistakeControls: !isTuner,
    highlightMistakes,
    onToggleHighlightMistakes: () => setHighlightMistakes(h => !h),
    mistakeCents,
    onMistakeCentsChange: setMistakeCents,
    canHighlight: !!mainTrack,
    onExport: handleExport,
    exporting,
    canExportSong: !isTuner && maxDuration > 0
  };

  const timelineProps: TimelineScrollbarProps = {
    duration: maxDuration,
    currentTime,
    timeOffset,
    visibleDuration,
    minVisibleDuration: MIN_VISIBLE,
    tracks,
    autoFollow,
    onScrollTo: scrollTo,
    onSetView: setViewWindow,
    onZoomIn: () => zoomButton(1.25),
    onZoomOut: () => zoomButton(1 / 1.25),
    onToggleAutoFollow: () => setAutoFollow(a => !a),
    onFitSong: fitSong,
    themeBackground: currentTheme.bgMain
  };

  const trackListProps: TrackListProps = {
    tracks,
    onUploadFile: handleUploadFile,
    onToggleMute: handleToggleMute,
    onToggleSolo: handleToggleSolo,
    onChangeVolume: handleChangeVolume,
    onChangeColor: handleChangeColor,
    onSetMainTrack: handleSetMainTrack,
    onClearTrack: handleClearTrack,
    enableBandpass,
    onToggleBandpass: () => setEnableBandpass(prev => !prev),
    vocalPreset,
    onSelectVocalPreset: setVocalPreset
  };

  const overlayProps = {
    countInLeft,
    showWelcome: !isTuner && !tracks.some(t => t.audioBuffer),
    onLoadDemo: handleLoadDemo
  };

  if (isMobile) {
    return (
      <MobileLayout
        topBar={topBarProps}
        hud={hudProps}
        harmony={harmonyProps}
        practice={practiceProps}
        tuner={tunerProps}
        visualizer={visualizerProps}
        timeline={timelineProps}
        trackList={trackListProps}
        overlays={overlayProps}
        review={reviewProps}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans select-none">
      <TopBar {...topBarProps} extra={<ReviewControls {...reviewProps} />} />

      {/* Real-Time Pitch Coaching Feedback Bar */}
      <CoachingHUD {...hudProps} />

      {isTuner ? (
        <TunerPanel {...tunerProps} />
      ) : (
        <>
          <HarmonyPanel {...harmonyProps} />
          <PracticePanel {...practiceProps} />
        </>
      )}

      {/* Main Pitch Visualizer Canvas */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <VisualizerCanvas {...visualizerProps} />
        <CanvasOverlays {...overlayProps} uploadHint="into the 6 track slots below" />
      </div>

      {/* Song timeline: scrollbar, overview, zoom */}
      {!isTuner && <TimelineScrollbar {...timelineProps} />}

      {/* Bottom: 6 Audio Tracks Management & Filter Matrix */}
      <TrackList {...trackListProps} />
    </div>
  );
}
export default App;
