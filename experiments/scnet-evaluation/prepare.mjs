import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MPEGDecoder } from 'mpg123-decoder';
import { models, REVISIONS } from '@audio/neural-separate';
import os from 'node:os';

const base = 'https://papaya-truffle-25f879.netlify.app/songs.json';
for (const dir of ['downloads', 'cache/scnet', 'results']) await mkdir(dir, { recursive: true });
async function download(url, path) {
  if (existsSync(path)) return new Uint8Array(await readFile(path));
  console.log('Downloading', url);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw Error(`${response.status} ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(path, bytes); return bytes;
}
const catalogue = JSON.parse(new TextDecoder().decode(await download(base, 'downloads/songs.json')));
const preset = models.scnet;
const modelUrl = `https://huggingface.co/${preset.repo}/resolve/${REVISIONS.scnet}/${preset.file}`;
const model = await download(modelUrl, `cache/scnet/${preset.file}`);
const sha256 = createHash('sha256').update(model).digest('hex');
if (sha256 !== preset.sha256) throw Error(`Model checksum mismatch: ${sha256}`);
const selections = [
  ['somebody-to-love', 0, 0, 30, 'Opening and vocal entrance; piano accompaniment named in catalogue'],
  ['somebody-to-love', 2, 45, 24, 'Bass part with piano; mid-song excerpt'],
  ['let-it-snow', 1, 0, 30, 'Alto opening; accompaniment comparison'],
  ['moon-river', 3, 30, 24, 'Tenor part; sustained-phrase comparison'],
  ['water-is-wide', 2, 12, 24, 'Bass; arrangement labelled a cappella (recording may still contain guide instruments)'],
  ['connected', 0, 15, 24, 'Soprano; arrangement labelled a cappella (recording may still contain guide instruments)'],
];
const excerpts = [];
for (const [songId, partIndex, start, duration, purpose] of selections) {
  const song = catalogue.songs.find(s => s.id === songId), part = song.parts[partIndex];
  const id = `${songId}-${partIndex + 1}-${part.voice}`;
  const url = new URL(part.url, base).href;
  const data = await download(url, `downloads/${id}.mp3`);
  const decoder = new MPEGDecoder({ enableGapless: true }); await decoder.ready;
  const decoded = decoder.decode(data); decoder.free();
  if (decoded.errors.length) throw Error(`Decode errors in ${id}: ${JSON.stringify(decoded.errors)}`);
  const channels = decoded.channelData.map(c => c.slice(Math.round(start * decoded.sampleRate), Math.round((start + duration) * decoded.sampleRate)));
  if (!channels[0]?.length) throw Error(`Empty excerpt ${id}`);
  await mkdir(`results/${id}`, { recursive: true });
  for (const [i, channel] of channels.entries()) await writeFile(`results/${id}/input-${i}.f32`, new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
  excerpts.push({ id, songId, title: song.title, voice: part.voice, partLabel: part.label, url, start, duration: channels[0].length / decoded.sampleRate,
    sampleRate: decoded.sampleRate, channels: channels.length, sourceSha256: createHash('sha256').update(data).digest('hex'), purpose });
  console.log('Prepared', id, `${start}–${start + duration}s`, `${channels.length}ch`);
}
for (const songId of ['somebody-to-love', 'let-it-snow']) {
  const song = catalogue.songs.find(s => s.id === songId);
  await download(new URL(song.sheets[0].pages[0].url, base).href, `downloads/${songId}-score-page-1.webp`);
}
const manifest = { preparedAt: new Date().toISOString(), catalogueUrl: base,
  machine: { cpu: os.cpus()[0].model.trim(), logicalProcessors: os.cpus().length, totalRamBytes: os.totalmem(), freeRamBytesAtPreparation: os.freemem(), os: `${os.type()} ${os.release()}`, node: process.version },
  model: { name: 'scnet', url: modelUrl, revision: REVISIONS.scnet, sha256, bytes: (await stat(`cache/scnet/${preset.file}`)).size, preset },
  dependencies: JSON.parse(await readFile('package.json', 'utf8')).dependencies, threads: 2, excerpts };
await writeFile('results/manifest.json', JSON.stringify(manifest, null, 2));
console.log('Ready:', resolve('results/manifest.json'));
