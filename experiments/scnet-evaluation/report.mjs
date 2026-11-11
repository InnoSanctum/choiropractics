import { readFileSync, writeFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from '../../tests/load-typescript.mjs';

const { BatchPitchExtractor } = loadTypescript(fileURLToPath(new URL('../../src/audio/BatchPitchExtractor.ts', import.meta.url)));
const manifest=JSON.parse(readFileSync('results/manifest.json','utf8'));
const data=[],htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/Math.max(1,a.length));
const db=(a,b)=>20*Math.log10(Math.max(a,1e-12)/Math.max(b,1e-12));
const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const round=(v,n=1)=>Number(v.toFixed(n));
const readFloat=path=>{const b=readFileSync(path);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
for(const clip of manifest.excerpts){
  const dir=`results/${clip.id}`;
  if(!existsSync(`${dir}/metrics.json`)||!existsSync(`${dir}/monitor-summary.json`)){console.log('Not complete:',clip.id);continue;}
  console.log('Pitch comparison:',clip.id);
  const metrics=JSON.parse(readFileSync(`${dir}/metrics.json`,'utf8'));
  const monitor=JSON.parse(readFileSync(`${dir}/monitor-summary.json`,'utf8'));
  let pitch,quality;
  const analysisPath=`${dir}/analysis.json`;
  if(existsSync(analysisPath))({pitch,quality}=JSON.parse(readFileSync(analysisPath,'utf8')));
  else{
    const signals=Object.fromEntries(['original','vocals','accompaniment'].map(n=>[n,readFloat(`${dir}/${n}.f32`)]));
    pitch={};
    for(const [name,samples] of Object.entries(signals)){
      const buffer={sampleRate:clip.sampleRate,numberOfChannels:1,length:samples.length,duration:samples.length/clip.sampleRate,getChannelData:()=>samples};
      const frames=await BatchPitchExtractor.extractPitchFromAudioBuffer(buffer,{enableBandpass:true,vocalPreset:'all'});
      pitch[name]=frames.map(f=>({time:f.timestamp,midi:f.voiced?f.exactMidi:null,strength:f.strength}));
    }
    let both=0,changed=0,removed=0,added=0;
    for(let i=0;i<pitch.original.length;i++){
      const o=pitch.original[i].midi,v=pitch.vocals[i]?.midi??null;
      if(o!==null&&v!==null){both++;if(Math.abs(o-v)>0.5)changed++;}
      if(o!==null&&v===null)removed++;
      if(o===null&&v!==null)added++;
    }
    const energy=[];
    for(let s=0;s<clip.duration;s++){
      const a=Math.floor(s*clip.sampleRate),b=Math.min(signals.original.length,Math.floor((s+1)*clip.sampleRate));
      energy.push({second:s,originalRms:rms(signals.original.subarray(a,b)),vocalsRms:rms(signals.vocals.subarray(a,b)),accompanimentRms:rms(signals.accompaniment.subarray(a,b))});
    }
    let error=0,base=0;
    for(let i=0;i<signals.original.length;i++){
      const e=signals.original[i]-signals.vocals[i]-signals.accompaniment[i];error+=e*e;base+=signals.original[i]**2;
    }
    quality={vocalLevelRelativeToMixDb:db(rms(signals.vocals),rms(signals.original)),accompanimentLevelRelativeToMixDb:db(rms(signals.accompaniment),rms(signals.original)),
      voicedPercent:Object.fromEntries(Object.entries(pitch).map(([n,frames])=>[n,100*frames.filter(f=>f.midi!==null).length/frames.length])),
      overlapFrames:both,changedPitchPercentOfOverlap:100*changed/Math.max(1,both),removedPitchPercentOfAllFrames:100*removed/Math.max(1,pitch.original.length),addedPitchPercentOfAllFrames:100*added/Math.max(1,pitch.original.length),
      reconstructionErrorDb:10*Math.log10(Math.max(error,1e-30)/Math.max(base,1e-30)),energy,
      interpretation:'Pitch differences and energy ratios are descriptive proxies, not accuracy, SDR, SIR, or measured vocal leakage. No isolated reference stems or time-aligned reference melody are provided by the Library.'};
    writeFileSync(analysisPath,JSON.stringify({pitch,quality}));
  }
  const csv=readFileSync(`${dir}/load.csv`,'utf8').trim().split(/\r?\n/),keys=csv.shift().split(',');
  const load=csv.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[keys[i],keys[i]==='phase'?v:Number(v)])));
  data.push({...clip,metrics,monitor,quality,pitch,load});
}
if(!data.length)throw Error('No completed measurements.');
const totalAudio=data.reduce((s,d)=>s+d.duration,0),totalProcessing=data.reduce((s,d)=>s+d.metrics.separationSeconds,0);
const directoryBytes=path=>{const s=lstatSync(path);return s.isSymbolicLink()?0:s.isDirectory()?readdirSync(path).reduce((sum,name)=>sum+directoryBytes(`${path}/${name}`),0):s.size};
const reviewFlags=data.filter(d=>d.quality.vocalLevelRelativeToMixDb < -25).map(d=>({id:d.id,title:d.title,
  vocalLevelRelativeToMixDb:d.quality.vocalLevelRelativeToMixDb,voicedOriginalPercent:d.quality.voicedPercent.original,voicedSeparatedPercent:d.quality.voicedPercent.vocals,
  reason:'Estimated vocals are much quieter than the mixture. Verify whether this recording is instrumental or whether wanted singing has been removed. Do not automatically replace the original.'}));
const summary={generatedAt:new Date().toISOString(),machine:manifest.machine,model:manifest.model,dependencies:manifest.dependencies,threads:manifest.threads,
  totalAudioSeconds:totalAudio,totalSeparationSeconds:totalProcessing,weightedRealTimeFactor:totalProcessing/totalAudio,
  peakWorkingSetMiB:Math.max(...data.map(d=>d.monitor.peakWorkingSetBytes))/2**20,
  peakPrivateCommitMiB:Math.max(...data.map(d=>d.monitor.peakPrivateCommitBytes))/2**20,
  minimumFreeRamMiB:Math.min(...data.map(d=>d.monitor.minimumAvailablePhysicalBytes))/2**20,
  installedFootprint:{evaluationDependenciesBytes:directoryBytes('node_modules'),windowsNativeRuntimeBytes:directoryBytes('node_modules/onnxruntime-node/bin/napi-v6/win32/x64'),separatorPackageBytes:directoryBytes('node_modules/@audio/neural-separate'),note:'Local installed files, including runtime binaries for multiple platforms. Not a browser download size; existing Node and Python installations are excluded.'},
  reviewFlags,recommendation:'Review separated audio per recording and preserve the original. Measured CPU and memory costs favour preparing approved Library stems once; browser and mobile suitability remain untested.',
  excerpts:data.map(({pitch,load,...d})=>d),limitations:[
    'Native CPU test on this PC, not a browser, phone, GPU, or real-time microphone test.',
    'The PC had other work running. System CPU includes other applications; process CPU is measured separately.',
    'Downloads and MP3 decoding were completed before measurement. Each excerpt loads a fresh model session; chunks reuse that session.',
    'Default SCNet overlap is retained (step 0.25); two ONNX intra-op threads, one inter-op thread, sequential execution, CPU arena and memory pattern disabled.',
    'Accompaniment is original minus estimated vocals: all remaining instruments and separation error, not a guaranteed isolated piano stem.',
    'No clean reference stems or aligned reference melody; objective source-separation quality and diagram accuracy cannot be scored.',
    'No independent human listening assessment has been performed. Use the player to rate piano leakage, missing singing, and artificial sound.',
    'The same attenuation gain is used for all three WAVs in each excerpt to prevent clipping; individual stems are not loudness-normalized.',
    'Memory measurements are Windows process working set and private commit, sampled externally every 250 ms; reported peak working set also uses the OS high-water mark.',
  ]};
writeFileSync('results/summary.json',JSON.stringify(summary,null,2));
writeFileSync('results/SCNET-NOTICE.txt',readFileSync('node_modules/@audio/neural-separate/NOTICE'));
const fmt=(n,d=1)=>Number(n).toFixed(d),mb=n=>fmt(n/2**20,0),clock=n=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
function pitchPlot(d){
 const W=920,H=220,L=48,T=16,B=28,all=Object.values(d.pitch).flat().filter(f=>f.midi!==null).map(f=>f.midi);
 const lo=Math.floor(Math.min(42,...all)/12)*12,hi=Math.max(lo+24,Math.ceil(Math.max(78,...all)/12)*12);
 const x=t=>L+t/d.duration*(W-L-12),y=m=>T+(hi-m)/(hi-lo)*(H-T-B);
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pitch tracker comparison for ${htmlEscape(d.title)}"><rect width="${W}" height="${H}" fill="#101b29"/>`;
 for(let m=lo;m<=hi;m+=12)svg+=`<path d="M${L} ${y(m)}H${W}" stroke="#304051"/><text x="4" y="${y(m)+4}" fill="#a9b9cc" font-size="12">C${m/12-1}</text>`;
 for(let t=0;t<=d.duration;t+=5)svg+=`<text x="${x(t)}" y="${H-6}" fill="#a9b9cc" font-size="12">${t}s</text>`;
 for(const [name,color] of [['accompaniment','#8f83c7'],['original','#ef9f62'],['vocals','#63dfba']]){
   let path='',last=null;
   for(const f of d.pitch[name]){
     if(f.midi===null){last=null;continue;}
     const join=last&&f.time-last.time<.04&&Math.abs(f.midi-last.midi)<2;
     path+=`${join?'L':'M'}${x(f.time).toFixed(1)},${y(f.midi).toFixed(1)}`;last=f;
   }
   svg+=`<path d="${path}" stroke="${color}" stroke-width="${name==='vocals'?2:1.2}" opacity="${name==='vocals'?1:.7}" fill="none"/>`;
 }return svg+'</svg>';
}
function loadPlot(d){
 const W=920,H=150,L=48,T=12,B=24,maxTime=Math.max(...d.load.map(r=>r.elapsedSeconds));
 let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="CPU and memory over processing time"><rect width="${W}" height="${H}" fill="#101b29"/>`;
 const series=[['systemCpuPercent','#e7ad66',100],['processCpuPercentOfMachine','#63dfba',100],['workingSetBytes','#75aeff',Math.max(2**30,d.monitor.peakWorkingSetBytes)]];
 for(const [key,color,max]of series){let p='';for(const r of d.load){if(!Number.isFinite(r[key]))continue;p+=`${p?'L':'M'}${(L+r.elapsedSeconds/maxTime*(W-L-12)).toFixed(1)},${(T+(1-r[key]/max)*(H-T-B)).toFixed(1)}`;}s+=`<path d="${p}" stroke="${color}" stroke-width="1.3" fill="none"/>`;}
 s+=`<text x="4" y="20" fill="#a9b9cc" font-size="11">100%</text><text x="4" y="${H-B}" fill="#a9b9cc" font-size="11">0%</text><text x="${L}" y="${H-5}" fill="#a9b9cc" font-size="11">0s</text><text x="${W-75}" y="${H-5}" fill="#a9b9cc" font-size="11">${fmt(maxTime,0)}s</text></svg>`;
 return s+`<div class="legend"><span style="color:#63dfba">Process CPU</span><span style="color:#e7ad66">Whole PC CPU</span><span style="color:#75aeff">RAM (top = ${mb(Math.max(2**30,d.monitor.peakWorkingSetBytes))} MiB)</span></div>`;
}
function listeningCues(d){
 const cues=[];let start=null;
 for(let i=0;i<=d.quality.energy.length;i++){
   const e=d.quality.energy[i],suppressed=e&&e.originalRms>.005&&db(e.vocalsRms,e.originalRms)<-30;
   if(suppressed&&start===null)start=i;
   if(!suppressed&&start!==null){if(i-start>=2)cues.push({time:start,text:`${start}–${i}s: strongly suppressed passage — check whether only instruments should remain`});start=null;}
 }
 let held=null;
 for(const f of d.pitch.vocals){
   if(f.midi!==null&&held&&Math.abs(f.midi-held.midi)<.4)held.end=f.time;
   else{if(held&&held.end-held.start>=1.2)cues.push({time:Math.max(0,held.start-.3),text:`${fmt(held.start,1)}s: sustained detected note — check for missing vowel or piano leakage`});held=f.midi===null?null:{start:f.time,end:f.time,midi:f.midi};}
 }
 return cues.slice(0,4).map(c=>`<button data-cue="${c.time}">${htmlEscape(c.text)}</button>`).join('');
}
const rows=data.map(d=>`<tr><td><a href="#${d.id}">${htmlEscape(d.title)} · ${d.voice}</a></td><td>${fmt(d.duration,0)}s</td><td>${fmt(d.metrics.separationSeconds,0)}s</td><td>${fmt(d.metrics.realTimeFactor,2)}×</td><td>${fmt(d.metrics.averageCpuPercentOfMachine)}%</td><td>${fmt(d.monitor.baselineSystemCpuPercent)} → ${fmt(d.monitor.averageSystemCpuPercent)}%</td><td>${mb(d.monitor.peakWorkingSetBytes)}</td><td>${mb(d.monitor.peakPrivateCommitBytes)}</td></tr>`).join('');
const reviewNotice=reviewFlags.length?`<p class="note"><b>Listen before adopting: ${reviewFlags.map(f=>`<a href="#${f.id}">${htmlEscape(f.title)}</a>`).join(', ')}.</b> ${reviewFlags.map(f=>`Its estimated vocals are ${fmt(-f.vocalLevelRelativeToMixDb)} dB below the mixture; detected pitch drops from ${fmt(f.voicedOriginalPercent)}% to ${fmt(f.voicedSeparatedPercent)}% of frames.`).join(' ')} This could be instrumental guide audio or wanted singing that the model has removed. The measurements alone cannot decide. Preserve the original and review each recording.</p>`:'';
const cards=data.map(d=>`<section id="${d.id}" data-id="${d.id}"><div class="section-head"><div><p class="eyebrow">${htmlEscape(d.voice)} · SOURCE ${clock(d.start)}–${clock(d.start+d.duration)}</p><h2>${htmlEscape(d.title)}</h2></div><a href="${htmlEscape(d.url)}">Library recording ↗</a></div><p class="muted">${htmlEscape(d.purpose)}</p>
<div class="audio-grid">${[['original','Original mixture'],['vocals','Estimated vocals'],['accompaniment','Estimated accompaniment']].map(([key,label])=>`<div><h3>${label}</h3><audio controls preload="metadata" data-kind="${key}" src="${d.id}/${key}.wav"></audio><button data-switch="${key}">Switch here at same time</button><a download href="${d.id}/${key}.wav">Download WAV</a></div>`).join('')}</div>
<div class="controls"><label>Listen from <input type="number" class="seek" value="0" min="0" max="${d.duration}" step="0.5"> seconds</label><button class="seek-all">Set all players</button><button class="pause">Pause</button><label><input type="checkbox" class="loop"> Loop excerpt</label></div>
<div class="controls">${listeningCues(d)}</div>
<p class="small">Shared playback gain ${fmt(d.metrics.sharedPlaybackGain,3)}. Compare at the same volume; a quieter stem is not proof of better separation.</p>
<details><summary>Pitch comparison and signal measurements</summary><div class="legend"><span style="color:#ef9f62">Original</span><span style="color:#63dfba">Vocals</span><span style="color:#8f83c7">Accompaniment</span></div>${pitchPlot(d)}<p class="small">The app’s current pitch extractor, same settings for every signal. Differences show what changes; they do not establish which diagram is correct.</p>
<div class="stats"><span>Pitch detected: original <b>${fmt(d.quality.voicedPercent.original)}%</b> · vocals <b>${fmt(d.quality.voicedPercent.vocals)}%</b></span><span>Changed pitch where both detect a note: <b>${fmt(d.quality.changedPitchPercentOfOverlap)}%</b></span><span>Vocal output RMS relative to mix: <b>${fmt(d.quality.vocalLevelRelativeToMixDb)} dB</b></span></div>
<p class="small">“Pitch detected” includes pitched instruments. RMS ratios measure output level, not vocal leakage or separation accuracy.</p></details>
<details><summary>CPU and memory recording</summary>${loadPlot(d)}<p class="small">Peak process working set ${mb(d.monitor.peakWorkingSetBytes)} MiB; peak private commit ${mb(d.monitor.peakPrivateCommitBytes)} MiB; minimum free system RAM ${mb(d.monitor.minimumAvailablePhysicalBytes)} MiB. Model load ${fmt(d.metrics.modelLoads[0].wallSeconds,2)}s; ${d.metrics.inferenceRuns.length} inference chunks. <a href="${d.id}/load.csv">Raw 250 ms samples (CSV)</a> · <a href="${d.id}/metrics.json">Timing JSON</a></p></details>
<details><summary>Your listening notes</summary><div class="ratings">${['Piano left in vocals','Singing lost into accompaniment','Metallic / watery artifacts'].map((label,i)=>`<label>${label}<select data-rating="${i}"><option value="">Not rated</option><option>None</option><option>Slight</option><option>Noticeable</option><option>Severe</option></select></label>`).join('')}<label>Notes and timestamps<textarea data-rating="notes" rows="3" placeholder="For example: vocals disappear at 8.5s; piano remains at 16s"></textarea></label></div></details></section>`).join('');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SCNet · Choir Library evaluation</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0a111c;color:#e7edf5;font:16px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px 70px}h1{font-size:clamp(30px,5vw,48px);line-height:1.12;letter-spacing:-1.4px;margin:10px 0 18px}h2{margin:3px 0;font-size:26px}h3{font-size:14px;margin:0 0 9px}a{color:#86c6ff}p{max-width:920px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:1.6px;color:#63dfba;margin:0}.muted,.small{color:#a7b6c8}.small{font-size:13px}.overview{display:flex;flex-wrap:wrap;gap:12px;margin:25px 0}.overview>div{flex:1;min-width:150px;border:1px solid #2c3e52;padding:17px;border-radius:12px;background:#111e2d}.overview b{display:block;font-size:28px}.overview span{color:#a7b6c8;font-size:13px}.table-wrap{overflow-x:auto;border:1px solid #2c3e52;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:13px 12px;border-bottom:1px solid #253448;text-align:left;white-space:nowrap}th{background:#142235}section{margin-top:28px;padding:25px;border:1px solid #2c3e52;border-radius:16px;background:#0f1a29;scroll-margin-top:15px}.section-head{display:flex;justify-content:space-between;gap:15px;align-items:center}.section-head>a{font-size:12px}.audio-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.audio-grid>div{background:#152437;padding:14px;border-radius:12px}.audio-grid>div:nth-child(2){border:1px solid #3b997f}audio{width:100%;height:42px}.audio-grid a{display:block;font-size:12px;margin-top:10px}button,select,input,textarea{font:inherit;border:1px solid #426078;border-radius:7px;background:#122338;color:#e7edf5;padding:7px 10px}button{cursor:pointer;font-size:12px;margin-top:9px}button:hover{background:#26415c}input[type=number]{width:75px}input[type=checkbox]{accent-color:#63dfba}.controls,.legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center}.controls{font-size:13px;margin-top:15px}.controls button{margin:0}.legend{font-size:12px;margin:12px 0}details{border-top:1px solid #293a4e;padding:13px 0}summary{cursor:pointer;font-weight:600;font-size:14px}svg{width:100%;height:auto;display:block;border-radius:8px}.stats{display:grid;gap:5px;font-size:13px}.ratings{display:grid;gap:12px;margin-top:15px}.ratings label{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px}textarea{width:100%}.note{border-left:3px solid #e7ad66;padding:12px 16px;background:#1e2330;border-radius:0 8px 8px 0}.limitations li{margin:9px 0;color:#b2c0d1;font-size:14px}@media(max-width:700px){main{padding:24px 12px}.audio-grid{grid-template-columns:1fr}section{padding:17px}.section-head{display:block}.overview b{font-size:23px}}
</style><main><p class="eyebrow">CHOIROPRACTICS · LOCAL EXPERIMENT</p><h1>Voice out. Piano left behind?</h1><p>Six excerpts from your choir Library, separated by the small SCNet model. Compare the original with estimated vocals and accompaniment, then inspect the actual processing load on this PC.</p>
<div class="overview"><div><b>${data.length} excerpts</b><span>${fmt(totalAudio,0)} seconds of source audio</span></div><div><b>${fmt(summary.weightedRealTimeFactor,2)}×</b><span>processing time / audio duration</span></div><div><b>${fmt(summary.peakWorkingSetMiB,0)} MiB</b><span>peak process working set</span></div><div><b>${fmt(manifest.model.bytes/1e6,1)} MB</b><span>verified compact model</span></div></div>
<p class="note"><b>Read this as a local feasibility test.</b> These recordings have no clean reference stems, so no defensible leakage percentage or pitch-accuracy score can be calculated. Listen for piano left in vocals, missing singing, and artifacts. Native CPU results do not establish browser or phone performance.</p>
<p class="small">${htmlEscape(manifest.machine.cpu)} · ${manifest.machine.logicalProcessors} logical processors · ${fmt(manifest.machine.totalRamBytes/2**30,2)} GiB RAM · CPU provider · ${manifest.threads} configured inference threads · default 75% segment overlap. System load includes other applications.</p>
<div class="table-wrap"><table><thead><tr><th>Recording</th><th>Audio</th><th>Process</th><th>RTF ↓</th><th>Process CPU¹</th><th>PC CPU²</th><th>Peak RAM MiB</th><th>Commit MiB</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small">¹ Average during separation, normalized across all ${manifest.machine.logicalProcessors} logical processors; 100% = entire CPU. ² Whole PC average before → during this excerpt. RTF below 1 means faster than playback. Model download and MP3 decoding are excluded.</p>
${reviewNotice}
${cards}<section><h2>What was measured</h2><ul class="limitations">${summary.limitations.map(s=>`<li>${htmlEscape(s)}</li>`).join('')}</ul><p class="small">Installed evaluation dependencies occupy ${mb(summary.installedFootprint.evaluationDependenciesBytes)} MiB; the Windows native runtime folder is ${mb(summary.installedFootprint.windowsNativeRuntimeBytes)} MiB. These are local installation sizes, not browser download sizes; existing Node and Python are excluded.</p><p class="small">Reproduce from this experiment folder: <code>node prepare.mjs</code>, <code>python monitor.py</code>, <code>node report.mjs</code>. Completed runs are retained. This test does not change the app.</p><p><a href="summary.json">Full results JSON</a> · <a href="manifest.json">Sources, versions and model checksum</a> · <a href="SCNET-NOTICE.txt">Pipeline notices and credits</a> · <a href="https://github.com/starrytong/SCNet/issues/35">SCNet weight licence</a></p><p class="small">Generated ${htmlEscape(new Date().toISOString())}. Notes are stored only in this browser when local storage is available.</p></section></main><script>
let active=null;
document.querySelectorAll('audio').forEach(audio=>audio.addEventListener('play',()=>{document.querySelectorAll('audio').forEach(a=>{if(a!==audio)a.pause()});active=audio}));
document.querySelectorAll('section[data-id]').forEach(section=>{
 const players=[...section.querySelectorAll('audio')];
 section.querySelectorAll('[data-switch]').forEach(button=>button.onclick=async()=>{const target=players.find(a=>a.dataset.kind===button.dataset.switch),from=active&&section.contains(active)?active:players.find(a=>a.currentTime>0);const t=from?.currentTime||Number(section.querySelector('.seek').value)||0;players.forEach(a=>a.pause());target.currentTime=Math.min(t,Math.max(0,(target.duration||999)-.01));try{await target.play()}catch(e){alert('Use the audio play button: '+e.message)}});
 section.querySelector('.pause').onclick=()=>players.forEach(a=>a.pause());
 section.querySelector('.seek-all').onclick=()=>{const t=Number(section.querySelector('.seek').value)||0;players.forEach(a=>a.currentTime=Math.min(t,Math.max(0,(a.duration||999)-.01)))};
 section.querySelectorAll('[data-cue]').forEach(b=>b.onclick=()=>{section.querySelector('.seek').value=b.dataset.cue;section.querySelector('.seek-all').click()});
 section.querySelector('.loop').onchange=e=>players.forEach(a=>a.loop=e.target.checked);
 section.querySelectorAll('[data-rating]').forEach(input=>{const key='scnet-review:'+section.dataset.id+':'+input.dataset.rating;try{input.value=localStorage.getItem(key)||''}catch{}input.addEventListener('change',()=>{try{localStorage.setItem(key,input.value)}catch{}})});
});
</script></html>`;
writeFileSync('results/index.html',html);
console.log(JSON.stringify({totalAudioSeconds:totalAudio,totalSeparationSeconds:round(totalProcessing),weightedRealTimeFactor:round(summary.weightedRealTimeFactor,2),peakWorkingSetMiB:round(summary.peakWorkingSetMiB),minimumFreeRamMiB:round(summary.minimumFreeRamMiB),report:fileURLToPath(new URL('results/index.html',import.meta.url))},null,2));
