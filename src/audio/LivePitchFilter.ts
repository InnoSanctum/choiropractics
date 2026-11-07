/**
 * Real-time clean-up for live microphone pitch frames.
 *
 * Call after appending each new frame. It looks back a few frames and removes short glitches
 * (octave errors, sub-harmonic dives at note ends) that would otherwise be drawn as spikes.
 * Frames are corrected in place; the glitch is visible for at most a few frames (~140 ms).
 */

import { PitchFrame } from './PraatPitchEngine';

const MAX_GLITCH = 3;          // frames
const JUMP_INSIDE = 4;         // semitones: run deviating this much between two agreeing frames
const JUMP_AT_END = 7;         // semitones: run deviating this much before silence

const silence = (f: PitchFrame): PitchFrame => ({
  ...f,
  frequency: 0,
  exactMidi: 0,
  nearestMidi: 0,
  noteName: '—',
  cents: 0,
  voiced: false,
  strength: 0
});

const shiftFrame = (f: PitchFrame, semitones: number): PitchFrame => {
  const exactMidi = f.exactMidi + semitones;
  const nearestMidi = Math.round(exactMidi);
  return {
    ...f,
    exactMidi,
    nearestMidi,
    frequency: f.frequency * Math.pow(2, semitones / 12),
    noteName: `${NOTE_NAMES[((nearestMidi % 12) + 12) % 12]}${Math.floor(nearestMidi / 12) - 1}`,
    cents: Math.round((exactMidi - nearestMidi) * 1000) / 10
  };
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Jumps typical of pitch-detector errors: octave, octave + fifth, two octaves. */
const ERROR_JUMPS = [12, 19, 24];

/**
 * Suppresses flickering octave errors in live pitch while still following real octave leaps.
 *
 * A frame that sits an octave (or octave+fifth / two octaves) away from the recent pitch is
 * shifted back into the current register. Only when the new register persists for
 * `confirmFrames` consecutive frames (~185 ms) is it accepted - then the held-back frames are
 * moved to the new register as well, so an intentional leap is drawn correctly.
 */
export class OctaveStabilizer {
  private recent: number[] = [];
  private held: number[] = [];     // indices of frames shifted while a jump is pending
  private pendingShift = 0;
  private silentFrames = 0;

  constructor(private confirmFrames = 4, private resetAfterSilence = 6) {}

  reset() {
    this.recent = [];
    this.held = [];
    this.pendingShift = 0;
    this.silentFrames = 0;
  }

  /** Call after removing `count` frames from the start of the array. */
  shiftIndices(count: number) {
    this.held = this.held.map(i => i - count).filter(i => i >= 0);
  }

  /** Stabilizes the last frame of `frames` in place. */
  process(frames: PitchFrame[]) {
    const i = frames.length - 1;
    const f = frames[i];
    if (!f || !f.voiced || f.frequency <= 0) {
      if (++this.silentFrames >= this.resetAfterSilence) this.reset();
      return;
    }
    this.silentFrames = 0;

    if (this.recent.length >= 3) {
      const sorted = [...this.recent].sort((a, b) => a - b);
      const ref = sorted[sorted.length >> 1];
      const d = f.exactMidi - ref;
      const jump = ERROR_JUMPS.find(j => Math.abs(Math.abs(d) - j) < 1.0);
      if (jump) {
        const shift = Math.sign(d) * jump;
        if (this.held.length > 0 && shift !== this.pendingShift) this.held = [];
        this.pendingShift = shift;

        if (this.held.length + 1 < this.confirmFrames) {
          // Not confirmed yet: keep it in the current register
          frames[i] = shiftFrame(f, -shift);
          this.held.push(i);
          this.push(frames[i].exactMidi);
          return;
        }
        // Confirmed real leap: restore the held frames and follow the new register
        for (const k of this.held) {
          if (frames[k]?.voiced) frames[k] = shiftFrame(frames[k], shift);
        }
        this.recent = this.held.filter(k => frames[k]?.voiced).map(k => frames[k].exactMidi);
        this.held = [];
        this.push(f.exactMidi);
        return;
      }
    }

    this.held = [];
    this.push(f.exactMidi);
  }

  private push(midi: number) {
    this.recent.push(midi);
    if (this.recent.length > 7) this.recent.shift();
  }
}

export function filterLatestFrames(frames: PitchFrame[]) {
  const n = frames.length;
  if (n < 3) return;
  const after = frames[n - 1];

  for (let m = 1; m <= MAX_GLITCH; m++) {
    const beforeIdx = n - 2 - m;
    if (beforeIdx < 0) break;
    const before = frames[beforeIdx];
    const run = frames.slice(beforeIdx + 1, n - 1);
    const voicedRun = run.filter(f => f.voiced);
    if (voicedRun.length === 0) continue;

    let glitch = false;
    if (before.voiced && after.voiced) {
      // Short excursion between two frames that agree with each other
      const agree = Math.abs(before.exactMidi - after.exactMidi) <= 1.5;
      const lo = Math.min(before.exactMidi, after.exactMidi);
      const hi = Math.max(before.exactMidi, after.exactMidi);
      glitch = (agree && voicedRun.every(f => Math.abs(f.exactMidi - after.exactMidi) > JUMP_INSIDE))
        // Dive far below both neighbours: sub-harmonic of two overlapping notes at a transition
        || voicedRun.every(f => f.exactMidi < lo - JUMP_AT_END)
        // Brief jump far above both neighbours (octave-up error)
        || (voicedRun.length <= 2 && voicedRun.every(f => f.exactMidi > hi + JUMP_AT_END));
    } else if (before.voiced && !after.voiced) {
      // Dive/jump right before the note stops
      glitch = voicedRun.every(f => Math.abs(f.exactMidi - before.exactMidi) > JUMP_AT_END);
    } else if (!before.voiced && !after.voiced) {
      // Isolated blip surrounded by silence
      glitch = m <= 2;
    }

    if (glitch) {
      for (let k = beforeIdx + 1; k < n - 1; k++) frames[k] = silence(frames[k]);
      return;
    }
  }
}

/**
 * Dead band for the drawn pitch line: the line only moves when the pitch has changed by more
 * than `cents` since the last registered value; smaller wobble is not drawn.
 */
export class PitchDeadband {
  private held: number | null = null;

  reset() {
    this.held = null;
  }

  /** Applies the dead band to the last frame of `frames` in place. */
  process(frames: PitchFrame[], cents: number) {
    const i = frames.length - 1;
    const f = frames[i];
    if (!f || !f.voiced || f.frequency <= 0) {
      this.held = null;
      return;
    }
    if (this.held === null || Math.abs(f.exactMidi - this.held) * 100 > cents) {
      this.held = f.exactMidi;
      return;
    }
    frames[i] = shiftFrame(f, this.held - f.exactMidi);
  }
}
