import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { encodeStem } from './library-encode.mjs';
test('MP3 and FLAC encoding preserves gapless length for a non-frame-aligned stereo signal',()=>{
 const root=resolve('library-work'),dir=mkdtempSync(`${root}/encode-test-`);mkdirSync(`${dir}/tmp`);
 try{
   const channels=[0,1].map(c=>Float32Array.from({length:20003},(_,i)=>.25*Math.sin((i+c*20)*2*Math.PI*220/44100)));
   const out=encodeStem(channels,{gain:1,relative:'s/test/01-s-voice.mp3',outputRoot:`${dir}/out`,masterRoot:`${dir}/masters`,temporaryRoot:`${dir}/tmp`});
   assert.equal(out.decodedSamples,20003);assert.ok(out.encodingSnrDb>15);assert.ok(existsSync(out.master));
   const mono=encodeStem(channels,{gain:1,relative:'s/test/01-s-mono-voice.mp3',outputRoot:`${dir}/out`,masterRoot:`${dir}/masters`,temporaryRoot:`${dir}/tmp`,outputChannels:1});
   assert.equal(mono.decodedSamples,20003);assert.equal(mono.channels,1);assert.equal(mono.bitrateKbps,128);assert.ok(mono.encodingSnrDb>15);
 }finally{if(resolve(dir).startsWith(root+sep))rmSync(dir,{recursive:true,force:true});}
});
