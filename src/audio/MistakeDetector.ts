/**
 * Finds the places where a sung take is off the target notes.
 *
 * A mistake is a stretch of at least MIN_DURATION where the (slightly smoothed) sung pitch is
 * more than `thresholdCents` away from the target note. Note starts are given a short grace
 * period, so scooping into a note is not counted. Each mistake reports where it begins, which
 * is what the diagram highlights.
 */

import { PitchFrame } from './PraatPitchEngine';

export interface TargetNote {
  startTime: number;
  endTime: number;
  /** Target pitch (fractional MIDI) */
  midi: number;
}

export interface PitchMistake {
  startTime: number;
  endTime: number;
  /** Sung pitch at the start of the mistake (MIDI) */
  sungMidi: number;
  /** Target pitch it was compared with (MIDI, already moved to the sung octave if octave-free) */
  targetMidi: number;
  /** Median deviation over the mistake, in cents (negative = flat) */
  cents: number;
}

export interface MistakeOptions {
  thresholdCents: number;
  /** Singing the target in any octave is fine */
  anyOctave: boolean;
}

// Both scale down for short notes (an eighth note at 120 BPM lasts only 0.25 s)
const MIN_DURATION = 0.15;   // s: shorter excursions (scoops, glitches) are ignored
const ONSET_GRACE = 0.1;     // s: time allowed to settle onto a new target note
const BRIDGE_GAP = 0.06;     // s: in-tune blips shorter than this do not end a mistake
const SMOOTH_WINDOW = 0.18;  // s: ~one vibrato cycle; the sung pitch is the median over it
const LATE_TOLERANCE = 0.1;  // s: singing the previous note this long into the next one is fine

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Index of the target note playing at time t (targets sorted by start time), or -1. */
const targetAt = (targets: TargetNote[], t: number) => {
  let lo = 0;
  let hi = targets.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (targets[mid].startTime <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 && t <= targets[best].endTime + 0.02 ? best : -1;
};

export function findMistakes(frames: PitchFrame[], targets: TargetNote[], opts: MistakeOptions): PitchMistake[] {
  const result: PitchMistake[] = [];
  if (frames.length === 0 || targets.length === 0) return result;
  const threshold = opts.thresholdCents / 100;

  let run: { minDuration: number; start: number; firstBad: number; end: number; startIdx: number; devs: number[]; target: number; sung: number } | null = null;
  let lastBad = -Infinity;
  let lastTargetIdx = -1;
  let noteStart = 0;     // first sung frame on the current target note
  let seenGood = false;  // an in-tune frame was seen on the current target note

  const close = () => {
    if (run && run.end - run.firstBad >= run.minDuration) {
      result.push({
        startTime: run.start,
        endTime: run.end,
        sungMidi: run.sung,
        targetMidi: run.target,
        cents: Math.round(median(run.devs) * 100)
      });
    }
    run = null;
  };

  // Sung pitch over about one vibrato cycle around frame i, limited to the current target note,
  // as [mean, median]. The mean cancels vibrato, the median ignores the edge of a neighbouring
  // note; a wrong note is off in both, so the more lenient of the two is used.
  const smoothAt = (i: number, from: number, to: number) => {
    const t = frames[i].timestamp;
    const lo = Math.max(from, t - SMOOTH_WINDOW / 2);
    const hi = Math.min(to, t + SMOOTH_WINDOW / 2);
    const vals: number[] = [];
    for (let k = i; k >= 0 && frames[k].timestamp >= lo; k--) {
      if (frames[k].voiced && frames[k].exactMidi > 0) vals.push(frames[k].exactMidi);
    }
    for (let k = i + 1; k < frames.length && frames[k].timestamp <= hi; k++) {
      if (frames[k].voiced && frames[k].exactMidi > 0) vals.push(frames[k].exactMidi);
    }
    if (vals.length === 0) return [frames[i].exactMidi];
    return [vals.reduce((a, b) => a + b, 0) / vals.length, median(vals)];
  };

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const t = f.timestamp;
    const ti = f.voiced && f.exactMidi > 0 ? targetAt(targets, t) : -1;

    if (ti < 0) {
      // Silence or no target note: a running mistake ends here
      if (run) close();
      lastTargetIdx = -1;
      continue;
    }
    if (ti !== lastTargetIdx) {
      // A new target note starts a new comparison
      if (run) close();
      noteStart = t;
      seenGood = false;
    }
    lastTargetIdx = ti;

    const target = targets[ti];
    const noteLength = target.endTime - target.startTime;
    if (t - target.startTime < Math.min(ONSET_GRACE, noteLength * 0.25)) continue;

    const sungValues = smoothAt(i, target.startTime, target.endTime + 0.02);
    // Compare with the current note, or the previous one if the singer is slightly late
    const candidates = [target.midi];
    const earlier = targetAt(targets, t - LATE_TOLERANCE);
    if (earlier >= 0 && earlier !== ti) candidates.push(targets[earlier].midi);
    const sung = sungValues[sungValues.length - 1];
    let goal = target.midi;
    let dev = Infinity;
    for (const c of candidates) {
      for (const v of sungValues) {
        const g = opts.anyOctave ? c + 12 * Math.round((v - c) / 12) : c;
        if (Math.abs(v - g) < Math.abs(dev)) {
          dev = v - g;
          if (c === target.midi) goal = g;
        }
      }
    }
    // A frame stands for the time until the next one (live mic frames are ~40 ms apart)
    const next = frames[i + 1];
    const frameEnd = next && next.timestamp - t < 0.1 ? next.timestamp : t + 0.01;

    if (Math.abs(dev) > threshold) {
      // Off from the very start of the note: the mistake begins where the note was started
      if (!run) run = { minDuration: Math.min(MIN_DURATION, noteLength * 0.35), start: seenGood ? t : noteStart, firstBad: t, end: t, startIdx: i, devs: [], target: goal, sung };
      run.end = frameEnd;
      run.devs.push(dev);
      lastBad = t;
    } else {
      seenGood = true;
      if (run && t - lastBad > BRIDGE_GAP) close();
    }
  }
  close();
  return result;
}

/**
 * Caches mistakes per take. A take that is still being recorded grows, so the cache is keyed by
 * the frame count as well as the settings.
 */
export class MistakeCache {
  private cache = new WeakMap<PitchFrame[], { key: string; length: number; targets: TargetNote[]; mistakes: PitchMistake[] }>();

  get(frames: PitchFrame[], targets: TargetNote[], opts: MistakeOptions): PitchMistake[] {
    const key = `${opts.thresholdCents}|${opts.anyOctave}`;
    const hit = this.cache.get(frames);
    if (hit && hit.key === key && hit.length === frames.length && hit.targets === targets) return hit.mistakes;
    const mistakes = findMistakes(frames, targets, opts);
    this.cache.set(frames, { key, length: frames.length, targets, mistakes });
    return mistakes;
  }
}
