import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './load-typescript.mjs';

const { parseCatalogue, searchSongs, fetchLibraryBytes, fetchCatalogue, CATALOGUE_URL, defaultLibraryParts, canTrainOnLibraryPart } = loadTypescript('src/library/catalogue.ts');
const { prepareLibrarySong } = loadTypescript('src/library/loadSong.ts');
const fixture = { schema: 'open-air-choir/songs@1', songs: [
  { id: 'moon-river', title: 'Moon River', subtitle: 'Henry Mancini', parts: [
    { voice: 'soprano', label: 'Сопрано 1', url: 's/moon-river/01-s.mp3', duration_sec: 186 },
    { voice: 'soprano', label: 'Сопрано 2', url: 's/moon-river/02-s.mp3', duration_sec: 186 },
    { voice: 'all', label: 'Все вместе', url: 's/moon-river/06-all.mp3', duration_sec: 185 }
  ], sheets: [{ url: 'should-never-be-loaded.pdf' }] },
  { id: 'unrecorded', title: 'The Chain', subtitle: 'Fleetwood Mac', parts: [] }
] };
const fakeAudio = { length: 44100, numberOfChannels: 1, duration: 1, sampleRate: 44100 };
const frame = { timestamp: 0.1, frequency: 440, exactMidi: 69, nearestMidi: 69, noteName: 'A4', cents: 0, voiced: true, strength: 1, intensity: 0.5 };

test('the real catalogue shape resolves relative audio URLs and keeps numbered voices and empty songs', () => {
  const songs = parseCatalogue(fixture);
  assert.equal(songs.length, 2);
  assert.equal(songs[0].parts[0].url, new URL('s/moon-river/01-s.mp3', CATALOGUE_URL).href);
  assert.deepEqual(songs[0].parts.map(p => p.label), ['Сопрано 1', 'Сопрано 2', 'Все вместе']);
  assert.equal(new Set(songs[0].parts.map(p => p.id)).size, 3);
  assert.equal(songs[0].parts[2].isMix, true);
  assert.equal(songs[1].parts.length, 0);
  assert.equal('sheets' in songs[0], false);
});

test('saved catalogues retain durations and can be searched by title, composer, or voice', () => {
  const songs = parseCatalogue(fixture);
  const saved = parseCatalogue(JSON.parse(JSON.stringify({ songs, fetchedAt: 1 })));
  assert.equal(saved[0].parts[0].duration, 186);
  assert.deepEqual(searchSongs(songs, 'mancini soprano').map(s => s.id), ['moon-river']);
  assert.equal(searchSongs(songs, 'СОПРАНО 2')[0].title, 'Moon River');
  assert.equal(searchSongs(songs, 'fleetwood')[0].id, 'unrecorded');
  assert.equal(searchSongs(songs, 'not-a-song').length, 0);
});

test('catalogue validation rejects invalid structure, duplicate song IDs, and non-HTTP recording URLs', () => {
  assert.throws(() => parseCatalogue([]), /unsupported format/);
  assert.throws(() => parseCatalogue({ songs: [{ title: 'Incomplete' }] }), /Invalid song/);
  assert.throws(() => parseCatalogue({ songs: [fixture.songs[0], fixture.songs[0]] }), /Duplicate/);
  for (const url of ['javascript:alert(1)', 'file:///private.mp3', 'https://user:password@example.com/a.mp3']) {
    assert.throws(() => parseCatalogue({ songs: [{ id: 'x', title: 'X', parts: [{ voice: 'alto', url }] }] }), /Unsupported recording URL/);
  }
});

test('bounded downloads handle HTTP failure, oversized streams, and invalid JSON', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(fetchLibraryBytes('https://example.com/a', new AbortController().signal, 100), /HTTP 404/);
    globalThis.fetch = async () => new Response(new Uint8Array(101));
    await assert.rejects(fetchLibraryBytes('https://example.com/a', new AbortController().signal, 100), /too large/);
    globalThis.fetch = async () => new Response('not json');
    await assert.rejects(fetchCatalogue(new AbortController().signal), /valid JSON/);
    globalThis.fetch = async () => new Response(JSON.stringify(fixture));
    assert.equal((await fetchCatalogue(new AbortController().signal)).songs.length, 2);
  } finally { globalThis.fetch = original; }
});

test('every catalogue access bypasses HTTP caching and reads changed song data', async () => {
  const original = globalThis.fetch, requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, cache: options.cache });
      const data = structuredClone(fixture);
      data.songs[0].title = `Revision ${requests.length}`;
      return new Response(JSON.stringify(data));
    };
    assert.equal((await fetchCatalogue(new AbortController().signal)).songs[0].title, 'Revision 1');
    assert.equal((await fetchCatalogue(new AbortController().signal)).songs[0].title, 'Revision 2');
    assert.deepEqual(requests, [{ url: CATALOGUE_URL, cache: 'no-store' }, { url: CATALOGUE_URL, cache: 'no-store' }]);
  } finally { globalThis.fetch = original; }
});

test('download cancellation propagates to an in-flight request', async () => {
  const original = globalThis.fetch;
  try {
    let requestSignal;
    globalThis.fetch = async (_, options) => {
      requestSignal = options.signal;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
    const abort = new AbortController();
    const pending = fetchLibraryBytes('https://example.com/a', abort.signal, 100);
    abort.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requestSignal.aborted, true);
  } finally { globalThis.fetch = original; }
});

function loader(overrides = {}) {
  return { analysisKey: '2|true|all', getCached: async () => undefined, cache: async () => {},
    decode: async () => fakeAudio, analyze: async () => [frame], ...overrides };
}

test('song loading fetches selected audio only, preserves separate soprano labels, and mutes optional mixes', async () => {
  const original = globalThis.fetch, requested = [], analyzed = [], cache = [], progress = [];
  try {
    globalThis.fetch = async url => { requested.push(url); return new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }); };
    const song = parseCatalogue(fixture)[0];
    const prepared = await prepareLibrarySong(song, song.parts.map(p => p.id), loader({
      analyze: async (_, part) => { analyzed.push(part.label); return [frame]; }, cache: async value => cache.push(value)
    }), new AbortController().signal, p => progress.push(p.fraction));
    assert.deepEqual(requested, song.parts.map(p => p.url));
    assert.deepEqual(analyzed, ['Сопрано 1', 'Сопрано 2']);
    assert.equal(cache.length, 3);
    assert.deepEqual(prepared.tracks.slice(0, 3).map(t => t.name), ['Сопрано 1', 'Сопрано 2', 'Все вместе']);
    assert.equal(prepared.tracks[2].muted, true);
    assert.equal(prepared.tracks[2].isPolyphonic, true);
    assert.equal(prepared.tracks[2].visible, false);
    assert.equal(prepared.tracks[0].librarySongTitle, 'Moon River');
    assert.equal(prepared.tracks.filter(t => t.isMain).length, 1);
    assert.ok(progress.every((n, i) => i === 0 || n >= progress[i - 1]));
  } finally { globalThis.fetch = original; }
});

test('cached recordings load without network requests or repeated pitch analysis', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('Network must not be used'); };
    const song = parseCatalogue(fixture)[0];
    const prepared = await prepareLibrarySong(song, [song.parts[1].id], loader({
      getCached: async key => ({ key, blob: new Blob(['audio']), frames: [frame], updatedAt: 1 }),
      analyze: async () => { throw new Error('Analysis must not be repeated'); }
    }), new AbortController().signal, () => {});
    assert.equal(prepared.tracks[0].name, 'Сопрано 2');
    assert.equal(prepared.tracks[0].pitchFrames[0].frequency, 440);
  } finally { globalThis.fetch = original; }
});

test('a mix-only selection is audible but has no single-note training target', async () => {
  const song = parseCatalogue(fixture)[0];
  const prepared = await prepareLibrarySong(song, [song.parts[2].id], loader({
    getCached: async key => ({ key, blob: new Blob(['audio']), frames: [], updatedAt: 1 })
  }), new AbortController().signal, () => {});
  assert.equal(prepared.tracks[0].muted, false);
  assert.equal(prepared.tracks.some(t => t.isMain), false);
});

test('download/decode errors and cancellation reject before any rehearsal is returned', async () => {
  const original = globalThis.fetch;
  try {
    const song = parseCatalogue(fixture)[0], ids = song.parts.slice(0, 2).map(p => p.id);
    globalThis.fetch = async url => new Response('audio', { status: url.includes('02-s') ? 404 : 200 });
    await assert.rejects(prepareLibrarySong(song, ids, loader(), new AbortController().signal, () => {}), /Сопрано 2.*404/);
    globalThis.fetch = async () => new Response('audio');
    await assert.rejects(prepareLibrarySong(song, ids, loader({ decode: async () => { throw new Error('bad audio'); } }), new AbortController().signal, () => {}), /Could not decode/);
    const abort = new AbortController();
    await assert.rejects(prepareLibrarySong(song, ids, loader({ analyze: async () => { abort.abort(); return []; } }), abort.signal, () => {}), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});

test('selection validation and cache write failures do not silently drop recordings', async () => {
  const song = parseCatalogue(fixture)[0];
  const abort = new AbortController();
  await assert.rejects(prepareLibrarySong(song, [], loader(), abort.signal, () => {}), /at least one/);
  await assert.rejects(prepareLibrarySong(song, ['missing'], loader(), abort.signal, () => {}), /no longer available/);
  const large = { ...song, parts: Array.from({ length: 21 }, (_, i) => ({ ...song.parts[0], id: `part-${i}` })) };
  await assert.rejects(prepareLibrarySong(large, large.parts.map(p => p.id), loader(), abort.signal, () => {}), /at most 20/);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('audio');
    const result = await prepareLibrarySong(song, [song.parts[0].id], loader({ cache: async () => { throw new Error('quota'); } }), abort.signal, () => {});
    assert.equal(result.tracks[0].name, 'Сопрано 1');
  } finally { globalThis.fetch = original; }
});

test('appended separated vocals replace originals in the default selection and include one accompaniment', () => {
  const raw = JSON.parse(JSON.stringify(fixture));
  raw.songs[0].parts.push(
    { voice: 'soprano', label: 'Soprano 1 vocal only', url: 's/moon-river/01-s-voice.mp3', source_url: 's/moon-river/01-s.mp3', variant: 'voice-only' },
    { voice: 'accompaniment', label: 'Accompaniment', url: 's/moon-river/06-all-acc.mp3', role: 'accompaniment' }
  );
  const song = parseCatalogue(raw)[0], defaults = defaultLibraryParts(song);
  assert.deepEqual(defaults.map(p => p.label), ['Сопрано 2', 'Soprano 1 vocal only', 'Accompaniment']);
  assert.equal(canTrainOnLibraryPart(defaults[2]), false);
  const saved = parseCatalogue(JSON.parse(JSON.stringify({ songs: [song] })))[0];
  assert.deepEqual(defaultLibraryParts(saved).map(p => p.url), defaults.map(p => p.url));
});

test('accompaniment is audible with vocals, has no diagram, and is never analyzed or chosen as a reference', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('audio');
    const song = parseCatalogue({ songs: [{ id: 'x', title: 'X', parts: [
      { voice: 'accompaniment', url: 's/x/acc.mp3', label: 'Piano' },
      { voice: 'alto', url: 's/x/alto.mp3', label: 'Alto' }
    ] }] })[0];
    const analyzed = [];
    const result = await prepareLibrarySong(song, song.parts.map(p => p.id), loader({ analyze: async (_, part) => { analyzed.push(part.label); return [frame]; } }), new AbortController().signal, () => {});
    assert.deepEqual(analyzed, ['Alto']);
    assert.equal(result.tracks[0].muted, false);
    assert.equal(result.tracks[0].visible, false);
    assert.equal(result.tracks[0].isPolyphonic, true);
    assert.deepEqual(result.tracks[0].pitchFrames, []);
    assert.equal(result.tracks[0].isMain, false);
    assert.equal(result.tracks[1].isMain, true);
  } finally { globalThis.fetch = original; }
});
