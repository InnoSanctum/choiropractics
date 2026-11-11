import type { AudioTrackState } from './MultiTrackMixer';
import type { PitchFrame } from './PraatPitchEngine';

export const MAX_TRACK_OFFSET = 3600;
export const normalizeTrackOffset = (value: number) => Number.isFinite(value)
  ? Math.round(Math.max(-MAX_TRACK_OFFSET, Math.min(MAX_TRACK_OFFSET, value)) * 1000) / 1000 : 0;
export const trackOffset = (track: Pick<AudioTrackState, 'startOffset'>) => normalizeTrackOffset(track.startOffset ?? 0);
export const trackEnd = (track: AudioTrackState) => Math.max(0, trackOffset(track) + (track.audioBuffer?.duration ?? track.duration));
export const songDuration = (tracks: AudioTrackState[]) => tracks.reduce((end, t) => t.audioBuffer ? Math.max(end, trackEnd(t)) : end, 0);

/** Offset is in song seconds. Speed changes wall-clock delays, never this value. */
export function sourcePlacement(track: AudioTrackState, songPosition: number, rate: number) {
  const localTime = songPosition - trackOffset(track);
  const duration = track.audioBuffer?.duration ?? track.duration;
  if (localTime >= duration) return null;
  return { delay: Math.max(0, -localTime) / rate, sourceOffset: Math.max(0, localTime) };
}

export function referenceFrameAt(track: AudioTrackState, songTime: number): PitchFrame | null {
  const localTime = songTime - trackOffset(track);
  if (localTime < 0 || localTime >= (track.audioBuffer?.duration ?? track.duration)) return null;
  const frames = track.pitchFrames;
  let low = 0, high = frames.length;
  while (low < high) { const mid = (low + high) >> 1; if (frames[mid].timestamp <= localTime + 1e-9) low = mid + 1; else high = mid; }
  const frame = frames[Math.max(0, low - 1)];
  return frame && Math.abs(frame.timestamp - localTime) <= 0.05 ? frame : null;
}

export function barStartSeconds(bar: number, bpm: number, beatsPerBar: number): number {
  if (!Number.isInteger(bar) || bar < 1 || !Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(beatsPerBar) || beatsPerBar <= 0) throw new Error('Choose a positive bar number and tempo.');
  return normalizeTrackOffset((bar - 1) * beatsPerBar * 60 / bpm);
}

export function dragTrackOffset(startOffset: number, deltaPixels: number, secondsPerPixel: number, snapSeconds = 0) {
  const value = startOffset + deltaPixels * secondsPerPixel;
  return normalizeTrackOffset(snapSeconds > 0 ? Math.round(value / snapSeconds) * snapSeconds : value);
}

export function shiftNoteTimes<T extends { startTime: number; endTime: number }>(notes: T[], offset: number): T[] {
  return notes.map(n => ({ ...n, startTime: n.startTime + offset, endTime: n.endTime + offset }));
}
