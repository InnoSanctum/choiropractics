import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const profile=mkdtempSync(join(tmpdir(),'choiro-scnet-review-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--autoplay-policy=no-user-gesture-required','about:blank',
],{windowsHide:true,stdio:'ignore'});
let ws,call;
try{
 let port;for(let i=0;i<80;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break}catch{await new Promise(r=>setTimeout(r,250))}}
 const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j)});
 const pending=new Map(),errors=[];let id=0;
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text)});
 call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('Browser command timed out: '+method))},30000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(`!!(${expression})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+expression)};
 await call('Runtime.enable');await call('Page.enable');
 await call('Page.navigate',{url:pathToFileURL(resolve('results/index.html')).href});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await wait(`document.querySelectorAll('audio').length===18 && [...document.querySelectorAll('audio')].every(a=>a.readyState>=1)`);
 assert.equal(await evaluate(`document.querySelectorAll('section[data-id]').length`),6);
 assert.equal(await evaluate(`document.body.textContent.includes('44.6 dB below the mixture')`),true);
 const durations=await evaluate(`[...document.querySelectorAll('audio')].map(a=>({file:a.getAttribute('src'),seconds:a.duration,error:a.error?.message}))`);
 assert.ok(durations.every(d=>Number.isFinite(d.seconds)&&d.seconds>=24&&!d.error));
 await evaluate(`(()=>{const a=document.querySelector('audio');a.currentTime=3;a.play().catch(e=>console.error(e));})()`);
 await wait(`!document.querySelector('audio').paused && document.querySelector('audio').currentTime>3.1`);
 await evaluate(`document.querySelector('[data-switch="vocals"]').click()`);
 await wait(`!document.querySelector('audio[data-kind="vocals"]').paused && document.querySelector('audio[data-kind="original"]').paused`);
 const switched=await evaluate(`document.querySelector('audio[data-kind="vocals"]').currentTime`);assert.ok(switched>=3&&switched<7);
 await evaluate(`document.querySelector('.pause').click();const n=document.querySelector('[data-rating="notes"]');n.value='QA listening-note persistence';n.dispatchEvent(new Event('change',{bubbles:true}));`);
 await call('Page.reload');
 await wait(`document.querySelector('[data-rating="notes"]')?.value==='QA listening-note persistence'`);
 await evaluate(`const n=document.querySelector('[data-rating="notes"]');n.value='';n.dispatchEvent(new Event('change',{bubbles:true}));`);
 let shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('results/report-desktop.png',Buffer.from(shot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate(`document.documentElement.scrollWidth===innerWidth`),true);
 shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('results/report-mobile.png',Buffer.from(shot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate(`(()=>{const s=document.getElementById('connected-1-soprano');s.querySelector('details').open=true;s.scrollIntoView();})()`);
 shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('results/report-sample.png',Buffer.from(shot.data,'base64'));
 assert.deepEqual(errors,[]);
 const results={checkedAt:new Date().toISOString(),audioFiles:durations,checks:['All 18 WAVs load with expected duration','Audio switch preserves playhead and pauses original','Listening notes survive reload','Desktop and mobile layouts render','Mobile viewport has no horizontal page overflow','No browser JavaScript exceptions'],errors};
 writeFileSync('results/browser-check.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{
 if(call)await Promise.race([call('Browser.close').catch(()=>{}),new Promise(r=>setTimeout(r,1000))]);
 ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,600));
 if(resolve(profile).startsWith(resolve(tmpdir())+sep))try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:300})}catch{}
}
