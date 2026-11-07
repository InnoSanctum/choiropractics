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
