import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
test('final catalogues preserve excluded songs and scores and expose exactly one accompaniment per processed song',()=>{
 const root=resolve('library-work'),dir=mkdtempSync(`${root}/bundle-test-`),plan=JSON.parse(readFileSync(`${root}/plan.json`,'utf8'));
 const original=JSON.parse(readFileSync(`${root}/songs.original.json`,'utf8'));
 try{
  const upload=resolve(dir,'upload');mkdirSync(`${dir}/library-work`);mkdirSync(upload);
  plan.outputRoot=upload;plan.workRoot=resolve(dir,'work');
  plan.jobs=plan.jobs.map((j,i)=>({...j,jobDir:resolve(dir,`job-${i}`)}));
  for(const job of plan.jobs){
   mkdirSync(job.jobDir);const outputs=[];
   for(const [kind,path] of [['voice',job.outputs.voice],['accompaniment',job.outputs.accompaniment]]){
    if(!path)continue;const bytes=Buffer.from(`${job.id}-${kind}`),target=resolve(upload,path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,bytes);
    outputs.push({kind,path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,durationSeconds:212,channels:1,bitrateKbps:128,encodingSnrDb:30});
   }
   writeFileSync(`${job.jobDir}/complete.json`,JSON.stringify({signature:job.signature,sharedGain:1,outputs}));
  }
  writeFileSync(`${dir}/library-work/plan.json`,JSON.stringify(plan));writeFileSync(`${dir}/library-work/songs.original.json`,JSON.stringify(original));writeFileSync(`${dir}/PIPELINE-NOTICE.txt`,'test notices');
  execFileSync(process.execPath,[resolve('library-build.mjs')],{cwd:dir});
  const replacement=JSON.parse(readFileSync(`${upload}/songs.replace.json`,'utf8')),appended=JSON.parse(readFileSync(`${upload}/songs.append.json`,'utf8'));
  for(const id of plan.excludedSongs){const old=original.songs.find(s=>s.id===id);assert.deepEqual(replacement.songs.find(s=>s.id===id),old);assert.deepEqual(appended.songs.find(s=>s.id===id),old);}
  for(const old of original.songs){assert.deepEqual(replacement.songs.find(s=>s.id===old.id).sheets,old.sheets);}
  for(const id of new Set(plan.jobs.map(j=>j.songId))){
   const parts=replacement.songs.find(s=>s.id===id).parts;assert.equal(parts.filter(p=>p.role==='accompaniment').length,1);
   assert.ok(parts.every(p=>/-voice\.mp3$|-acc\.mp3$/.test(p.url)));
  }
  assert.equal(JSON.parse(readFileSync(`${upload}/manifest.json`,'utf8')).files.length,27);
  assert.ok(readFileSync(`${upload}/READY.txt`,'utf8').startsWith('READY'));
 }finally{if(resolve(dir).startsWith(root+sep))rmSync(dir,{recursive:true,force:true});}
});
