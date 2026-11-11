import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import separate from '@audio/neural-separate';
import { load } from '@audio/neural-runtime';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
const backend=process.argv[2]??'cpu',threads=Number(process.argv[3]??2);
mkdirSync('results/backend-probe',{recursive:true});
const channels=[0,1].map(c=>{const b=readFileSync(`results/somebody-to-love-1-soprano/input-${c}.f32`);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).slice(8*44100,19*44100)});
const begin=performance.now(),cpu=process.cpuUsage();
let loadSeconds;
const result=await separate(channels,{model:'scnet',sampleRate:44100,weights:resolve('cache'),targets:['vocals'],session:async spec=>{
 const t=performance.now();
 const s=await load(spec,{backend:'node',executionProviders:[backend],sessionOptions:{intraOpNumThreads:threads,interOpNumThreads:1,executionMode:'sequential',enableCpuMemArena:false,enableMemPattern:false,logSeverityLevel:3}});
 loadSeconds=(performance.now()-t)/1000;return s;
}});
const metadata={backend,threads,loadSeconds,seconds:(performance.now()-begin)/1000,cpuSeconds:Object.values(process.cpuUsage(cpu)).reduce((s,n)=>s+n,0)/1e6,resource:process.resourceUsage()};
writeFileSync(`results/backend-probe/${backend}-${threads}.f32`,Buffer.from(result.stems.vocals[0].buffer));
writeFileSync(`results/backend-probe/${backend}-${threads}.json`,JSON.stringify(metadata,null,2));
console.log(JSON.stringify(metadata,null,2));
