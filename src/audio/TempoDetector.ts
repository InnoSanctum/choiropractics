/**
 * Tempo (BPM) and beat-phase estimation.
 *
 * Builds an onset-strength envelope from energy rises in the audio plus note starts from the
 * pitch track (helps legato singing where energy barely changes), autocorrelates it to find
 * the beat period (with a mild preference for moderate tempos), then finds the beat phase.
 */

import { PitchFrame } from './PraatPitchEngine';
import { NoteGridRenderer } from '../visualizer/NoteGridRenderer';

export interface TempoResult {
  bpm: number;
  /** Time of a downbeat (first beat of a bar, seconds) - beats fall on firstBeat + n * 60 / bpm */
  firstBeat: number;
  confidence: number; // 0..1
}

const HOP = 0.01; // 10 ms envelope resolution

export function detectTempo(audio: AudioBuffer, pitchFrames: PitchFrame[] = [], beatsPerBar = 4): TempoResult | null {
  const sr = audio.sampleRate;
  const len = audio.length;
  const hop = Math.round(HOP * sr);
  const frames = Math.floor(len / hop);
  if (frames < 300) return null; // < 3 s of audio

  const chans: Float32Array[] = [];
  for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));

  // 1. Log-energy per hop and its half-wave rectified rise
  const logE = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < hop; i++) {
      let v = 0;
      for (const ch of chans) v += ch[start + i];
      sum += v * v;
    }
    logE[f] = Math.log(1e-9 + sum / hop);
  }
  const env = new Float32Array(frames);
  for (let f = 2; f < frames; f++) {
    // Rise over 20 ms (robust to slow attacks)
    env[f] = Math.max(0, logE[f] - Math.max(logE[f - 1], logE[f - 2] * 0.5 + logE[f - 1] * 0.5));
  }
  // Cap rises: a note after silence produces a huge log-energy jump, which would make every
  // post-rest pickup look like the strongest beat. Limit to 2x the median attack strength.
  const peaks: number[] = [];
  for (let f = 1; f < frames - 1; f++) {
    if (env[f] > 0.05 && env[f] > env[f - 1] && env[f] >= env[f + 1]) peaks.push(env[f]);
  }
  if (peaks.length > 4) {
    peaks.sort((a, b) => a - b);
    const cap = 2 * peaks[Math.floor(peaks.length / 2)];
    for (let f = 0; f < frames; f++) env[f] = Math.min(env[f], cap);
  }
  let envMax = 0;
  for (let f = 0; f < frames; f++) envMax = Math.max(envMax, env[f]);

  // 2. Note starts from the pitch track.
  //    `env` gets equal impulses (for the beat period); `accent` weights each note start by the
  //    note's length - long notes tend to fall on strong beats, which resolves the beat phase
  //    (on-beat vs off-beat eighths) and the downbeat.
  const accent = new Float32Array(frames);
  if (pitchFrames.length > 0) {
    const impulse = envMax > 0 ? envMax * 0.6 : 1;
    const segs = NoteGridRenderer.getSegments(pitchFrames);
    // Onset estimate: if a note follows the previous one almost directly, the transition frames
    // were removed by the pitch clean-up, so the real attack is right after the previous note ended.
    const onsets = segs.map((seg, k) => {
      const prev = segs[k - 1];
      return prev && seg.startTime - prev.endTime < 0.15 ? Math.min(seg.startTime, prev.endTime + 0.02) : seg.startTime;
    });
    for (let k = 0; k < segs.length; k++) {
      const rawIdx = Math.round(segs[k].startTime / HOP);
      if (rawIdx >= 0 && rawIdx < frames) env[rawIdx] += impulse;

      const idx = Math.round(onsets[k] / HOP);
      if (idx < 0 || idx >= frames) continue;
      // Note length = until the next note starts (or its own end if a rest follows)
      const nextGap = segs[k + 1] ? segs[k + 1].startTime - segs[k].endTime : Infinity;
      const length = nextGap < 0.15 ? onsets[k + 1] - onsets[k] : segs[k].endTime - onsets[k];
      // Long notes weigh much more (half notes on strong beats outweigh off-beat eighths)
      accent[idx] += 3 * impulse * Math.min(8, Math.max(0.5, Math.pow(length / 0.25, 1.5)));
    }
  }

  // Remove slowly varying baseline
  const mean = env.reduce((a, b) => a + b, 0) / frames;
  for (let f = 0; f < frames; f++) env[f] = Math.max(0, env[f] - mean);
  // Energy only breaks ties for the phase; note lengths decide
  for (let f = 0; f < frames; f++) accent[f] += 0.3 * env[f];

  // 3. Autocorrelation over plausible beat periods (40..220 BPM)
  const minLag = Math.floor(60 / 220 / HOP);
  const maxLag = Math.ceil(60 / 40 / HOP);
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = minLag; lag < ac.length; lag++) {
    let s = 0;
    for (let f = 0; f + lag < frames; f++) s += env[f] * env[f + lag];
    ac[lag] = s / (frames - lag);
  }
  let ac0 = 0;
  for (let f = 0; f < frames; f++) ac0 += env[f] * env[f];
  ac0 /= frames;
  if (ac0 <= 0) return null;

  // Score: peak + half weight of its double (metrical support), times a log-normal tempo prior around 110 BPM
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * HOP);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.7, 2));
    const score = (ac[lag] + 0.5 * ac[Math.min(ac.length - 1, lag * 2)]) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return null;

  // Parabolic refinement of the period
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const d = a - 2 * b + c;
    if (d < 0) period = bestLag + 0.5 * (a - c) / d;
  }

  // 4. Fine period + beat phase: the beat grid (within ±3% of the estimate) that collects the
  //    most onset energy. Autocorrelation alone is biased by a few percent on short excerpts.
  const combScore = (p: number, ph: number, curve: Float32Array = accent) => {
    let s = 0;
    for (let t = ph; t < frames; t += p) {
      const i = Math.round(t);
      // Tolerance window of ±50 ms around each beat
      s += Math.max(curve[i] || 0, 0.7 * (curve[i - 1] || 0), 0.7 * (curve[i + 1] || 0),
        0.5 * (curve[i - 2] || 0), 0.5 * (curve[i + 2] || 0), 0.35 * (curve[i - 3] || 0), 0.35 * (curve[i + 3] || 0),
        0.2 * (curve[i - 4] || 0), 0.2 * (curve[i + 4] || 0), 0.1 * (curve[i - 5] || 0), 0.1 * (curve[i + 5] || 0));
    }
    return s;
  };
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  const coarsePeriod = period;
  for (let p = coarsePeriod * 0.97; p <= coarsePeriod * 1.03; p += 0.05) {
    for (let ph = 0; ph < p; ph += 1) {
      // Normalize by beat count so shorter periods are not favoured
      const s = combScore(p, ph, env) * (p / coarsePeriod);
      if (s > bestPhaseScore) {
        bestPhaseScore = s;
        bestPhase = ph;
        period = p;
      }
    }
  }

  // Beat phase at that period from the length-weighted accents (on-beat vs off-beat)
  bestPhaseScore = -Infinity;
  for (let ph = 0; ph < period; ph += 1) {
    const s = combScore(period, ph);
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestPhase = ph;
    }
  }

  // 5. Downbeat: which beat of the bar collects the most (length-weighted) note starts
  const bar = period * Math.max(1, beatsPerBar);
  let bestBarPhase = bestPhase;
  let bestBarScore = -Infinity;
  for (let k = 0; k < beatsPerBar; k++) {
    const ph = bestPhase + k * period;
    const s = combScore(bar, ph % bar);
    if (s > bestBarScore) {
      bestBarScore = s;
      bestBarPhase = ph % bar;
    }
  }

  const bpm = 60 / (period * HOP);
  const confidence = Math.max(0, Math.min(1, ac[bestLag] / ac0));
  return {
    bpm: Math.round(bpm * 10) / 10,
    firstBeat: bestBarPhase * HOP,
    confidence
  };
}
