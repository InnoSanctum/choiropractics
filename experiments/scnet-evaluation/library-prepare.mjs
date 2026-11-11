import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { models, REVISIONS } from '@audio/neural-separate';
const ROOT=resolve('library-work'),UPLOAD=resolve('../../artifacts/choir-library-upload');
const excluded=['connected','follow-the-star','moon-river','words','you-cant-step-twice'];
const base='https://papaya-truffle-25f879.netlify.app/songs.json';
mkdirSync(ROOT,{recursive:true});mkdirSync(UPLOAD,{recursive:true});
const response=await fetch(base,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Catalogue HTTP ${response.status}`);
const original=await response.json();writeFileSync(`${ROOT}/songs.original.json`,JSON.stringify(original,null,2));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const modelPath=resolve('cache/scnet/scnet.int8.onnx'),modelHash=hash(readFileSync(modelPath));
if(modelHash!==models.scnet.sha256)throw Error('SCNet checkpoint hash mismatch.');
const jobs=[];
for(const song of original.songs){
  if(excluded.includes(song.id)||!song.parts.length)continue;
  if(!/^[a-z0-9-]+$/.test(song.id))throw Error('Invalid song identifier.');
  const mix=song.parts.filter(p=>p.voice==='all');
  if(mix.length!==1)throw Error(`Need exactly one all-voices mix for ${song.id}.`);
  const ordered=[mix[0],...song.parts.filter(p=>p!==mix[0])];
  for(const part of ordered){
    const url=new URL(part.url,base);
    if(url.origin!==new URL(base).origin||!new RegExp(`^/s/${song.id}/[a-zA-Z0-9_.-]+\\.mp3$`).test(url.pathname))throw Error(`Unexpected source URL: ${url}`);
    const relative=url.pathname.slice(1),source=resolve(ROOT,'originals',relative);mkdirSync(dirname(source),{recursive:true});
    // Every source is downloaded once into its original catalogue folder structure.
    if(!existsSync(source)){
      console.log('Downloading',relative);const r=await fetch(url,{signal:AbortSignal.timeout(180000)});
      if(!r.ok)throw Error(`HTTP ${r.status}: ${url}`);const bytes=Buffer.from(await r.arrayBuffer());
      if(!bytes.length||bytes.length>32000000)throw Error('Invalid source length.');writeFileSync(source,bytes);
    }
    const stem=relative.replace(/\.mp3$/i,''),id=`${song.id}-${basename(stem)}`,sourceHash=hash(readFileSync(source));
    const settings={sourceSha256:sourceHash,modelSha256:modelHash,model:'scnet',revision:REVISIONS.scnet,step:.25,backend:'cpu',threads:2,pipeline:'resumable-v1',sampleRate:44100};
    const signature=hash(Buffer.from(JSON.stringify(settings)));
    const jobDir=resolve(ROOT,'jobs',id);mkdirSync(jobDir,{recursive:true});
    const voicePath=`${stem}-voice.mp3`,accPath=part===mix[0]?`${stem}-acc.mp3`:null;
    jobs.push({id,songId:song.id,title:song.title,voice:part.voice,label:part.label,url:url.href,relative,source,sourceHash,signature,settings,jobDir,
      outputs:{voice:voicePath,accompaniment:accPath},canonicalAccompaniment:part===mix[0],expectedDuration:part.duration_sec});
  }
}
const plan={createdAt:new Date().toISOString(),catalogueUrl:base,excludedSongs:excluded,songsWithoutAudio:original.songs.filter(s=>!s.parts.length).map(s=>s.id),
  outputRoot:UPLOAD,workRoot:ROOT,modelPath,includeMixVocals:true,encoding:{codec:'mp3',encoder:'libmp3lame',bitrateKbps:128,channels:1,sampleRate:44100,stereoFallbackBitrateKbps:160},
  masterEncoding:{codec:'flac',bits:24},jobs};
writeFileSync(`${ROOT}/plan.json`,JSON.stringify(plan,null,2));
copyFileSync('node_modules/@audio/neural-separate/NOTICE',`${ROOT}/PIPELINE-NOTICE.txt`);
copyFileSync('node_modules/@audio/neural-separate/NOTICE','PIPELINE-NOTICE.txt');
console.log(JSON.stringify({songs:[...new Set(jobs.map(j=>j.songId))],jobs:jobs.length,newFiles:jobs.length+jobs.filter(j=>j.canonicalAccompaniment).length,output:UPLOAD,excluded},null,2));
