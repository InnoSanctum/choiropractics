import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import separate from '@audio/neural-separate';
import { separateResumable } from './library-separate.mjs';

test('resumable windowing matches upstream normalization, reflection, padding and crossfades',async()=>{
  const N=Math.round(20.013*44100),input=[0,1].map(c=>Float32Array.from({length:N},(_,i)=>.01+.1*Math.sin(i*.017+c*.2)+.03*Math.sin(i*.013)));
  const makeSession=()=>{const session={inputs:[{name:'mix_spec',dims:[1,4,2049,476]}],outputs:[{name:'stems_spec'}],calls:0,
    async run(feeds){session.calls++;const x=feeds.mix_spec,output=new Float32Array(x.data.length*4),base=x.data.length*3;
      for(let i=0;i<x.data.length;i++)output[base+i]=x.data[i]/(1+Math.abs(x.data[i])*.01);
      return {stems_spec:{data:output,dims:[1,16,2049,476],type:'float32'}};},free(){}};return session;};
  const reference=await separate(input,{model:'scnet',weights:resolve('cache'),sampleRate:44100,targets:['vocals'],session:()=>makeSession()});
  const root=resolve('library-work');const cache=mkdtempSync(`${root}/window-test-`);
  try{
    const session=makeSession(),actual=await separateResumable(input,{session,cacheDir:cache});
    assert.ok(session.calls>1);let max=0;
    for(let c=0;c<2;c++)for(let i=0;i<N;i++)max=Math.max(max,Math.abs(reference.stems.vocals[c][i]-actual.vocals[c][i]));
    assert.ok(max<1e-6,`Maximum difference ${max}`);
    const cachedSession=makeSession(),resumed=await separateResumable(input,{session:cachedSession,cacheDir:cache});
    assert.equal(cachedSession.calls,0);assert.equal(resumed.reused,actual.windows);
    assert.deepEqual(resumed.vocals,actual.vocals);
  }finally{if(resolve(cache).startsWith(root+sep))rmSync(cache,{recursive:true,force:true});}
});
