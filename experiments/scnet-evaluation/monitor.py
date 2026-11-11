"""Windows external sampler: captures native inference load even while Node's event loop is busy."""
import csv, ctypes as C, json, os, subprocess, sys, time
from ctypes import wintypes as W
from pathlib import Path

ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
kernel=C.WinDLL('kernel32',use_last_error=True)
psapi=C.WinDLL('psapi',use_last_error=True)
class MEMORY(C.Structure):
    _fields_=[('length',W.DWORD),('load',W.DWORD)]+[(n,C.c_ulonglong) for n in ['totalPhysical','availablePhysical','totalPageFile','availablePageFile','totalVirtual','availableVirtual','availableExtendedVirtual']]
class PMC(C.Structure):
    _fields_=[('cb',W.DWORD),('pageFaultCount',W.DWORD)]+[(n,C.c_size_t) for n in ['peakWorkingSet','workingSet','quotaPeakPagedPool','quotaPagedPool','quotaPeakNonPagedPool','quotaNonPagedPool','pagefileUsage','peakPagefileUsage','privateUsage']]
kernel.GetSystemTimes.argtypes=[C.POINTER(W.FILETIME)]*3
kernel.GetProcessTimes.argtypes=[W.HANDLE]+[C.POINTER(W.FILETIME)]*4
kernel.GlobalMemoryStatusEx.argtypes=[C.POINTER(MEMORY)]
psapi.GetProcessMemoryInfo.argtypes=[W.HANDLE,C.POINTER(PMC),W.DWORD]
def ft(v): return (v.dwHighDateTime<<32)|v.dwLowDateTime
def snapshot(process=None):
    idle,k,u=W.FILETIME(),W.FILETIME(),W.FILETIME()
    if not kernel.GetSystemTimes(C.byref(idle),C.byref(k),C.byref(u)): raise C.WinError(C.get_last_error())
    m=MEMORY();m.length=C.sizeof(m)
    if not kernel.GlobalMemoryStatusEx(C.byref(m)):raise C.WinError(C.get_last_error())
    row={'monotonic':time.monotonic(),'systemTicks':ft(k)+ft(u),'idleTicks':ft(idle),'availablePhysicalBytes':m.availablePhysical,'memoryLoadPercent':m.load,'availableCommitBytes':m.availablePageFile}
    if process is not None and process.poll() is None:
        p=PMC();p.cb=C.sizeof(p)
        if psapi.GetProcessMemoryInfo(W.HANDLE(int(process._handle)),C.byref(p),p.cb):
            row.update(workingSetBytes=p.workingSet,peakWorkingSetBytes=p.peakWorkingSet,privateCommitBytes=p.privateUsage,pageFaultCount=p.pageFaultCount)
        created,exited,pk,pu=W.FILETIME(),W.FILETIME(),W.FILETIME(),W.FILETIME()
        if kernel.GetProcessTimes(W.HANDLE(int(process._handle)),C.byref(created),C.byref(exited),C.byref(pk),C.byref(pu)):row['processCpuSeconds']=(ft(pk)+ft(pu))/1e7
    return row
manifest=json.loads(Path('results/manifest.json').read_text('utf-8'))
clips=[e for e in manifest['excerpts'] if not sys.argv[1:] or e['id'] in sys.argv[1:]]
all_summary=[]
for clip in clips:
    folder=Path('results')/clip['id']
    if (folder/'metrics.json').exists() and (folder/'monitor-summary.json').exists():
        print('Already complete:',clip['id'],flush=True);continue
    print('Baseline:',clip['id'],flush=True)
    baseline=[]
    for _ in range(12):baseline.append(snapshot());time.sleep(.25)
    log=(folder/'run.log').open('w',encoding='utf-8')
    process=subprocess.Popen(['node','--max-old-space-size=2048','worker.mjs',clip['id']],stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    print('Running:',clip['id'],'PID',process.pid,flush=True)
    start=time.monotonic();prev=baseline[-1];rows=[];low_since=None;last_update=start
    try:
        while process.poll() is None:
            time.sleep(.25);r=snapshot(process);delta=r['monotonic']-prev['monotonic']
            total=r['systemTicks']-prev['systemTicks'];idle=r['idleTicks']-prev['idleTicks']
            r['systemCpuPercent']=100*(1-idle/total) if total>0 else 0
            r['elapsedSeconds']=r['monotonic']-start
            if 'processCpuSeconds' in prev and 'processCpuSeconds' in r:
                r['processCpuPercentOfMachine']=100*(r['processCpuSeconds']-prev['processCpuSeconds'])/delta/manifest['machine']['logicalProcessors']
            try:r['phase']=json.loads((folder/'stage.json').read_text())['phase']
            except (OSError,ValueError):r['phase']='starting'
            rows.append(r);prev=r
            if r['availablePhysicalBytes']<128*2**20:low_since=low_since or time.monotonic()
            else:low_since=None
            if low_since and time.monotonic()-low_since>10:raise RuntimeError('Available memory stayed below 128 MiB for 10 seconds; stopped this run.')
            if time.monotonic()-start>900:raise RuntimeError('Excerpt exceeded 15 minute measurement limit.')
            if time.monotonic()-last_update>15:
                print(f"  {r['elapsedSeconds']:.0f}s {r['phase']} RSS {r.get('workingSetBytes',0)/2**20:.0f} MiB; process CPU {r.get('processCpuPercentOfMachine',0):.0f}%; system CPU {r['systemCpuPercent']:.0f}%; free RAM {r['availablePhysicalBytes']/2**20:.0f} MiB",flush=True);last_update=time.monotonic()
    except BaseException:
        process.terminate();process.wait();raise
    finally:
        log.close()
        fields=sorted(set().union(*(r.keys() for r in rows))) if rows else []
        with (folder/'load.csv').open('w',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
    if process.returncode:raise RuntimeError(f"{clip['id']} failed ({process.returncode}); see {folder/'run.log'}")
    def average_cpu(samples):
        first,last=samples[0],samples[-1];total=last['systemTicks']-first['systemTicks']
        return 100*(1-(last['idleTicks']-first['idleTicks'])/total) if total else 0
    summary={'sampleIntervalSeconds':.25,'baselineSeconds':baseline[-1]['monotonic']-baseline[0]['monotonic'],'baselineSystemCpuPercent':average_cpu(baseline),
      'baselineAvailablePhysicalBytes':sum(r['availablePhysicalBytes'] for r in baseline)/len(baseline),'workerWallSeconds':time.monotonic()-start,
      'peakWorkingSetBytes':max(r.get('peakWorkingSetBytes',0) for r in rows),'peakPrivateCommitBytes':max(r.get('privateCommitBytes',0) for r in rows),
      'minimumAvailablePhysicalBytes':min(r['availablePhysicalBytes'] for r in rows),'minimumAvailableCommitBytes':min(r['availableCommitBytes'] for r in rows),
      'averageSystemCpuPercent':average_cpu([baseline[-1]]+rows),'peakSampledSystemCpuPercent':max(r['systemCpuPercent'] for r in rows),'samples':len(rows)}
    (folder/'monitor-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8');all_summary.append(summary)
    print('Complete:',clip['id'],f"peak RSS {summary['peakWorkingSetBytes']/2**20:.0f} MiB",flush=True)
print('Evaluation runs complete.',flush=True)
