import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import separate from '@audio/neural-separate';
import { load } from '@audio/neural-runtime';

const manifest = JSON.parse(readFileSync('results/manifest.json', 'utf8'));
const clip = manifest.excerpts.find(e => e.id === process.argv[2]);
if (!clip) throw Error('Pass a prepared excerpt ID.');
const folder = `results/${clip.id}`;
const stage = (phase, extra = {}) => { writeFileSync(`${folder}/stage.json`, JSON.stringify({ phase, at: new Date().toISOString(), ...extra })); console.log(phase, JSON.stringify(extra)); };
stage('input');
const channels = Array.from({ length: clip.channels }, (_, i) => {
  const bytes = readFileSync(`${folder}/input-${i}.f32`);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
});
const sessions = [], loads = [], runs = [];
const wallStart = performance.now(), cpuStart = process.cpuUsage();
stage('separation');
const result = await separate(channels, {
  model: 'scnet', weights: resolve('cache'), sampleRate: clip.sampleRate, targets: ['vocals'],
  session: async spec => {
    stage('model-load'); const t = performance.now(), cpu = process.cpuUsage();
    const session = await load(spec, { backend: 'node', executionProviders: ['cpu'], sessionOptions: {
      intraOpNumThreads: manifest.threads, interOpNumThreads: 1, executionMode: 'sequential',
      enableCpuMemArena: false, enableMemPattern: false, logSeverityLevel: 3,
    } });
    loads.push({ wallSeconds: (performance.now() - t) / 1000, cpuSeconds: Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1e6 });
    sessions.push(session);
    return { ...session, free() {}, async run(feeds) {
      stage('inference', { chunk: runs.length + 1 }); const begin = performance.now(), c = process.cpuUsage();
      const output = await session.run(feeds);
      runs.push({ wallSeconds: (performance.now() - begin) / 1000, cpuSeconds: Object.values(process.cpuUsage(c)).reduce((a,b)=>a+b,0)/1e6 });
      stage('reconstruction', { completedChunks: runs.length }); return output;
    } };
  },
  progress: p => console.log('progress', JSON.stringify(p)),
});
const elapsed = (performance.now() - wallStart) / 1000;
const cpu = Object.values(process.cpuUsage(cpuStart)).reduce((a,b)=>a+b,0)/1e6;
stage('writing');
const vocals = result.stems.vocals;
// The complement includes all non-vocal instruments plus separation error. It is not a piano classifier.
const accompaniment = vocals.map((ch,c)=>Float32Array.from(ch,(v,i)=>channels[c % channels.length][i]-v));
let peak = 0;
for (const group of [channels, vocals, accompaniment]) for (const ch of group) for (const v of ch) peak = Math.max(peak,Math.abs(v));
const gain = Math.min(1, 0.98/Math.max(peak,1e-9));
function wav(data) {
  const count=data.length,len=data[0].length,b=Buffer.alloc(44+len*count*2);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(count,22);b.writeUInt32LE(clip.sampleRate,24);b.writeUInt32LE(clip.sampleRate*count*2,28);b.writeUInt16LE(count*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(len*count*2,40);
  for(let i=0;i<len;i++)for(let c=0;c<count;c++)b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,data[c][i]*gain))*32767),44+(i*count+c)*2);
  return b;
}
for (const [name, data] of Object.entries({original:channels,vocals,accompaniment})) {
  writeFileSync(`${folder}/${name}.wav`,wav(data));
  const mono = new Float32Array(data[0].length);
  for(const ch of data)for(let i=0;i<mono.length;i++)mono[i]+=ch[i]/data.length;
  writeFileSync(`${folder}/${name}.f32`,Buffer.from(mono.buffer));
}
const metrics = { id:clip.id,durationSeconds:clip.duration,separationSeconds:elapsed,realTimeFactor:elapsed/clip.duration,
  separationCpuSeconds:cpu,averageCpuCores:cpu/elapsed,averageCpuPercentOfMachine:cpu/elapsed/manifest.machine.logicalProcessors*100,
  modelLoads:loads,inferenceRuns:runs,inferenceTotalSeconds:runs.reduce((s,r)=>s+r.wallSeconds,0),sharedPlaybackGain:gain,
  peakSampleBeforeGain:peak,processResourceUsage:process.resourceUsage(),backend:'onnxruntime-node CPU',threads:manifest.threads };
writeFileSync(`${folder}/metrics.json`,JSON.stringify(metrics,null,2));
for(const session of sessions)session.free();
stage('done',{seconds:elapsed,rtf:metrics.realTimeFactor});
