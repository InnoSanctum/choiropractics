import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const plan=JSON.parse(readFileSync('library-work/plan.json','utf8')),original=JSON.parse(readFileSync('library-work/songs.original.json','utf8'));
// A previous run's completion marker must never survive failed or partial validation.
rmSync(resolve(plan.outputRoot,'READY.txt'),{force:true});
const atomic=(path,text)=>{writeFileSync(path+'.partial',text);renameSync(path+'.partial',path);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const complete=[];
for(const job of plan.jobs){
 const file=`${job.jobDir}/complete.json`;if(!existsSync(file))continue;
 const m=JSON.parse(readFileSync(file,'utf8'));if(m.signature!==job.signature)throw Error(`Stale completed recording ${job.id}`);
 for(const out of m.outputs){
   const path=resolve(plan.outputRoot,out.path);
   if(!path.startsWith(resolve(plan.outputRoot)+sep)||!existsSync(path)||statSync(path).size!==out.bytes)throw Error(`Missing/incomplete output ${out.path}`);
   if(sha(readFileSync(path))!==out.sha256)throw Error(`Checksum mismatch ${out.path}`);
 }
 complete.push({job,metadata:m});
}
const ready=complete.length===plan.jobs.length;
const outputs=complete.flatMap(({job,metadata})=>metadata.outputs.map(o=>({songId:job.songId,voice:o.kind==='accompaniment'?'accompaniment':job.voice,label:o.kind==='accompaniment'?'Accompaniment':`${job.label} — vocal only`,
  url:o.path,duration_sec:o.durationSeconds,source_url:job.url,source_sha256:job.sourceHash,role:o.kind==='accompaniment'?'accompaniment':'vocals',variant:o.kind==='accompaniment'?'instrumental':'voice-only',
  sha256:o.sha256,bytes:o.bytes,channels:o.channels??2,bitrate_kbps:o.bitrateKbps??160,sharedGain:metadata.sharedGain,encodingSnrDb:o.encodingSnrDb})));
mkdirSync(plan.outputRoot,{recursive:true});
const e=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tables=original.songs.filter(s=>outputs.some(o=>o.songId===s.id)).map(song=>`<section><h2>${e(song.title)}</h2>${outputs.filter(o=>o.songId===song.id).map(o=>`<div class="part"><div><b>${e(o.label)}</b><p>${e(o.url)} · ${Math.floor(o.duration_sec/60)}:${String(Math.floor(o.duration_sec%60)).padStart(2,'0')}</p></div><audio controls preload="none" src="${e(o.url)}"></audio><a href="${e(o.url)}" download>MP3</a></div>`).join('')}</section>`).join('');
atomic(resolve(plan.outputRoot,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choir Library · separated recordings</title><style>:root{color-scheme:dark}body{margin:0;background:#0b1422;color:#e6edf5;font:16px/1.5 system-ui}main{max-width:1000px;margin:auto;padding:35px 20px}h1{font-size:36px}section{margin:24px 0;padding:20px;border:1px solid #35435b;border-radius:14px}.part{display:flex;flex-wrap:wrap;gap:14px;align-items:center;border-top:1px solid #35435b;padding:15px 0}.part>div{flex:1;min-width:220px}.part p{font:12px monospace;color:#abc0d6}audio{max-width:100%;width:300px}a{color:#80dcca}.notice{padding:18px;border:1px solid #b98f3c;border-radius:12px;background:#252a30}.ready{border-color:#459f86}</style><main><h1>Choir Library · vocal stems</h1><p class="notice ${ready?'ready':''}">${ready?'Complete: all 27 MP3 files are validated and ready for the host.':`Processing: ${complete.length} / ${plan.jobs.length} recordings complete. Files shown below are finished; the full bundle is not ready yet.`}</p><p>One accompaniment per song, extracted from its original all-voices mix. Timings and leading rests are preserved. Click a recording to listen; playback pauses the others.</p><p>Excluded, unchanged on the host: Connected, Follow the Star, Moon River, Words, You Can't Step Twice.</p>${ready?'<p><a href="songs.replace.json">Replacement catalogue</a> · <a href="songs.append.json">Append catalogue</a> · <a href="UPLOAD-NOTES.txt">Upload instructions</a> · <a href="manifest.json">Provenance and checksums</a></p>':''}${tables}<p>Generated ${new Date().toISOString()}. Refresh to see newly completed recordings.</p></main><script>document.querySelectorAll('audio').forEach(a=>a.onplay=()=>document.querySelectorAll('audio').forEach(b=>{if(a!==b)b.pause()}));</script></html>`);
if(!ready){console.log(`Partial bundle: ${complete.length}/${plan.jobs.length} recordings.`);process.exit(0);}
const entries=outputs.map(({songId,sha256,bytes,sharedGain,encodingSnrDb,...part})=>({songId,part}));
const format={...original.audio_format,note:'Existing files retain their original encoding; new SCNet files preserve mono sources as 44100 Hz mono MP3 at 128 kbps (stereo sources use 160 kbps).',processed:plan.encoding};
const makeCatalogue=append=>({...original,audio_format:format,songs:original.songs.map(song=>{
 const additions=entries.filter(x=>x.songId===song.id).map(x=>x.part);
 return additions.length?{...song,parts:append?[...song.parts,...additions]:additions}:song;
})});
const replacement=makeCatalogue(false),append=makeCatalogue(true);
for(const id of plan.excludedSongs)for(const c of [replacement,append]){
 if(JSON.stringify(c.songs.find(s=>s.id===id))!==JSON.stringify(original.songs.find(s=>s.id===id)))throw Error(`Excluded song changed: ${id}`);
}
for(const id of new Set(plan.jobs.map(j=>j.songId))){if(outputs.filter(o=>o.songId===id&&o.role==='accompaniment').length!==1)throw Error(`Wrong accompaniment count: ${id}`);}
if(outputs.length!==27||outputs.filter(o=>o.role==='accompaniment').length!==5)throw Error('Unexpected final bundle counts.');
atomic(resolve(plan.outputRoot,'songs.replace.json'),JSON.stringify(replacement,null,2));
atomic(resolve(plan.outputRoot,'songs.append.json'),JSON.stringify(append,null,2));
atomic(resolve(plan.outputRoot,'processed-parts.json'),JSON.stringify(original.songs.filter(s=>outputs.some(o=>o.songId===s.id)).map(s=>({id:s.id,parts:entries.filter(x=>x.songId===s.id).map(x=>x.part)})),null,2));
const manifest={createdAt:new Date().toISOString(),sourceCatalogue:plan.catalogueUrl,excludedSongs:plan.excludedSongs,songsWithoutAudio:plan.songsWithoutAudio,
  model:plan.jobs[0].settings,encoding:plan.encoding,files:outputs,totalFiles:outputs.length,totalBytes:outputs.reduce((s,o)=>s+o.bytes,0),
  notes:['No hosting changes were made. Only new MP3 filenames are in this bundle; original recordings and score assets already on the host remain in place.',
  'Replacement catalogue swaps in vocal-only recordings and one accompaniment per processed song. Append catalogue retains all original rows and adds labelled variants.',
  'The accompaniment is original all-voices mix minus its estimated vocals. It includes all remaining instruments and separation error.',
  'Accompaniment entries use voice/role accompaniment and are not monophonic pitch references.',
  'Every encoded MP3 was decoded locally and checked for sample-count preservation and alignment against its uncompressed signal.']};
atomic(resolve(plan.outputRoot,'manifest.json'),JSON.stringify(manifest,null,2));
atomic(resolve(plan.outputRoot,'checksums.sha256'),outputs.map(o=>`${o.sha256}  ${o.url}`).join('\n')+'\n');
copyFileSync('PIPELINE-NOTICE.txt',resolve(plan.outputRoot,'PIPELINE-NOTICE.txt'));
atomic(resolve(plan.outputRoot,'UPLOAD-NOTES.txt'),`CHOIR LIBRARY UPLOAD BUNDLE\n\n27 new MP3 files: 17 individual vocal-only parts, 5 vocal-only all-voices mixes, 5 accompaniment recordings.\n\n1. Copy the s/ folder onto the existing library host, merging its song folders. New files use -voice.mp3 and -acc.mp3 suffixes and do not overwrite originals.\n2. Choose songs.replace.json (recommended) or songs.append.json, review it, and publish your chosen file as songs.json. Both retain all score references and all five excluded songs unchanged. The unchanged audio and scores referenced by these catalogues must remain on the host.\n3. processed-parts.json contains just the five sets of new part entries for manual editing. manifest.json and checksums.sha256 document sources and validated files.\n4. Accompaniment entries use voice: accompaniment and role: accompaniment. The app should treat these as accompaniment, exclude them from pitch analysis and reference selection, and play only one per song. In an append catalogue, prefer vocal-only variants by default to avoid playing originals at the same time.\n5. index.html provides local listening controls. It is optional on the host. Metadata, provenance and notes need not be public.\n\nFiles are 44100 Hz MP3 with gapless timing metadata. Mono sources are delivered as mono at 128 kbps to preserve the app's audio-memory budget; stereo sources remain stereo at 160 kbps. Leading rests are retained. Locally retained 24-bit FLAC masters are outside this upload folder. No changes have been made to the hosted Library.\n\nExcluded unchanged: ${plan.excludedSongs.join(', ')}.\nNo source audio listed: ${plan.songsWithoutAudio.join(', ')}.\n`);
atomic(resolve(plan.outputRoot,'READY.txt'),`READY — ${new Date().toISOString()}\nAll ${outputs.length} MP3 files have been validated. See UPLOAD-NOTES.txt.\n`);
console.log(JSON.stringify({ready:true,files:outputs.length,bytes:manifest.totalBytes,folder:plan.outputRoot},null,2));
