import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { loadTypescript } from './load-typescript.mjs';

const { parseMuseScore, readScoreArchive } = loadTypescript('src/score/MuseScoreImport.ts');
const { classifyPart, buildScoreTracks, splitPart, beatToSeconds } = loadTypescript('src/score/ScoreProcessing.ts');
const { renderScoreTrack, scorePitchFrames, SCORE_SAMPLE_RATE } = loadTypescript('src/score/ScoreAudio.ts');
const { visibleDiagramTracks, emptyTrack } = loadTypescript('src/audio/TrackState.ts');
const { PraatPitchEngine } = loadTypescript('src/audio/PraatPitchEngine.ts');

const chord = (pitches, duration = 'quarter', extra = '') => `<Chord><durationType>${duration}</durationType>${extra}${[].concat(pitches).map(p => `<Note><pitch>${p}</pitch></Note>`).join('')}</Chord>`;
const measure = (music, attrs = '') => `<Measure ${attrs}><voice>${music}</voice></Measure>`;
function document(parts, version = '4.70') {
  let id = 0;
  const assigned = parts.map(p => ({ ...p, ids: (p.staves ?? [p.music]).map(() => ++id) }));
  return `<museScore version="${version}"><Score><Division>480</Division>${assigned.map(p => `<Part>${p.ids.map(i => `<Staff id="${i}"/>`).join('')}<trackName>${p.name}</trackName>${p.instrument ? `<Instrument id="${p.instrument}"><instrumentId>${p.instrument}</instrumentId>${p.instrumentExtra ?? ''}</Instrument>` : ''}</Part>`).join('')}${assigned.map(p => (p.staves ?? [p.music]).map((m, i) => `<Staff id="${p.ids[i]}">${m}</Staff>`).join('')).join('')}</Score></museScore>`;
}
const note = (id, midi, start, end) => ({ id, midi, start, end, velocity: 0.7 });
const basic = music => parseMuseScore(document([{ name: 'Soprano', music }]));

test('the requested divisi example duplicates shared notes before and after every fork', () => {
  const events = [69, 71, 72, [69, 74], 71, [69, 72]];
  const score = basic(measure(events.slice(0, 4).map(p => chord(p)).join('')) + measure(events.slice(4).map(p => chord(p)).join('')));
  const tracks = buildScoreTracks(score, {}, 120);
  assert.deepEqual(tracks.map(t => t.name), ['Soprano 1', 'Soprano 2']);
  assert.deepEqual(tracks.map(t => t.notes.map(n => n.midi)), [[69, 71, 72, 74, 71, 72], [69, 71, 72, 69, 71, 69]]);
  assert.deepEqual(tracks[0].notes.map(n => n.start), [0, 0.5, 1, 1.5, 2, 2.5]);
  assert.equal(tracks[0].duration, 4);
});

test('ranked splitting handles asynchronous overlaps, unisons, and three-note forks', () => {
  const notes = [note('held', 60, 0, 4), note('high', 72, 1, 2), note('middle', 67, 1, 3), note('unison', 60, 0, 1)];
  const part = { name: 'Alto', notes, ...classifyPart('Alto', '', notes) };
  const split = splitPart(part, 'split');
  assert.equal(split.length, 3);
  assert.deepEqual(split.map(v => v.find(n => n.start <= 1.5 && n.end > 1.5)?.midi), [72, 67, 60]);
  assert.ok(split.every(v => v.some(n => n.start === 0 && n.midi === 60)));
  assert.ok(split.every(v => v.some(n => n.end === 4 && n.midi === 60)));
  assert.equal(split[2].some(n => n.start < 3 && n.end > 2), false); // Two pitches into three ranked lanes.
});

test('author names and instrument metadata take precedence over polyphony heuristics', () => {
  const notes = [60, 64, 67, 72].map((m, i) => note(`${i}`, m, 0, 1));
  for (const name of ['S', 'A', 'T', 'B', 'Soprano 1', 'Soprano 2', 'Baritone', 'SATB', 'SAB', 'SB']) {
    assert.equal(classifyPart(name, '', notes).strategy, 'split', name);
  }
  for (const name of ['Piano', 'Guitar', 'Electric Bass', 'Accordeon', 'Organ', 'Trumpet', 'Tuba', 'Flute', 'Violin', 'Viola', 'Alto Saxophone']) {
    assert.equal(classifyPart(name, '', notes).strategy, 'keep', name);
  }
  assert.equal(classifyPart('Part 1', 'wind.brass.trumpet', notes).strategy, 'keep');
  assert.equal(classifyPart('Part 1', 'voice.soprano', notes).strategy, 'split');
  assert.equal(classifyPart('Part 1', 'piano', notes).strategy, 'keep');
  assert.equal(classifyPart('Untitled', '', notes).strategy, 'keep');
  assert.equal(classifyPart('Untitled', '', notes.slice(0, 3)).strategy, 'split');
  assert.equal(classifyPart('Part 1', 'unknown Unknown', notes.slice(0, 2)).strategy, 'split');
});

test('SATB plus a two-staff piano becomes six tracks, with all piano notes retained', () => {
  const score = parseMuseScore(document([
    { name: 'Soprano', music: measure(chord([72, 76])) },
    ...['Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, music: measure(chord(67 - i * 7)) })),
    { name: 'Piano', instrument: 'keyboard.piano', staves: [measure(chord([60, 64, 67])), measure(chord([36, 48]))] }
  ]));
  const tracks = buildScoreTracks(score, {}, 120);
  assert.equal(tracks.length, 6);
  assert.equal(tracks.at(-1).name, 'Piano');
  assert.equal(tracks.at(-1).isPolyphonic, true);
  assert.deepEqual(tracks.at(-1).notes.map(n => n.midi).sort((a, b) => a - b), [36, 48, 60, 64, 67]);
  assert.equal(scorePitchFrames(tracks.at(-1).notes, 2, true).length, 0);
});

test('already separated soprano parts retain their names; user overrides can split an instrument', () => {
  const score = parseMuseScore(document([
    { name: 'Soprano 1', music: measure(chord(76)) },
    { name: 'Soprano 2', music: measure(chord(72)) },
    { name: 'Trumpet', music: measure(chord([60, 64])) }
  ]));
  assert.deepEqual(buildScoreTracks(score, {}, 120).map(t => t.name), ['Soprano 1', 'Soprano 2', 'Trumpet']);
  assert.deepEqual(buildScoreTracks(score, { 'part-2': 'split' }, 120).slice(-2).map(t => t.name), ['Trumpet 1', 'Trumpet 2']);
});

test('twenty generated tracks are supported; twenty-one are rejected without truncation', () => {
  const parts = Array.from({ length: 21 }, (_, i) => ({ name: `Flute ${i + 1}`, music: measure(chord(60 + i)) }));
  const score = parseMuseScore(document(parts));
  assert.throws(() => buildScoreTracks(score, {}, 120), /21 tracks/);
  assert.equal(buildScoreTracks({ ...score, parts: score.parts.slice(0, 20) }, {}, 120).length, 20);
  assert.throws(() => buildScoreTracks(score, {}, 0), /tempo/);
});

test('ZIP import follows the container manifest and supports an unambiguous root fallback', () => {
  const xml = document([{ name: 'S', music: measure(chord(60)) }]);
  const zip = zipSync({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="nested/main.mscx"/></rootfiles></container>'), 'nested/main.mscx': strToU8(xml), 'decoy.mscx': strToU8('<invalid/>') });
  assert.equal(readScoreArchive(zip), xml);
  assert.equal(readScoreArchive(zipSync({ 'one.mscx': strToU8(xml) })), xml);
  assert.throws(() => readScoreArchive(zipSync({ 'one.mscx': strToU8(xml), 'two.mscx': strToU8(xml) })), /unique main score/);
  assert.throws(() => readScoreArchive(new Uint8Array([0, 1, 2])), /archive/);
});

test('dots, tuplets, pickup bars, independent voices and location offsets preserve timing', () => {
  const triplets = '<Tuplet id="1"><normalNotes>2</normalNotes><actualNotes>3</actualNotes></Tuplet>'
    + [60, 62, 64].map(p => chord(p, 'eighth', '<Tuplet>1</Tuplet>')).join('');
  const score = basic(measure(chord(60), 'len="1/4"')
    + `<Measure><voice>${triplets}${chord(65, 'quarter', '<dots>1</dots>')}<Rest><durationType>quarter</durationType><dots>1</dots></Rest></voice><voice><location><fractions>1/4</fractions></location>${chord(48, 'half')}</voice></Measure>`);
  assert.equal(score.durationBeats, 5);
  const notes = score.parts[0].notes;
  assert.ok(Math.abs(notes[1].end - notes[1].start - 1 / 3) < 1e-7);
  assert.ok(notes.some(n => n.midi === 65 && Math.abs(n.start - 2) < 1e-7 && Math.abs(n.end - 3.5) < 1e-7));
  assert.ok(notes.some(n => n.midi === 48 && n.start === 2 && n.end === 4));
});

test('tempo changes and simple repeats are expanded in sync for every part', () => {
  const music = measure(`<startRepeat/><Tempo><tempo>2</tempo></Tempo>${chord(60, 'whole')}`)
    + measure(`<Tempo><tempo>1</tempo></Tempo>${chord(62, 'whole')}<endRepeat>2</endRepeat>`);
  const score = parseMuseScore(document([{ name: 'S', music }, { name: 'A', music }]));
  const tracks = buildScoreTracks(score, {}, 90);
  assert.equal(tracks[0].duration, 12);
  assert.deepEqual(tracks[0].notes.map(n => n.start), [0, 2, 6, 8]);
  assert.deepEqual(tracks[0].notes.map(n => n.start), tracks[1].notes.map(n => n.start));
  assert.equal(beatToSeconds(8, [{ beat: 4, bpm: 60 }], 120), 6);
});

test('a repeat jump before the first tempo mark restores the chosen fallback tempo', () => {
  const score = basic(measure(`<startRepeat/>${chord(60, 'whole')}`) + measure(`<Tempo><tempo>1</tempo></Tempo>${chord(62, 'whole')}<endRepeat>2</endRepeat>`));
  assert.equal(buildScoreTracks(score, {}, 120)[0].duration, 12);
});

test('nested repeats preserve the complete shared performance order', () => {
  const score = basic(measure(`<startRepeat/>${chord(60, 'whole')}`)
    + measure(`<startRepeat/>${chord(62, 'whole')}<endRepeat>2</endRepeat>`)
    + measure(`${chord(64, 'whole')}<endRepeat>2</endRepeat>`));
  const tracks = buildScoreTracks(score, {}, 120);
  assert.deepEqual(tracks[0].notes.map(n => n.midi), [60, 62, 62, 64, 60, 62, 62, 64]);
  assert.equal(tracks[0].duration, 16);
});

test('tempo markings on an omitted percussion part still govern all pitched parts', () => {
  const score = parseMuseScore(document([
    { name: 'Drums', instrument: 'drums', instrumentExtra: '<useDrumset>1</useDrumset>', music: measure(`<Tempo><tempo>1</tempo></Tempo>${chord(36, 'whole')}`) },
    { name: 'S', music: measure(chord(60, 'whole')) }
  ]));
  assert.equal(score.parts.length, 1);
  assert.match(score.warnings[0], /percussion is omitted/);
  assert.equal(buildScoreTracks(score, {}, 120)[0].duration, 4);
});

test('ties across barlines retain one sustained note; repeated articulated notes remain separate', () => {
  const tied = `<Chord><durationType>whole</durationType><Note><pitch>60</pitch><Spanner type="Tie"><next><location><measures>1</measures></location></next></Spanner></Note><Note><pitch>64</pitch><Tie id="1"/></Note></Chord>`;
  const score = basic(measure(tied) + measure(chord([60, 64], 'whole')) + measure(chord(60) + chord(60)));
  assert.deepEqual(score.parts[0].notes.slice(0, 2).map(n => [n.start, n.end]), [[0, 8], [0, 8]]);
  const voices = buildScoreTracks(score, {}, 120);
  assert.equal(voices[0].notes.filter(n => n.start >= 4).length, 2);
});

test('MuseScore 2 direct events and MuseScore 3 voice events keep stored sounding MIDI pitches', () => {
  const v2 = document([{ name: 'Tenor', music: `<Measure><tick>0</tick>${chord(50, 'whole')}</Measure>` }], '2.06');
  const v3 = document([{ name: 'Trumpet', instrument: 'trumpet', instrumentExtra: '<transposeChromatic>-2</transposeChromatic>', music: measure(chord(58)) }], '3.02');
  assert.equal(buildScoreTracks(parseMuseScore(v2), {}, 120)[0].notes[0].midi, 50);
  assert.equal(buildScoreTracks(parseMuseScore(v3), {}, 120)[0].notes[0].midi, 58);
});

test('malformed files and unsupported navigation fail with actionable messages', () => {
  assert.throws(() => parseMuseScore('<broken>'), /Invalid score XML/);
  assert.throws(() => parseMuseScore('<!DOCTYPE museScore [<!ENTITY x SYSTEM "file:///secret">]><museScore/>'), /entities/);
  assert.throws(() => parseMuseScore(document([{ name: 'S', music: measure('<Jump/>') }])), /navigation jumps/);
  assert.throws(() => parseMuseScore(document([{ name: 'S', music: measure(chord(60, 'quarter', '<acciaccatura/>')) }])), /Grace notes/);
  assert.throws(() => parseMuseScore(document([{ name: 'S', music: measure(chord(60, 'long')) }])), /measure length/);
});

test('score frames are exact, respect reference rests, and keep the full timeline', () => {
  const frames = scorePitchFrames([note('a', 69, 0.1, 0.3)], 0.5, false);
  assert.equal(frames[0].voiced, false);
  assert.equal(frames[10].frequency, 440);
  assert.equal(frames[30].voiced, false);
  assert.equal(frames.at(-1).timestamp, 0.5);
});

test('aaah rendering produces decodable PCM with the expected pitch, rests, and cancellation', async () => {
  const context = { createBuffer: (channels, length, sampleRate) => ({ duration: length / sampleRate, data: null, copyToChannel(data) { this.data = data; } }) };
  const track = { name: 'A', notes: [note('a', 69, 0.1, 0.7)], duration: 0.8, isPolyphonic: false };
  const rendered = await renderScoreTrack(track, context, new AbortController().signal, () => {});
  assert.equal(rendered.audioBuffer.duration, 0.8);
  assert.equal(rendered.blob.size, 44 + 0.8 * SCORE_SAMPLE_RATE * 2);
  const data = rendered.audioBuffer.data;
  assert.ok(data.slice(0, 2000).every(v => v === 0));
  const engine = new PraatPitchEngine({ sampleRate: SCORE_SAMPLE_RATE, pitchFloor: 100, pitchCeiling: 1000 });
  const found = engine.analyzeFrame(data.slice(5000, 7048), 0.2);
  assert.ok(Math.abs(found.frequency - 440) < 1, `Detected ${found.frequency} Hz`);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(renderScoreTrack(track, context, abort.signal, () => {}), { name: 'AbortError' });
  const runningAbort = new AbortController();
  const long = { ...track, duration: 30, notes: [note('long', 69, 0, 30)] };
  await assert.rejects(renderScoreTrack(long, context, runningAbort.signal, () => runningAbort.abort()), { name: 'AbortError' });
});

test('visibility is independent from mute, training forces only its target, and practice settings survive', () => {
  const tracks = [emptyTrack(0), emptyTrack(1), emptyTrack(2)];
  tracks[0].visible = false; tracks[1].muted = true;
  assert.deepEqual(visibleDiagramTracks(tracks, false, 0).map(t => t.index), [1, 2]);
  const training = visibleDiagramTracks(tracks, true, 0);
  assert.deepEqual(training.map(t => t.index), [0]);
  assert.equal(training[0].visible, true);
  assert.equal(tracks[0].visible, false);
  assert.deepEqual(visibleDiagramTracks(tracks, false, 0).map(t => t.index), [1, 2]);
});
