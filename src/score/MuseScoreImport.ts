import { strFromU8, unzipSync } from 'fflate';
import { child, children, descendants, parseXml, value, XmlNode } from './xml';
import { classifyPart } from './ScoreProcessing';
import { ParsedScore, ScoreNote, ScorePart, TempoPoint } from './types';

const EPS = 1e-7;
const MAX_BEATS = 40_000;
const durations: Record<string, number> = { long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125, '256th': 0.015625, '512th': 0.0078125, '1024th': 0.00390625 };
function fraction(text: string): number {
  const [n, d = 1] = text.split('/').map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) throw new Error(`Invalid musical duration: ${text}`);
  return n / d;
}
function numeric(node: XmlNode, tag: string, fallback: number) {
  const text = value(node, tag);
  if (!text) return fallback;
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${tag} in the score.`);
  return n;
}

/** Read only the main score, never a generated excerpt or a thumbnail. */
export function readScoreArchive(bytes: Uint8Array): string {
  if (bytes.length > 32_000_000) throw new Error('The score file is too large (maximum 32 MB).');
  let entries: Record<string, Uint8Array>;
  let xmlBytes = 0;
  try {
    entries = unzipSync(bytes, { filter: file => {
      if (file.name !== 'META-INF/container.xml' && !file.name.toLowerCase().endsWith('.mscx')) return false;
      xmlBytes += file.originalSize;
      if (file.originalSize > 16_000_000 || xmlBytes > 24_000_000) throw new Error('Score XML exceeds the import size limit.');
      if (file.name.split(/[\\/]/).includes('..') || file.name.startsWith('/')) throw new Error('Invalid score path in the archive.');
      return true;
    } });
  } catch (error) { throw new Error(`Could not open the MuseScore archive: ${error instanceof Error ? error.message : 'invalid ZIP file'}`); }
  if (entries['META-INF/container.xml']) {
    const manifest = parseXml(strFromU8(entries['META-INF/container.xml']));
    const root = descendants(manifest, 'rootfile').find(n => n.attrs['full-path']?.toLowerCase().endsWith('.mscx'));
    if (root) {
      const path = root.attrs['full-path'];
      if (!entries[path]) throw new Error('The main score declared in the archive is missing.');
      return strFromU8(entries[path]);
    }
  }
  const candidates = Object.keys(entries).filter(n => !n.includes('/') && n.toLowerCase().endsWith('.mscx'));
  if (candidates.length !== 1) throw new Error('Could not identify a unique main score in this archive. Export an uncompressed .mscx file.');
  return strFromU8(entries[candidates[0]]);
}

export async function readMuseScore(file: File): Promise<ParsedScore> {
  if (file.size > 32_000_000) throw new Error('The score file is too large (maximum 32 MB).');
  const ext = file.name.split('.').at(-1)?.toLowerCase();
  if (ext !== 'mscz' && ext !== 'mscx') throw new Error('Choose a MuseScore .mscz or .mscx file.');
  return parseMuseScore(ext === 'mscz' ? readScoreArchive(new Uint8Array(await file.arrayBuffer())) : await file.text());
}

interface MeasureInfo { start: number; length: number; node: XmlNode; repeatStart: boolean; repeatEnd: number }

export function parseMuseScore(xml: string): ParsedScore {
  const root = parseXml(xml);
  const major = Number(root.attrs.version?.split('.')[0]);
  if (root.tag !== 'museScore' || ![2, 3, 4].includes(major)) throw new Error('Supported files are MuseScore 2, 3, and 4 scores. Save this file in MuseScore and try again.');
  const score = child(root, 'Score');
  if (!score) throw new Error('This file does not contain a MuseScore score.');
  if (descendants(score, 'Jump').length || descendants(score, 'Volta').length || descendants(score, 'Spanner').some(n => ['Volta', 'Ottava'].includes(n.attrs.type)) || descendants(score, 'Ottava').length) {
    throw new Error('This score uses alternate endings, navigation jumps, or octave lines. Expand these in MuseScore before importing. Simple repeats are supported.');
  }
  const staves = children(score, 'Staff');
  if (!staves.length) throw new Error('The score has no staves.');
  const measureCount = Math.max(...staves.map(s => children(s, 'Measure').length));
  if (!measureCount || measureCount > 5000) throw new Error('The score must contain between 1 and 5,000 measures.');
  const staffMeasures = staves.map(s => children(s, 'Measure'));
  const measures: MeasureInfo[] = [];
  let beat = 0, meter = 4, initialMeter = 4;
  for (let i = 0; i < measureCount; i++) {
    const nodes = staffMeasures.map(ms => ms[i]).filter(Boolean);
    const sig = nodes.flatMap(n => descendants(n, 'TimeSig'))[0];
    if (sig) {
      meter = numeric(sig, 'sigN', 4) * 4 / numeric(sig, 'sigD', 4);
      if (!(meter > 0 && meter <= 64)) throw new Error('Unsupported time signature.');
      if (i === 0) initialMeter = meter;
    }
    const explicitLengths = nodes.filter(n => n.attrs.len).map(n => 4 * fraction(n.attrs.len));
    const length = explicitLengths[0] ?? meter;
    if (!(length > 0 && length <= 64) || explicitLengths.some(n => Math.abs(n - length) > EPS)) throw new Error(`Inconsistent duration in measure ${i + 1}.`);
    const repeatEnd = nodes.flatMap(n => descendants(n, 'endRepeat'))[0];
    measures.push({ start: beat, length, node: nodes[0], repeatStart: nodes.some(n => descendants(n, 'startRepeat').length > 0), repeatEnd: repeatEnd ? Number(repeatEnd.text || 2) : 0 });
    beat += length;
  }
  if (beat > MAX_BEATS) throw new Error('This score is too long to import in one session.');
  const tempos: TempoPoint[] = [];
  const warnings = new Set<string>();
  const divisions = numeric(score, 'Division', 480);
  if (!(divisions > 0)) throw new Error('Invalid score timing division.');
  let sequence = 0, nextStaff = 0;
  const parts: ScorePart[] = [];
  for (const [partIndex, node] of children(score, 'Part').entries()) {
    const instrumentNode = child(node, 'Instrument');
    const instrument = instrumentNode ? [instrumentNode.attrs.id, value(instrumentNode, 'instrumentId'), value(instrumentNode, 'longName'), value(instrumentNode, 'trackName')].filter(Boolean).join(' ') : '';
    const name = value(node, 'trackName') || (instrumentNode && value(instrumentNode, 'longName')) || `Part ${partIndex + 1}`;
    const definitions = children(node, 'Staff');
    const partStaves = definitions.map(def => {
      const fallback = staves[nextStaff++];
      return (def.attrs.id && staves.find(s => s.attrs.id === def.attrs.id)) || fallback;
    }).filter((s): s is XmlNode => !!s);
    const unpitched = !!((instrumentNode && value(instrumentNode, 'useDrumset') === '1') || definitions.some(s => child(s, 'StaffType')?.attrs.group === 'percussion'));
    if (unpitched) {
      warnings.add(`${name}: unpitched percussion is omitted; this importer renders pitched rehearsal audio.`);
    }
    const notes: ScoreNote[] = [];
    for (const staff of partStaves) {
      const tiePending = new Map<string, ScoreNote>();
      const dynamics = new Map<number, number>();
      const staffMs = children(staff, 'Measure');
      for (const [mi, measure] of staffMs.entries()) {
        const info = measures[mi];
        const voices = children(measure, 'voice');
        // MuseScore 2 stores rhythmic events directly inside Measure.
        const containers = voices.length ? voices : [measure];
        for (const [vi, voice] of containers.entries()) {
          let cursor = info.start, velocity = dynamics.get(vi) ?? 0.7;
          const tuplets = new Map(descendants(measure, 'Tuplet').filter(t => t.attrs.id).map(t => [t.attrs.id, t]));
          const ratio = (id: string, seen = new Set<string>()): number => {
            if (!id) return 1;
            const t = tuplets.get(id);
            if (!t || seen.has(id)) throw new Error(`Invalid tuplet in ${name}, measure ${mi + 1}.`);
            seen.add(id);
            const scale = numeric(t, 'normalNotes', 2) / numeric(t, 'actualNotes', 3);
            if (!(scale > 0 && scale <= 16)) throw new Error('Invalid tuplet ratio.');
            return scale * ratio(value(t, 'Tuplet'), seen);
          };
          for (const event of voice.children) {
            if (event.tag === 'tick') { cursor = Number(event.text) / divisions; continue; }
            if (event.tag === 'location') {
              if (numeric(event, 'measures', 0) !== 0) throw new Error('Cross-measure voice locations are not supported. Save the score in the current MuseScore format.');
              cursor += 4 * fraction(value(event, 'fractions', '0'));
              continue;
            }
            if (event.tag === 'Tempo') {
              const bpm = numeric(event, 'tempo', 0) * 60;
              if (bpm > 0 && bpm <= 1000) tempos.push({ beat: cursor, bpm });
              continue;
            }
            if (event.tag === 'Dynamic') {
              const levels: Record<string, number> = { ppp: 24, pp: 40, p: 52, mp: 64, mf: 80, f: 96, ff: 112, fff: 126 };
              const explicit = numeric(event, 'velocity', 0);
              velocity = Math.max(0.1, Math.min(1, (explicit > 0 ? explicit : levels[value(event, 'subtype')] ?? 89) / 127));
              dynamics.set(vi, velocity); continue;
            }
            if (event.tag === 'MeasureRepeat' || event.tag === 'RepeatMeasure') throw new Error('Expand measure-repeat symbols in MuseScore before importing.');
            if (event.tag !== 'Chord' && event.tag !== 'Rest') continue;
            if (event.children.some(n => /^(grace|acciaccatura|appoggiatura)/i.test(n.tag))) {
              if (unpitched) continue;
              throw new Error(`Grace notes in ${name} need to be written as ordinary notes before importing.`);
            }
            if (descendants(event, 'Tremolo').length || descendants(event, 'Ornament').length) warnings.add('Ornaments and tremolos use their written pitches and durations.');
            const type = value(event, 'durationType', 'quarter');
            let duration = type === 'measure' ? info.length : value(event, 'duration') ? 4 * fraction(value(event, 'duration')) : durations[type];
            if (!duration) throw new Error(`Unsupported duration ${type} in ${name}.`);
            if (type !== 'measure') duration *= (2 - 2 ** -numeric(event, 'dots', 0)) * ratio(value(event, 'Tuplet'));
            if (!Number.isFinite(cursor) || cursor < info.start - EPS || cursor + duration > info.start + info.length + EPS) throw new Error(`The rhythms in ${name}, measure ${mi + 1}, exceed the measure length. Check voice locations and tuplets in MuseScore.`);
            if (event.tag === 'Chord' && !unpitched) {
              for (const noteNode of children(event, 'Note')) {
                if (value(noteNode, 'play') === '0') continue;
                // MuseScore's stored MIDI pitch is sounding pitch; clefs/transposition are display data.
                const midi = numeric(noteNode, 'pitch', -1) + numeric(noteNode, 'tuning', 0) / 100;
                if (!(midi >= 0 && midi <= 127)) throw new Error(`Invalid note pitch in ${name}.`);
                const key = `${vi}:${midi}`;
                const previous = tiePending.get(key);
                const outgoing = !!child(noteNode, 'Tie') || children(noteNode, 'Spanner').some(s => s.attrs.type === 'Tie' && !!child(s, 'next'));
                let note: ScoreNote;
                if (previous && Math.abs(previous.end - cursor) < EPS) { previous.end = cursor + duration; note = previous; }
                else {
                  if (previous) throw new Error(`A non-contiguous tie in ${name} cannot be imported accurately.`);
                  note = { id: `note-${sequence++}`, start: cursor, end: cursor + duration, midi, velocity };
                  notes.push(note);
                  if (sequence > 200_000) throw new Error('The score contains too many notes to import in one session.');
                }
                if (outgoing) tiePending.set(key, note); else tiePending.delete(key);
              }
            }
            cursor += duration;
          }
        }
      }
      if (tiePending.size) warnings.add(`${name}: a tie at the end of the score has no following note.`);
    }
    if (!unpitched) parts.push({ id: `part-${partIndex}`, name, instrument, notes, ...classifyPart(name, instrument, notes) });
  }
  if (!parts.length) throw new Error('No pitched parts were found in the score.');
  if (parts.reduce((n, p) => n + p.notes.length, 0) > 200_000) throw new Error('The score contains too many notes to import in one session.');

  // One performance order for every staff. Nested simple repeats are bounded and expanded together.
  const order: number[] = [];
  const stack: { start: number; pass: number }[] = [];
  for (let i = 0; i < measures.length;) {
    if (order.length > 20_000) throw new Error('Repeat expansion is too long. Expand repeats in MuseScore first.');
    const m = measures[i];
    if (m.repeatStart && stack.at(-1)?.start !== i) stack.push({ start: i, pass: 1 });
    order.push(i);
    if (m.repeatEnd) {
      if (!Number.isInteger(m.repeatEnd) || m.repeatEnd < 2 || m.repeatEnd > 16) throw new Error('Unsupported repeat count.');
      if (!stack.length) stack.push({ start: 0, pass: 1 });
      const repeat = stack.at(-1)!;
      if (repeat.pass < m.repeatEnd) { repeat.pass++; i = repeat.start; continue; }
      stack.pop();
    }
    i++;
  }
  const tempoMap = new Map<number, number>();
  for (const t of tempos) {
    if (tempoMap.has(t.beat) && Math.abs(tempoMap.get(t.beat)! - t.bpm) > 0.01) throw new Error('Conflicting simultaneous tempo markings were found.');
    tempoMap.set(t.beat, t.bpm);
  }
  const sortedTempos = [...tempoMap].map(([beat, bpm]) => ({ beat, bpm })).sort((a, b) => a.beat - b.beat);
  let durationBeats = 0;
  const expandedTempos: TempoPoint[] = [];
  const addTempo = (point: TempoPoint) => {
    const previous = expandedTempos.at(-1);
    if (previous?.bpm === point.bpm) return;
    if (previous?.beat === point.beat) previous.bpm = point.bpm;
    else expandedTempos.push(point);
  };
  const expanded = parts.map(() => [] as ScoreNote[]);
  const continuations = parts.map(() => new Map<string, ScoreNote>());
  const byMeasure = parts.map(p => {
    const groups = measures.map(() => [] as ScoreNote[]);
    for (const note of p.notes) {
      let lo = 0, hi = measures.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (measures[mid].start + measures[mid].length <= note.start + EPS) lo = mid + 1; else hi = mid; }
      for (let mi = lo; mi < measures.length && measures[mi].start < note.end - EPS; mi++) groups[mi].push(note);
    }
    return groups;
  });
  for (const [occurrence, mi] of order.entries()) {
    const m = measures[mi];
    const inherited = sortedTempos.filter(t => t.beat <= m.start + EPS).at(-1);
    // Restore the score tempo at a repeat jump, rather than carrying the end tempo backwards.
    addTempo({ beat: durationBeats, bpm: inherited?.bpm ?? 0 });
    sortedTempos.filter(t => t.beat > m.start + EPS && t.beat < m.start + m.length - EPS).forEach(t => addTempo({ beat: durationBeats + t.beat - m.start, bpm: t.bpm }));
    parts.forEach((_, pi) => {
      for (const n of byMeasure[pi][mi]) {
        const start = durationBeats + Math.max(0, n.start - m.start);
        const end = durationBeats + Math.min(m.length, n.end - m.start);
        const previous = continuations[pi].get(n.id);
        if (previous && Math.abs(previous.end - start) < EPS && mi > 0 && order[occurrence - 1] === mi - 1) previous.end = end;
        else {
          const event = { ...n, id: `${n.id}@${occurrence}`, start, end };
          expanded[pi].push(event); continuations[pi].set(n.id, event);
        }
      }
    });
    durationBeats += m.length;
  }
  if (durationBeats > MAX_BEATS) throw new Error('The expanded score is too long to import.');
  const title = children(score, 'metaTag').find(n => n.attrs.name === 'workTitle')?.text || 'Imported score';
  return { title, parts: parts.map((p, i) => ({ ...p, notes: expanded[i] })), durationBeats, tempos: expandedTempos, beatsPerBar: initialMeter, warnings: [...warnings] };
}
