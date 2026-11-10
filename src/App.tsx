import React, { Suspense, lazy, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TopBar, TopBarProps } from './components/TopBar';
import { TrackList, TrackListProps } from './components/TrackList';
import { CoachingHUD, CoachingHUDProps } from './components/CoachingHUD';
import { HarmonyPanel, HarmonyPanelProps } from './components/HarmonyPanel';
import { VisualizerCanvas, VisualizerCanvasProps } from './components/VisualizerCanvas';
import { TimelineScrollbar, TimelineScrollbarProps } from './components/TimelineScrollbar';
import { PracticePanel, PracticePanelProps, CountInMode } from './components/PracticePanel';
import { TunerPanel, TunerPanelProps } from './components/TunerPanel';
import { TrainingPanel, TrainingPanelProps } from './components/TrainingPanel';
import type { ScoreImportSettings } from './components/ScoreImportDialog';
import { CanvasOverlays } from './components/CanvasOverlays';
import { ReviewControls, ReviewControlsProps, MISTAKE_LEVELS } from './components/ReviewControls';
import { exportDiagram, saveFile, ExportFormat, ExportRange } from './visualizer/DiagramExport';
import { TargetNote } from './audio/MistakeDetector';
import { MobileLayout } from './components/mobile/MobileLayout';
import { useIsMobile } from './hooks/useIsMobile';

import { MultiTrackMixer, AudioTrackState } from './audio/MultiTrackMixer';
import { emptyTrack, INITIAL_TRACKS, MAX_TRACKS, visibleDiagramTracks } from './audio/TrackState';
import { renderScoreTrack, SCORE_SAMPLE_RATE } from './score/ScoreAudio';
import { SCORE_VERSION, ScoreTrack } from './score/types';
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

const ScoreImportDialog = lazy(() => import('./components/ScoreImportDialog').then(m => ({ default: m.ScoreImportDialog })));

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

type AppMode = TopBarProps['appMode'];

export function App() {
  const isMobile = useIsMobile();

  // Mixer & Audio Engine instances
  const mixerRef = useRef<MultiTrackMixer | null>(null);
  const comparatorRef = useRef<PitchComparator>(new PitchComparator());
  const harmonyEngineRef = useRef<MusicalHarmonyEngine>(new MusicalHarmonyEngine(0, 'major'));

  // Track slots grow as needed, up to the import/playback safeguard.
  const [tracks, setTracks] = useState<AudioTrackState[]>(() =>
    Array.from({ length: INITIAL_TRACKS }, (_, i) => emptyTrack(i))
  );
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const [scoreFile, setScoreFile] = useState<File | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // App mode: sing along, sing a silent part, or free tuner
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
  const preparingPlaybackRef = useRef(false);

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
    return tracks.find(t => t.isMain && t.audioBuffer && !t.isPolyphonic) || tracks.find(t => t.audioBuffer && !t.isPolyphonic) || null;
  }, [tracks]);
  const mainTrackRef = useRef(mainTrack);
  mainTrackRef.current = mainTrack;

  // Keep the starred reference valid after upload, restore, or removal.
  useEffect(() => {
    if (mainTrack && (!mainTrack.isMain || tracks.filter(t => t.isMain).length !== 1)) {
      setTracks(prev => prev.map(t => ({ ...t, isMain: t.index === mainTrack.index })));
    }
  }, [tracks, mainTrack]);

  const resetCoaching = useCallback(() => {
    comparatorRef.current.resetScore();
    forceNewTakeRef.current = true;
    setCoachingFeedback({
      status: 'idle', centsDiff: 0, suggestion: 'Press Play and sing the selected part',
      targetNote: '—', micNote: '—', inTunePercentage: 100, targetHz: 0, micHz: 0
    });
  }, []);

  useEffect(() => { resetCoaching(); }, [appMode, mainTrack?.index, mainTrack?.audioBuffer, resetCoaching]);

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

    const harmonized = appModeRef.current === 'training'
      ? { targetMidi: frame.exactMidi, targetHz: frame.frequency }
      : harmonyEngineRef.current.computeTargetPitch(frame.exactMidi, frame.frequency);
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
    setCoachingFeedback(comparatorRef.current.compare(
      frame, target.targetMidi, target.targetHz, target.targetNoteName,
      appModeRef.current !== 'training' || running
    ));
  };

  // Initialize MultiTrackMixer
  useEffect(() => {
    let cancelled = false;
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
    const restoring = Array.from({ length: MAX_TRACKS }, (_, i) =>
      db.getTrack(i).then(async (stored) => {
        if (stored && !cancelled) {
          try {
            const buffer = await mixer.decodeAudioFile(stored.track.audioBlob as File);
            if (cancelled) return;
            let frames = stored.frames;
            if (stored.track.source !== 'score' && stored.track.analysisVersion !== PITCH_ANALYSIS_VERSION) {
              // Stored with an older pitch algorithm: re-analyze and update the cache
              setTracks(prev => prev.map(t => t.index === i ? { ...t, isAnalyzing: true, analysisProgress: 0, name: stored.track.name } : t));
              frames = await BatchPitchExtractor.extractPitchFromAudioBuffer(buffer, {
                onProgress: (p) => {
                  setTracks(prev => prev.map(t => t.index === i ? { ...t, analysisProgress: p.percent } : t));
                }
              });
              await db.saveTrack(i, stored.track.name, stored.track.audioBlob, frames, stored.track.color, stored.track.volume, PITCH_ANALYSIS_VERSION, { visible: stored.track.visible });
            }
            if (cancelled) return;
            const keyResult = MusicalHarmonyEngine.detectKeyAndMode(frames);
            if (keyResult && keyResult.confidence > 0.45) {
              setDetectedKey(prev => prev ?? keyResult);
            }
            setTracks(prev => Array.from({ length: Math.max(prev.length, i + 1) }, (_, index) => prev[index] ?? emptyTrack(index)).map(t => {
              if (t.index === i) {
                return {
                  ...t,
                  name: stored.track.name.replace(/\.[^/.]+$/, ''),
                  audioBuffer: buffer,
                  pitchFrames: frames,
                  isAnalyzing: false,
                  analysisProgress: 100,
                  color: stored.track.color || t.color,
                  volume: stored.track.volume ?? t.volume,
                  visible: stored.track.visible ?? true,
                  source: stored.track.source ?? 'audio',
                  scoreNotes: stored.track.scoreNotes,
                  isPolyphonic: stored.track.isPolyphonic,
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
      }).catch(e => { if (!cancelled) console.error('Failed reading stored track:', e); })
    );
    Promise.all(restoring).finally(() => { if (!cancelled) setIsRestoring(false); });

    return () => {
      cancelled = true;
      mixer.stopAll();
      mixer.stopMicrophone();
    };
  }, []);

  // Update Gain Matrix whenever tracks change
  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.initTrackChannels(tracks.length);
      mixerRef.current.trainingTrackIndex = appMode === 'training' ? mainTrack?.index ?? null : null;
      mixerRef.current.updateGainMatrix(tracks);
    }
  }, [tracks, appMode, mainTrack?.index]);

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
    if (!mixer || appModeRef.current === 'tuner') return;
    mixer.getAudioContext(); // resume within the user gesture (iOS)

    if (mixer.isPlaying) {
      mixer.pauseAll();
      setIsPlaying(false);
      setCountInLeft(0);
      return;
    }
    if (speedProgress !== null || preparingPlaybackRef.current) return;
    const startingMode = appModeRef.current;
    preparingPlaybackRef.current = true;
    try {
      if (startingMode === 'training') {
        const target = mainTrackRef.current;
        if (!target || target.isAnalyzing || !target.pitchFrames.some(f => f.voiced)) return;
        if (!mixer.isMicActive && !await startMic()) {
          alert('Training needs microphone access. Enable the microphone in your browser and try again.');
          return;
        }
        if (currentTimeRef.current >= durationRef.current - 0.05 || currentTimeRef.current === 0) resetCoaching();
      }
      await ensureSpeedPrepared(speed);
      // Mode may change while permission or time stretching is pending.
      if (appModeRef.current !== startingMode) return;
      mixer.playbackRate = speed;
      const start = currentTimeRef.current >= durationRef.current - 0.05 ? 0 : currentTimeRef.current;
      mixer.playAll(tracksRef.current, start, true);
      setIsPlaying(mixer.isPlaying);
      setAutoFollow(true);
    } finally {
      preparingPlaybackRef.current = false;
    }
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
    if (appModeRef.current === 'training') resetCoaching();
    forceNewTakeRef.current = true;
    setView(v => clampView(0, v.visible, durationRef.current));
  };

  // Seek timeline
  const handleSeek = (seekTime: number) => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    setCurrentTime(seekTime);
    forceNewTakeRef.current = true;
    if (appModeRef.current === 'training') resetCoaching();
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
      setAppMode(mode);
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
            source: 'audio',
            scoreNotes: undefined,
            isPolyphonic: false,
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
        PITCH_ANALYSIS_VERSION,
        { visible: currentTrack.visible }
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
    if (tracksRef.current.find(t => t.index === index)?.isPolyphonic) return;
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
          scoreNotes: undefined,
          isPolyphonic: false,
          source: 'audio',
          muted: false,
          solo: false,
          duration: 0
        };
      }
      return t;
    }));
    await db.clearTrack(index);
  };

  const handleToggleVisibility = (index: number) => {
    if (appModeRef.current === 'training') return;
    const track = tracksRef.current.find(t => t.index === index);
    if (!track) return;
    const visible = track.visible === false;
    setTracks(prev => prev.map(t => t.index === index ? { ...t, visible } : t));
    db.setVisibility(index, visible).catch(e => console.error('Could not save track visibility:', e));
  };

  const handleImportScore = async (imported: ScoreTrack[], settings: ScoreImportSettings, signal: AbortSignal, progress: (value: number) => void) => {
    const mixer = mixerRef.current;
    if (!mixer || isRestoring) throw new Error('Wait for the saved tracks to finish loading.');
    const occupied = settings.replace ? 0 : tracksRef.current.filter(t => t.audioBuffer || t.isAnalyzing).length;
    if (occupied + imported.length > MAX_TRACKS) throw new Error(`The session can contain at most ${MAX_TRACKS} tracks.`);
    const samples = imported.reduce((n, t) => n + Math.ceil(t.duration * SCORE_SAMPLE_RATE), 0);
    if (samples > 40_000_000) throw new Error('This score needs too much audio memory. Select fewer parts or import a shorter section.');
    const base = settings.replace ? [] : [...tracksRef.current];
    const generated: { state: AudioTrackState; blob: Blob }[] = [];
    const used = new Set(base.filter(t => t.audioBuffer || t.isAnalyzing).map(t => t.index));
    for (const [i, track] of imported.entries()) {
      signal.throwIfAborted();
      let index = 0;
      while (used.has(index)) index++;
      used.add(index);
      const rendered = await renderScoreTrack(track, mixer.getAudioContext(), signal, fraction => progress((i + fraction) / imported.length * 0.95));
      generated.push({ state: { ...emptyTrack(index), name: track.name, audioBuffer: rendered.audioBuffer, pitchFrames: rendered.pitchFrames,
        scoreNotes: track.notes, isPolyphonic: track.isPolyphonic, source: 'score', duration: track.duration, isMain: false }, blob: rendered.blob });
    }
    signal.throwIfAborted();
    // All selected tracks are saved together. A quota/storage failure leaves the rehearsal intact.
    await db.transaction('rw', db.tracks, async () => {
      if (settings.replace) await db.tracks.clear();
      for (const { state, blob } of generated) {
        signal.throwIfAborted();
        await db.saveTrack(state.index, `${state.name}.wav`, blob, state.pitchFrames, state.color, state.volume, undefined,
          { source: 'score', scoreVersion: SCORE_VERSION, scoreNotes: state.scoreNotes, isPolyphonic: state.isPolyphonic, visible: true });
      }
      signal.throwIfAborted();
    });
    // After the transaction commits, finish applying it even if Cancel was clicked at that instant.
    mixer.stopAll(); setIsPlaying(false); setCurrentTime(0); setCountInLeft(0);
    const count = Math.max(INITIAL_TRACKS, ...generated.map(t => t.state.index + 1), base.length);
    const next = Array.from({ length: count }, (_, i) => generated.find(t => t.state.index === i)?.state ?? base[i] ?? emptyTrack(i));
    const reference = next.find(t => t.isMain && t.audioBuffer && !t.isPolyphonic) ?? next.find(t => t.audioBuffer && !t.isPolyphonic);
    setTracks(next.map(t => ({ ...t, isMain: t.index === reference?.index })));
    clearTakes(); resetCoaching();
    tempoTouchedRef.current = true;
    setBpm(settings.bpm); setBeatsPerBar(settings.beatsPerBar); setFirstBeat(0); setTempoStatus('Tempo from imported score');
    setView({ offset: 0, visible: BASE_VISIBLE });
    progress(1);
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
          source: 'audio',
          scoreNotes: undefined,
          isPolyphonic: false,
          duration,
          isMain: true
        };
      }
      return { ...t, isMain: false };
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
    if (appMode === 'training' || !mainTrack || activeHarmonyPreset.group === 'unison') return [];
    const eng = new MusicalHarmonyEngine(rootIndex, activeMode);
    eng.activePreset = activeHarmonyPreset;
    eng.customSemitones = customSemitones;
    if (activeHarmonyPreset.id === 'custom_chromatic' && customSemitones === 0) return [];
    const segments = mainTrack.scoreNotes?.map(n => ({ startTime: n.start, endTime: n.end, nearestMidi: Math.round(n.midi) }))
      ?? NoteGridRenderer.getSegments(mainTrack.pitchFrames);
    return segments.map(s => ({
      startTime: s.startTime,
      endTime: s.endTime,
      midi: eng.transposeMidi(s.nearestMidi)
    }));
  }, [appMode, mainTrack, activeHarmonyPreset, rootIndex, activeMode, customSemitones]);

  // Target notes for mistake detection: reference notes, or the harmony notes when an interval is
  // active (keeping the reference's own tuning offset)
  const targetNotes = useMemo<TargetNote[]>(() => {
    if (!mainTrack) return [];
    const segs = mainTrack.scoreNotes?.map(n => ({ startTime: n.start, endTime: n.end, medianMidi: n.midi, nearestMidi: Math.round(n.midi) }))
      ?? NoteGridRenderer.getSegments(mainTrack.pitchFrames);
    if (harmonyNotes.length === segs.length && harmonyNotes.length > 0) {
      return segs.map((s, i) => ({ startTime: s.startTime, endTime: s.endTime, midi: harmonyNotes[i].midi + (s.medianMidi - s.nearestMidi) }));
    }
    return segs.map(s => ({ startTime: s.startTime, endTime: s.endTime, midi: s.medianMidi }));
  }, [mainTrack, harmonyNotes]);

  // Note range on the grid: fit to the pitches of the loaded tracks and harmony (default A2..F5)
  const { minMidi, maxMidi } = useMemo(() => {
    const pitches: number[] = [];
    for (const t of visibleDiagramTracks(tracks, appMode === 'training', mainTrack?.index ?? null)) {
      if (t.scoreNotes) for (const n of t.scoreNotes) pitches.push(n.midi);
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
  }, [tracks, harmonyNotes, appMode, mainTrack?.index]);

  const currentTheme = THEMES[theme];
  // Whole-app theme (see index.css): the palette is re-mapped per theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[theme].bgPanel);
  }, [theme]);
  const isTuner = appMode === 'tuner';
  const isTraining = appMode === 'training';
  // Audio mute and visual visibility are independent for the training target.
  const diagramTracks = useMemo(() => visibleDiagramTracks(tracks, isTraining, mainTrack?.index ?? null), [tracks, isTraining, mainTrack?.index]);
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

  const trainingProps: TrainingPanelProps = {
    tracks,
    targetIndex: mainTrack?.index ?? null,
    onSelectTarget: handleSetMainTrack,
    isMicActive,
    onEnableMic: handleToggleMic,
    anyOctave,
    onToggleAnyOctave: harmonyProps.onToggleAnyOctave
  };

  const visualizerProps: VisualizerCanvasProps = {
    tracks: isTuner ? [] : diagramTracks,
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
    const shownTracks = visualizerProps.tracks.filter(t => t.pitchFrames.length > 0 || t.scoreNotes?.length);
    const details = [new Date().toLocaleString()];
    if (!isTuner) {
      if (isTraining) details.push(`Training · silent part: ${mainTrack?.name ?? 'none'}`);
      if (!isTraining && activeHarmonyPreset.group !== 'unison') details.push(activeHarmonyPreset.name);
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
    tracks: diagramTracks,
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
    trainingTrackIndex: isTraining ? mainTrack?.index ?? null : null,
    trainingMode: isTraining,
    onToggleVisibility: handleToggleVisibility,
    onAddTrack: () => setTracks(prev => prev.length >= MAX_TRACKS ? prev : [...prev, emptyTrack(prev.length)]),
    onImportScore: setScoreFile,
    importDisabled: isRestoring || tracks.some(t => t.isAnalyzing),
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
  const importDialog = scoreFile && <Suspense fallback={<div role="status" className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center">Opening score importer…</div>}>
    <ScoreImportDialog file={scoreFile} loadedCount={tracks.filter(t => t.audioBuffer).length}
      onClose={() => setScoreFile(null)} onImport={handleImportScore} />
  </Suspense>;

  if (isMobile) {
    return (<>
      <MobileLayout
        topBar={topBarProps}
        hud={hudProps}
        harmony={harmonyProps}
        practice={practiceProps}
        tuner={tunerProps}
        training={trainingProps}
        visualizer={visualizerProps}
        timeline={timelineProps}
        trackList={trackListProps}
        overlays={overlayProps}
        review={reviewProps}
      />
      {importDialog}
    </>);
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
          {isTraining ? <TrainingPanel {...trainingProps} /> : <HarmonyPanel {...harmonyProps} />}
          <PracticePanel {...practiceProps} />
        </>
      )}

      {/* Main Pitch Visualizer Canvas */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <VisualizerCanvas {...visualizerProps} />
        <CanvasOverlays {...overlayProps} uploadHint="into the track slots below, or import a MuseScore score" />
      </div>

      {/* Song timeline: scrollbar, overview, zoom */}
      {!isTuner && <TimelineScrollbar {...timelineProps} />}

      {/* Audio tracks, score import, and mixer controls */}
      <TrackList {...trackListProps} />
      {importDialog}
    </div>
  );
}
export default App;
