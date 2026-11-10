import { PitchFrame, PraatPitchEngine } from '../audio/PraatPitchEngine';
import { pitchSlices } from './ScoreProcessing';
import { ScoreNote, ScoreTrack } from './types';

export const SCORE_SAMPLE_RATE = 22050;
export function scorePitchFrames(notes: ScoreNote[], duration: number, isPolyphonic: boolean): PitchFrame[] {
  if (isPolyphonic) return [];
  const slices = pitchSlices(notes);
  let i = 0;
  const frames: PitchFrame[] = [];
  for (let step = 0; step <= Math.ceil(duration * 100); step++) {
    const timestamp = Math.min(duration, step / 100);
    while (i < slices.length && slices[i].end <= timestamp + 1e-8) i++;
    const slice = slices[i]?.start <= timestamp + 1e-8 ? slices[i] : undefined;
    const note = slice?.notes[0];
    const frequency = note ? PraatPitchEngine.midiToFrequency(note.midi) : 0;
    const named = note ? PraatPitchEngine.frequencyToNote(frequency) : null;
    frames.push({ timestamp, frequency, exactMidi: note?.midi ?? 0, nearestMidi: note ? Math.round(note.midi) : 0,
      noteName: named?.noteName ?? '—', cents: note ? (note.midi - Math.round(note.midi)) * 100 : 0,
      voiced: !!note, strength: note ? 1 : 0, intensity: note ? note.velocity : 0 });
  }
  return frames;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Periodic open-vowel waveform: fixed pitch, formant-shaped harmonics, no vibrato. */
function vowel(midi: number): Float32Array {
  const hz = PraatPitchEngine.midiToFrequency(midi), table = new Float32Array(2048);
  const harmonics = Math.min(70, Math.floor((SCORE_SAMPLE_RATE / 2 - 100) / hz));
  for (let h = 1; h <= harmonics; h++) {
    const f = hz * h;
    const formant = 0.18 + 1.5 * Math.exp(-(((f - 800) / 230) ** 2))
      + Math.exp(-(((f - 1150) / 280) ** 2)) + 0.5 * Math.exp(-(((f - 2900) / 450) ** 2));
    const amplitude = formant / h;
    for (let i = 0; i < table.length; i++) table[i] += Math.sin(2 * Math.PI * h * i / table.length) * amplitude;
  }
  const peak = table.reduce((p, v) => Math.max(p, Math.abs(v)), 0) || 1;
  return table.map(v => v / peak);
}

export async function renderScoreTrack(track: ScoreTrack, context: BaseAudioContext, signal: AbortSignal, progress: (fraction: number) => void) {
  const sr = SCORE_SAMPLE_RATE;
  if (!(track.duration > 0) || track.duration > 3600) throw new Error('Import a score of at most one hour at a time.');
  const data = new Float32Array(Math.ceil(track.duration * sr));
  const waves = new Map<number, Float32Array>();
  const polyphony = pitchSlices(track.notes).reduce((n, s) => Math.max(n, s.notes.length), 1);
  const gain = 0.35 / Math.sqrt(polyphony);
  let operations = 0;
  for (const [ni, note] of track.notes.entries()) {
    signal.throwIfAborted();
    if (!waves.has(note.midi)) waves.set(note.midi, vowel(note.midi));
    const table = waves.get(note.midi)!;
    const frequency = PraatPitchEngine.midiToFrequency(note.midi);
    const start = Math.round(note.start * sr), end = Math.min(data.length, Math.round(note.end * sr));
    const attack = Math.min(sr * 0.018, (end - start) / 4), release = Math.min(sr * 0.035, (end - start) / 4);
    for (let at = start; at < end; at++) {
      const elapsed = at - start;
      const phase = (elapsed * frequency / sr % 1) * table.length;
      const left = Math.floor(phase), mix = phase - left;
      const sample = table[left] * (1 - mix) + table[(left + 1) % table.length] * mix;
      const envelope = Math.min(1, elapsed / Math.max(1, attack), (end - at) / Math.max(1, release));
      data[at] += sample * envelope * gain * note.velocity;
      if (++operations >= 250_000) {
        operations = 0;
        progress((ni + (at - start) / Math.max(1, end - start)) / Math.max(1, track.notes.length));
        await new Promise(r => setTimeout(r, 0));
        signal.throwIfAborted();
      }
    }
  }
  let peak = 1;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.95) for (let i = 0; i < data.length; i++) data[i] *= 0.95 / peak;
  signal.throwIfAborted();
  const audioBuffer = context.createBuffer(1, data.length, sr);
  audioBuffer.copyToChannel(data, 0);
  const blob = encodeWav(data, sr);
  const pitchFrames = scorePitchFrames(track.notes, track.duration, track.isPolyphonic);
  progress(1);
  return { audioBuffer, blob, pitchFrames };
}
