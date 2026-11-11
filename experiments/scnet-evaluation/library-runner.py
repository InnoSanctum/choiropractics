"""Sequential, resumable Library processing. Runs independently of the chat/terminal."""
import csv, ctypes as C, html, json, msvcrt, os, subprocess, sys, time, traceback
from pathlib import Path
from ctypes import wintypes as W

ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
WORK=ROOT/'library-work';PLAN=json.loads((WORK/'plan.json').read_text('utf-8'))
K=C.WinDLL('kernel32',use_last_error=True);P=C.WinDLL('psapi',use_last_error=True)
class MEMORY(C.Structure):
    _fields_=[('length',W.DWORD),('load',W.DWORD)]+[(n,C.c_ulonglong) for n in ['total','available','totalCommit','availableCommit','totalVirtual','availableVirtual','extended']]
class PMC(C.Structure):
    _fields_=[('cb',W.DWORD),('faults',W.DWORD)]+[(n,C.c_size_t) for n in ['peak','rss','qpp','qp','qpnp','qnp','page','peakPage','private']]
K.GetSystemTimes.argtypes=[C.POINTER(W.FILETIME)]*3
K.GetProcessTimes.argtypes=[W.HANDLE]+[C.POINTER(W.FILETIME)]*4
K.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];K.OpenProcess.restype=W.HANDLE
K.GetExitCodeProcess.argtypes=[W.HANDLE,C.POINTER(W.DWORD)];K.CloseHandle.argtypes=[W.HANDLE]
P.GetProcessMemoryInfo.argtypes=[W.HANDLE,C.POINTER(PMC),W.DWORD]
K.SetThreadExecutionState.argtypes=[W.DWORD];K.SetThreadExecutionState.restype=W.DWORD
def awake(active):K.SetThreadExecutionState(0x80000000 | (1 if active else 0))
def ft(v):return (v.dwHighDateTime<<32)|v.dwLowDateTime
def atomic(path,value):
    temp=Path(str(path)+'.partial');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');os.replace(temp,path)
def live(pid):
    handle=K.OpenProcess(0x1000,False,pid)
    if not handle:return False
    try:
        code=W.DWORD();return bool(K.GetExitCodeProcess(handle,C.byref(code))) and code.value==259
    finally:K.CloseHandle(handle)
lock=WORK/'runner.lock.json'
guard=(WORK/'runner.guard').open('a+b')
if guard.seek(0,2)==0:guard.write(b'0');guard.flush()
guard.seek(0)
try:msvcrt.locking(guard.fileno(),msvcrt.LK_NBLCK,1)
except OSError:raise SystemExit('A Library runner is already active.')
atomic(lock,{'pid':os.getpid(),'startedAt':time.time()})
LOAD_FIELDS=['at','availableRamBytes','availableCommitBytes','systemTicks','idleTicks','rssBytes','peakRssBytes','privateCommitBytes','cpuSeconds','systemCpuPercent','processCpuPercent']
def sample(process=None):
    m=MEMORY();m.length=C.sizeof(m);K.GlobalMemoryStatusEx(C.byref(m))
    idle,k,u=W.FILETIME(),W.FILETIME(),W.FILETIME();K.GetSystemTimes(C.byref(idle),C.byref(k),C.byref(u))
    row={'at':time.time(),'availableRamBytes':m.available,'availableCommitBytes':m.availableCommit,'systemTicks':ft(k)+ft(u),'idleTicks':ft(idle)}
    if process and process.poll() is None:
        p=PMC();p.cb=C.sizeof(p)
        if P.GetProcessMemoryInfo(W.HANDLE(int(process._handle)),C.byref(p),p.cb):row.update(rssBytes=p.rss,peakRssBytes=p.peak,privateCommitBytes=p.private)
        a,b,c,d=W.FILETIME(),W.FILETIME(),W.FILETIME(),W.FILETIME()
        if K.GetProcessTimes(W.HANDLE(int(process._handle)),C.byref(a),C.byref(b),C.byref(c),C.byref(d)):row['cpuSeconds']=(ft(c)+ft(d))/1e7
    return row
def read_progress(job):
    try:return json.loads((Path(job['jobDir'])/'progress.json').read_text('utf-8'))
    except (OSError,ValueError):return {}
def completed(job):
    try:return json.loads((Path(job['jobDir'])/'complete.json').read_text('utf-8'))['signature']==job['signature']
    except (OSError,ValueError,KeyError):return False
def status(state,job=None,extra=None):
    done=sum(completed(j) for j in PLAN['jobs']);p=read_progress(job) if job else {}
    data={'state':state,'runnerPid':os.getpid(),'updatedAt':time.time(),'completedRecordings':done,'totalRecordings':len(PLAN['jobs']),
      'current':{'id':job['id'],'title':job['title'],'label':job['label'],'progress':p} if job else None,'outputFolder':PLAN['outputRoot'],**(extra or {})}
    atomic(WORK/'status.json',data)
    title=html.escape(job['title']+' · '+job['label']) if job else ''
    windows=f"{p.get('completed',0)} / {p.get('total','?')} windows" if job else ''
    body=f'''<!doctype html><html><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>Choir Library preparation</title><style>:root{{color-scheme:dark}}body{{background:#101a29;color:#e7edf7;font:18px/1.6 system-ui;max-width:900px;margin:50px auto;padding:25px}}h1{{font-size:34px}}a{{color:#86ddc7}}progress{{width:100%}}code{{font-size:14px;overflow-wrap:anywhere}}</style><h1>Choir Library preparation</h1><p><b>{html.escape(state)}</b> · {done} / {len(PLAN['jobs'])} recordings complete</p><progress value="{done}" max="{len(PLAN['jobs'])}"></progress><h2>{title}</h2><p>{html.escape(p.get('phase',''))} · {windows}</p><p>The page refreshes every 30 seconds. Processing runs locally in the background. Keep the PC awake.</p><p><a href="../../../artifacts/choir-library-upload/index.html">Listen to completed files</a></p><p>Output folder: <code>{html.escape(PLAN['outputRoot'])}</code></p><p>Use PauseLibrary.cmd to pause safely and ResumeLibrary.cmd to continue. Completed windows and files are reused. READY.txt appears only when every output and catalogue has been validated.</p><pre>{html.escape((extra or {}).get('message',''))}</pre></html>'''
    temp=WORK/'status.html.partial';temp.write_text(body,encoding='utf-8');os.replace(temp,WORK/'status.html')
def node(script,*args):
    run=subprocess.run(['node',script,*args],creationflags=subprocess.CREATE_NO_WINDOW)
    if run.returncode:raise RuntimeError(script+' failed: '+str(run.returncode))
try:
    awake(True)
    status('running')
    for job in PLAN['jobs']:
        if completed(job):continue
        attempts=0
        while not completed(job):
            while (WORK/'PAUSE').exists():awake(False);status('paused',job);time.sleep(5)
            awake(True)
            status('running',job);log=(Path(job['jobDir'])/'batch.log').open('a',encoding='utf-8')
            worker=subprocess.Popen(['node','--max-old-space-size=3072','library-worker.mjs',job['id']],stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
            print('Processing',job['id'],'PID',worker.pid,flush=True)
            before=sample();last=before;last_status=0;low_since=None;interrupted=False
            load_file=(Path(job['jobDir'])/'load.csv').open('a',newline='',encoding='utf-8')
            writer=csv.DictWriter(load_file,fieldnames=LOAD_FIELDS)
            if load_file.tell()==0:writer.writeheader()
            try:
                while worker.poll() is None:
                    time.sleep(1);r=sample(worker);delta=r['at']-last['at'];total=r['systemTicks']-last['systemTicks']
                    r['systemCpuPercent']=100*(1-(r['idleTicks']-last['idleTicks'])/total) if total>0 else 0
                    if 'cpuSeconds' in r and 'cpuSeconds' in last:r['processCpuPercent']=100*(r['cpuSeconds']-last['cpuSeconds'])/max(.001,delta)/max(1,os.cpu_count() or 1)
                    writer.writerow(r);last=r
                    if time.time()-last_status>10:load_file.flush();status('running',job,{'resources':r});last_status=time.time()
                    if (WORK/'PAUSE').exists():worker.terminate();worker.wait();interrupted=True;break
                    if r['availableRamBytes']<96*2**20:low_since=low_since or time.time()
                    else:low_since=None
                    if low_since and time.time()-low_since>20:
                        worker.terminate();worker.wait();interrupted=True;status('waiting for memory',job);time.sleep(30);break
            finally:
                if worker.poll() is None:worker.terminate();worker.wait()
                log.close();load_file.close()
            if interrupted:continue
            if worker.returncode or not completed(job):
                attempts+=1
                if attempts>=3:raise RuntimeError('Recording failed three times; inspect '+str(Path(job['jobDir'])/'batch.log'))
                status('retrying',job);time.sleep(10);continue
            node('library-reencode.mjs');node('library-build.mjs');status('running')
    status('validating final bundle');node('library-reencode.mjs');node('library-build.mjs');status('complete')
    print('Library upload bundle complete:',PLAN['outputRoot'],flush=True)
except BaseException as error:
    status('failed',extra={'message':str(error)});traceback.print_exc();raise
finally:
    awake(False)
    try:lock.unlink()
    except OSError:pass
    guard.close()
