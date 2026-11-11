import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export function encodeStem(channels,{gain,relative,outputRoot,masterRoot,temporaryRoot,outputChannels=2}){
  const ffmpeg=resolve('node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),N=channels[0].length;
  const C=outputChannels,bitrateKbps=C===1?128:160,interleaved=new Float32Array(N*C);
  for(let i=0;i<N;i++)for(let c=0;c<C;c++)interleaved[C*i+c]=(C===1?(channels[0][i]+channels[1][i])/2:channels[c][i])*gain;
  const tag=relative.replace(/[^a-zA-Z0-9-]/g,'_');
  const raw=resolve(temporaryRoot,`${tag}.f32`),checkPath=resolve(temporaryRoot,`${tag}.check.f32`);
  writeFileSync(raw,Buffer.from(interleaved.buffer));
  const file=resolve(outputRoot,relative),master=resolve(masterRoot,relative.replace(/\.mp3$/,'.flac'));
  for(const path of [file,master])mkdirSync(dirname(path),{recursive:true});
  const run=args=>{const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw Error(`FFmpeg failed: ${r.error?.message??r.stderr}`);};
  const args=['-f','f32le','-ar','44100','-ac',String(C),'-i',raw,'-map_metadata','-1','-threads','1'];
  run([...args,'-c:a','libmp3lame','-b:a',`${bitrateKbps}k`,'-write_xing','1',file+'.partial.mp3']);
  run([...args,'-c:a','flac','-sample_fmt','s32','-bits_per_raw_sample','24',master+'.partial.flac']);
  run(['-i',file+'.partial.mp3','-f','f32le','-ar','44100','-ac',String(C),checkPath]);
  const decodedBytes=readFileSync(checkPath),check=new Float32Array(decodedBytes.buffer,decodedBytes.byteOffset,decodedBytes.byteLength/4);
  const decodedSamples=check.length/C;
  if(Math.abs(decodedSamples-N)>1)throw Error(`Gapless duration mismatch for ${relative}: expected ${N}, decoded ${decodedSamples}`);
  let energy=0,error=0;
  for(let i=0;i<check.length;i++){if(!Number.isFinite(check[i]))throw Error('Non-finite encoded sample.');energy+=interleaved[i]**2;error+=(check[i]-interleaved[i])**2;}
  const encodingSnrDb=10*Math.log10(Math.max(energy,1e-30)/Math.max(error,1e-30));
  if(energy>1e-4&&encodingSnrDb<8)throw Error(`MP3 alignment/encoding check failed for ${relative}: ${encodingSnrDb} dB`);
  renameSync(file+'.partial.mp3',file);renameSync(master+'.partial.flac',master);
  for(const path of [raw,checkPath])rmSync(path);
  return {path:relative,master,bytes:statSync(file).size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),durationSeconds:N/44100,decodedSamples,encodingSnrDb,channels:C,bitrateKbps};
}
