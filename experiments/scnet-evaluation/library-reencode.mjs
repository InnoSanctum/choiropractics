// Migrate already completed stereo outputs to the mono delivery format from lossless masters.
import { readFileSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { encodeStem } from './library-encode.mjs';
const plan=JSON.parse(readFileSync('library-work/plan.json','utf8'));
for(const job of plan.jobs){
 const path=`${job.jobDir}/complete.json`;if(!existsSync(path))continue;
 const meta=JSON.parse(readFileSync(path,'utf8'));let changed=false;
 if(meta.source.channels&&meta.source.channels!==1)continue;
 for(let i=0;i<meta.outputs.length;i++){
   const out=meta.outputs[i];if(out.channels===1)continue;
   const raw=resolve(job.jobDir,'master-migration.f32');
   const r=spawnSync(resolve('node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),['-hide_banner','-loglevel','error','-nostdin','-y','-i',out.master,'-f','f32le','-ar','44100','-ac','2',raw],{windowsHide:true,encoding:'utf8'});
   if(r.status)throw Error(r.stderr);
   const b=readFileSync(raw),v=new Float32Array(b.buffer,b.byteOffset,b.byteLength/4),channels=[new Float32Array(v.length/2),new Float32Array(v.length/2)];
   for(let n=0;n<channels[0].length;n++){channels[0][n]=v[n*2];channels[1][n]=v[n*2+1];}
   meta.outputs[i]={kind:out.kind,...encodeStem(channels,{gain:1,relative:out.path,outputRoot:plan.outputRoot,masterRoot:resolve(plan.workRoot,'masters'),temporaryRoot:job.jobDir,outputChannels:1})};
   rmSync(raw);changed=true;
 }
 if(changed){meta.deliveryReencodedFromLosslessMaster=true;meta.source.channels=1;writeFileSync(path+'.partial',JSON.stringify(meta,null,2));renameSync(path+'.partial',path);console.log('Mono delivery ready:',job.id);}
}
