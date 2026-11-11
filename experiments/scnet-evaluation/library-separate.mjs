// Resumable outer SCNet windowing, matching @audio/neural-separate 0.7.0.
// Its existing STFT, neural inference and ISTFT remain in use for every 11 s window.
// Normalization, reflection and crossfades follow separateComplex()/normalize().
// Copyright 2026 Dmitry Iv. and audiojs contributors (MIT); see PIPELINE-NOTICE.txt.
import separate from '@audio/neural-separate';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function reflectIndex(i,n){if(n===1)return 0;const period=2*(n-1);i=((i%period)+period)%period;return i<n?i:period-i;}
export function normalizeStats(channels){
  const C=channels.length,N=channels[0].length;let mean=0,sq=0;
  const monoAt=i=>{let v=0;for(let c=0;c<C;c++)v+=channels[c][i]/C;return v;};
  for(let i=0;i<N;i++)mean+=monoAt(i);mean/=N;
  for(let i=0;i<N;i++)sq+=(monoAt(i)-mean)**2;
  return {mean,std:Math.sqrt(sq/Math.max(1,N-1))+1e-8};
}
export async function separateResumable(channels,{session,cacheDir,onProgress=()=>{},sampleRate=44100}){
  if(sampleRate!==44100)throw Error('This pinned SCNet workflow requires 44100 Hz input.');
  const C=channels.length,N=channels[0].length,L=485100,step=Math.floor(L*.25),border=L-step;
  if(C!==2||channels.some(c=>c.length!==N))throw Error('Expected two equally sized channels.');
  mkdirSync(cacheDir,{recursive:true});
  const {mean,std}=normalizeStats(channels),wide=N>2*border,M=N+(wide?2*border:0),fade=Math.floor(L*.1),starts=[];
  for(let s=0;;s+=step){starts.push(s);if(s+L>=M)break;}
  const acc=Array.from({length:C},()=>new Float64Array(M)),wsum=new Float64Array(M);
  const originalIndex=i=>wide?reflectIndex(i-border,N):i;
  let inferred=0,reused=0;
  for(let k=0;k<starts.length;k++){
    const start=starts[k],len=Math.min(L,M-start),reflect=len>L/2,file=join(cacheDir,`${String(k).padStart(4,'0')}.f32`);
    let vocals;
    const cached=existsSync(file)?readFileSync(file):null;
    if(cached?.length===C*L*4){
      const bytes=cached;
      const all=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      vocals=Array.from({length:C},(_,c)=>all.subarray(c*L,(c+1)*L));reused++;
    }else{
      const seg=channels.map(ch=>{
        const s=new Float32Array(L);
        for(let i=0;i<L;i++)if(i<len||reflect){const j=i<len?i:reflectIndex(i,len);s[i]=(ch[originalIndex(start+j)]-mean)/std;}
        return s;
      });
      const result=await separate(seg,{model:'scnet',weights:resolve('cache'),sampleRate,targets:['vocals'],standardize:false,
        session:()=>({...session,free(){}})});
      vocals=result.stems.vocals;
      const packed=new Float32Array(C*L);vocals.forEach((ch,c)=>packed.set(ch,c*L));
      writeFileSync(file+'.partial',Buffer.from(packed.buffer));renameSync(file+'.partial',file);inferred++;
    }
    for(let i=0;i<len;i++){
      let w=1;if(k>0&&i<fade)w=i/(fade-1);if(k<starts.length-1&&i>=L-fade)w=Math.min(w,(L-1-i)/(fade-1));
      wsum[start+i]+=w;for(let c=0;c<C;c++)acc[c][start+i]+=vocals[c][i]*w;
    }
    onProgress({completed:k+1,total:starts.length,reused,inferred});
  }
  const vocals=acc.map(a=>{
    const out=Float32Array.from({length:N},(_,i)=>{const j=i+(wide?border:0);return wsum[j]>0?a[j]/wsum[j]:0;});
    for(let i=0;i<N;i++)out[i]*=std;return out;
  });
  return {vocals,normalization:{mean,std},windows:starts.length,inferred,reused};
}
