import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { MPEGDecoder } from 'mpg123-decoder';
import { load } from '@audio/neural-runtime';
import { separateResumable } from './library-separate.mjs';
import { encodeStem } from './library-encode.mjs';
const plan=JSON.parse(readFileSync('library-work/plan.json','utf8')),job=plan.jobs.find(j=>j.id===process.argv[2]);
if(!job)throw Error('Unknown planned Library recording.');
const atomic=(path,value)=>{writeFileSync(path+'.partial',JSON.stringify(value,null,2));renameSync(path+'.partial',path);};
const stage=(phase,more={})=>{atomic(`${job.jobDir}/progress.json`,{jobId:job.id,phase,updatedAt:new Date().toISOString(),rssBytes:process.memoryUsage.rss(),freeRamBytes:os.freemem(),...more});console.log(phase,JSON.stringify(more));};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const started=performance.now(),cpuStart=process.cpuUsage();stage('decoding');
const inputBytes=readFileSync(job.source);if(sha(inputBytes)!==job.sourceHash)throw Error('Source checksum changed.');
const decoder=new MPEGDecoder({enableGapless:true});await decoder.ready;
const decoded=decoder.decode(inputBytes);decoder.free();
if(decoded.errors.length)throw Error(JSON.stringify(decoded.errors));
const input=decoded.channelData.length===1?[decoded.channelData[0],decoded.channelData[0]]:decoded.channelData;
if(decoded.sampleRate!==44100||input.length!==2)throw Error('Expected 44100 Hz mono/stereo recording.');
let sourceIsMono=true;for(let i=0;i<input[0].length;i++)if(Math.abs(input[0][i]-input[1][i])>1e-7){sourceIsMono=false;break;}
const cacheDir=resolve(job.jobDir,`windows-${job.signature.slice(0,16)}`);
stage('loading model');
if(sha(readFileSync(plan.modelPath))!==job.settings.modelSha256)throw Error('Model checksum changed.');
const session=await load(new Uint8Array(readFileSync(plan.modelPath)),{backend:'node',executionProviders:['cpu'],sessionOptions:{
  intraOpNumThreads:job.settings.threads,interOpNumThreads:1,executionMode:'sequential',enableCpuMemArena:false,enableMemPattern:false,logSeverityLevel:3,
}});
let result;
try{result=await separateResumable(input,{session,cacheDir,onProgress:p=>stage('separating',p)});}finally{session.free();}
const separatedAt=performance.now(),vocals=result.vocals,N=input[0].length;
const accompaniment=job.canonicalAccompaniment?vocals.map((ch,c)=>Float32Array.from(ch,(v,i)=>input[c][i]-v)):null;
const groups={voice:vocals,...(accompaniment?{accompaniment}:{} )},groupList=Object.values(groups);
let peak=0,sourceEnergy=0,vocalEnergy=0;
for(let c=0;c<2;c++)for(let i=0;i<N;i++){sourceEnergy+=input[c][i]**2;vocalEnergy+=vocals[c][i]**2;for(const data of groupList){const v=data[c][i];if(!Number.isFinite(v))throw Error('Non-finite output sample.');peak=Math.max(peak,Math.abs(v));}}
const gain=Math.min(1,.98/Math.max(peak,1e-9)),outputs=[];
for(const [kind,channels] of Object.entries(groups)){
  stage('encoding',{kind});
  const relative=kind==='voice'?job.outputs.voice:job.outputs.accompaniment;
  outputs.push({kind,...encodeStem(channels,{gain,relative,outputRoot:plan.outputRoot,masterRoot:resolve(plan.workRoot,'masters'),temporaryRoot:job.jobDir,outputChannels:sourceIsMono?1:2})});
}
const metadata={id:job.id,signature:job.signature,source:{url:job.url,sha256:job.sourceHash,samples:N,durationSeconds:N/44100,channels:sourceIsMono?1:2},
  settings:job.settings,normalization:result.normalization,windows:result.windows,inferredWindows:result.inferred,reusedWindows:result.reused,
  sharedGain:gain,peakSampleBeforeGain:peak,vocalRmsRelativeToSourceDb:10*Math.log10(Math.max(vocalEnergy,1e-30)/Math.max(sourceEnergy,1e-30)),
  separationSeconds:(separatedAt-started)/1000,totalSeconds:(performance.now()-started)/1000,
  cpuSeconds:Object.values(process.cpuUsage(cpuStart)).reduce((s,n)=>s+n,0)/1e6,resource:process.resourceUsage(),outputs,completedAt:new Date().toISOString()};
atomic(`${job.jobDir}/complete.json`,metadata);stage('complete',{outputs:outputs.map(o=>o.path)});
// Only completed, reproducible window caches inside this job's own directory are removed.
if(resolve(cacheDir).startsWith(resolve(plan.workRoot)+sep)&&resolve(cacheDir).startsWith(resolve(job.jobDir)+sep))rmSync(cacheDir,{recursive:true,force:true});
