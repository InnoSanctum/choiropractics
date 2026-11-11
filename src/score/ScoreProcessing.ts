import { MAX_TRACKS, ParsedScore, PartStrategy, ScoreNote, ScorePart, ScoreTrack, TempoPoint } from './types';

const EPS = 1e-7;
/** An interval sweep handles chords, separate notation voices, and unequal note lengths. */
export function pitchSlices(notes: ScoreNote[]): { start: number; end: number; notes: ScoreNote[] }[] {
  const points = new Map<number, { starts: ScoreNote[]; ends: ScoreNote[] }>();
  for (const note of notes) {
    for (const [time, key] of [[note.start, 'starts'], [note.end, 'ends']] as const) {
      const t = Math.round(time * 1e8) / 1e8;
      if (!points.has(t)) points.set(t, { starts: [], ends: [] });
      points.get(t)![key].push(note);
    }
  }
  const times = [...points.keys()].sort((a, b) => a - b);
  const active = new Map<string, ScoreNote>();
  return times.slice(0, -1).map((start, i) => {
    const point = points.get(start)!;
    point.ends.forEach(n => active.delete(n.id));
    point.starts.forEach(n => active.set(n.id, n));
    const unique = new Map<number, ScoreNote>();
    [...active.values()].sort((a, b) => a.start - b.start).forEach(n => unique.set(n.midi, n));
    return { start, end: times[i + 1], notes: [...unique.values()].sort((a, b) => b.midi - a.midi) };
  });
}

export function classifyPart(name: string, instrument: string, notes: ScoreNote[]): Pick<ScorePart, 'kind' | 'maxPolyphony' | 'strategy' | 'reason'> {
  const maxPolyphony = pitchSlices(notes).reduce((n, s) => Math.max(n, s.notes.length), 1);
  const label = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const metadata = instrument.toLowerCase();
  const vocalName = /^(s|a|t|b|sa|sb|sab|satb)(\s*[12iv]+)?$/.test(label)
    || /\b(soprano|alto|tenor|baritone|bass|mezzo|contralto|cantus|basso|vocal|voice|choir|chorus)\b/.test(label);
  const vocalMetadata = /(^|[.\s_-])(voice|voices|choir|vocal)([.\s_-]|$)/.test(metadata)
    || /^(soprano|alto|tenor|baritone|bass)$/.test(metadata.split(/\s+/)[0]);
  const instrumentName = /\b(piano|pianoforte|guitar|accordion|accordeon|organ|harp|keyboard|synth|celesta|clav|trumpet|trombone|tuba|horn|flute|piccolo|clarinet|oboe|bassoon|sax|saxophone|violin|viola|cello|violoncello|contrabass|double bass|electric bass|bass guitar|percussion|drum|timpani|marimba|xylophone|vibraphone|euphonium|cornet|flugelhorn|strings)\b/.test(label);
  const primaryInstrument = metadata.split(/\s+/)[0];
  const instrumentalMetadata = !!metadata && !vocalMetadata && !/^(unknown|generic|instrument|part|staff|untitled)(?:[._-]*\d+)?$/.test(primaryInstrument);
  // Explicit instrument names win over words such as "alto" in "Alto Saxophone".
  if (instrumentName || (!vocalName && instrumentalMetadata)) {
    return { kind: 'instrument', maxPolyphony, strategy: 'keep', reason: 'Named instrument: keep the complete part together.' };
  }
  if (vocalName || vocalMetadata) return { kind: 'vocal', maxPolyphony, strategy: 'split', reason: 'Named vocal part: split divisi by descending pitch.' };
  if (maxPolyphony > 3) return { kind: 'unknown', maxPolyphony, strategy: 'keep', reason: 'Unlabeled part with four or more simultaneous notes: keep together.' };
  return { kind: 'unknown', maxPolyphony, strategy: 'split', reason: 'Unlabeled part with at most three simultaneous notes: split by pitch.' };
}

export function splitPart(part: ScorePart, strategy: PartStrategy): ScoreNote[][] {
  if (strategy === 'keep' || part.maxPolyphony <= 1) return [part.notes.map(n => ({ ...n })).sort((a, b) => a.start - b.start || b.midi - a.midi)];
  const tracks: ScoreNote[][] = Array.from({ length: part.maxPolyphony }, () => []);
  for (const slice of pitchSlices(part.notes)) {
    for (let rank = 0; rank < tracks.length; rank++) {
      const note = slice.notes.length === 1 ? slice.notes[0] : slice.notes[rank];
      if (!note) continue;
      const previous = tracks[rank].at(-1);
      if (previous && previous.id === note.id && Math.abs(previous.end - slice.start) < EPS) previous.end = slice.end;
      else tracks[rank].push({ ...note, start: slice.start, end: slice.end });
    }
  }
  return tracks;
}

function timeConverter(tempos: TempoPoint[], fallbackBpm: number) {
  const segments = [{ beat: 0, bpm: fallbackBpm, seconds: 0 }];
  for (const point of tempos) {
    const previous = segments.at(-1)!;
    segments.push({ ...point, bpm: point.bpm || fallbackBpm, seconds: previous.seconds + (point.beat - previous.beat) * 60 / previous.bpm });
  }
  return (beat: number) => {
    let low = 0, high = segments.length;
    while (low < high) { const mid = (low + high) >> 1; if (segments[mid].beat <= beat) low = mid + 1; else high = mid; }
    const point = segments[Math.max(0, low - 1)];
    return point.seconds + (beat - point.beat) * 60 / point.bpm;
  };
}

export const beatToSeconds = (beat: number, tempos: TempoPoint[], fallbackBpm: number) => timeConverter(tempos, fallbackBpm)(beat);

export function buildScoreTracks(score: ParsedScore, strategies: Record<string, PartStrategy>, fallbackBpm: number): ScoreTrack[] {
  if (!Number.isFinite(fallbackBpm) || fallbackBpm < 20 || fallbackBpm > 400) throw new Error('Choose a tempo between 20 and 400 BPM.');
  const count = score.parts.reduce((n, p) => n + ((strategies[p.id] ?? p.strategy) === 'split' ? p.maxPolyphony : 1), 0);
  if (count > MAX_TRACKS) throw new Error(`This selection creates ${count} tracks. Keep more parts together or select fewer parts (maximum ${MAX_TRACKS}).`);
  const secondsAt = timeConverter(score.tempos, fallbackBpm);
  const duration = secondsAt(score.durationBeats);
  const result: ScoreTrack[] = [];
  for (const part of score.parts) {
    const voices = splitPart(part, strategies[part.id] ?? part.strategy);
    voices.forEach((notes, i) => result.push({
      name: voices.length > 1 ? `${part.name} ${i + 1}` : part.name,
      isPolyphonic: voices.length === 1 && part.maxPolyphony > 1,
      duration,
      notes: notes.map(n => ({ ...n, start: secondsAt(n.start), end: secondsAt(n.end) }))
    }));
  }
  if (result.length > MAX_TRACKS) throw new Error(`This selection creates ${result.length} tracks. Keep more parts together or select fewer parts (maximum ${MAX_TRACKS}).`);
  if (!result.length || !result.some(t => t.notes.length)) throw new Error('No playable pitched notes were found in this score.');
  return result;
}
