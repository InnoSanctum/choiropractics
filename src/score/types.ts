export const MAX_TRACKS = 20;
export const SCORE_VERSION = 1;

/** Beats in parsed scores; seconds after buildScoreTracks(). */
export interface ScoreNote {
  id: string;
  start: number;
  end: number;
  midi: number;
  velocity: number;
}
export type PartStrategy = 'split' | 'keep';
export interface ScorePart {
  id: string;
  name: string;
  instrument: string;
  notes: ScoreNote[];
  kind: 'vocal' | 'instrument' | 'unknown';
  maxPolyphony: number;
  strategy: PartStrategy;
  reason: string;
}
export interface TempoPoint { beat: number; bpm: number }
export interface ParsedScore {
  title: string;
  parts: ScorePart[];
  durationBeats: number;
  tempos: TempoPoint[];
  beatsPerBar: number;
  warnings: string[];
}
export interface ScoreTrack {
  name: string;
  notes: ScoreNote[];
  isPolyphonic: boolean;
  duration: number;
}
