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
  /** Time of a beat (seconds) - beats fall on firstBeat + n * 60 / bpm */
  firstBeat: number;
  confidence: number; // 0..1
}

const HOP = 0.01; // 10 ms envelope resolution

export function detectTempo(audio: AudioBuffer, pitchFrames: PitchFrame[] = []): TempoResult | null {
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
  let envMax = 0;
  for (let f = 0; f < frames; f++) envMax = Math.max(envMax, env[f]);

  // 2. Note starts from the pitch track
  if (pitchFrames.length > 0) {
    const impulse = envMax > 0 ? envMax * 0.6 : 1;
    for (const seg of NoteGridRenderer.getSegments(pitchFrames)) {
      const idx = Math.round(seg.startTime / HOP);
      if (idx >= 0 && idx < frames) env[idx] += impulse;
    }
  }

  // Remove slowly varying baseline
  const mean = env.reduce((a, b) => a + b, 0) / frames;
  for (let f = 0; f < frames; f++) env[f] = Math.max(0, env[f] - mean);

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
  const combScore = (p: number, ph: number) => {
    let s = 0;
    for (let t = ph; t < frames; t += p) {
      const i = Math.round(t);
      // Small tolerance window around each beat
      s += Math.max(env[i] || 0, 0.5 * (env[i - 1] || 0), 0.5 * (env[i + 1] || 0));
    }
    return s;
  };
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  const coarsePeriod = period;
  for (let p = coarsePeriod * 0.97; p <= coarsePeriod * 1.03; p += 0.05) {
    for (let ph = 0; ph < p; ph += 1) {
      // Normalize by beat count so shorter periods are not favoured
      const s = combScore(p, ph) * (p / coarsePeriod);
      if (s > bestPhaseScore) {
        bestPhaseScore = s;
        bestPhase = ph;
        period = p;
      }
    }
  }

  const bpm = 60 / (period * HOP);
  const confidence = Math.max(0, Math.min(1, ac[bestLag] / ac0));
  return {
    bpm: Math.round(bpm * 10) / 10,
    firstBeat: bestPhase * HOP,
    confidence
  };
}
