import React, { useEffect, useMemo, useRef, useState } from 'react';
import { readMuseScore } from '../score/MuseScoreImport';
import { buildScoreTracks } from '../score/ScoreProcessing';
import { MAX_TRACKS, ParsedScore, PartStrategy, ScoreTrack } from '../score/types';

export interface ScoreImportSettings { replace: boolean; bpm: number; beatsPerBar: number }
export interface ScoreImportDialogProps {
  file: File;
  loadedCount: number;
  onClose: () => void;
  onImport: (tracks: ScoreTrack[], settings: ScoreImportSettings, signal: AbortSignal, onProgress: (value: number) => void) => Promise<void>;
}
export function ScoreImportDialog({ file, loadedCount, onClose, onImport }: ScoreImportDialogProps) {
  const [score, setScore] = useState<ParsedScore | null>(null);
  const [error, setError] = useState('');
  const [strategies, setStrategies] = useState<Record<string, PartStrategy>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bpm, setBpm] = useState(120);
  const [replace, setReplace] = useState(loadedCount === 0);
  const [progress, setProgress] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    readMuseScore(file).then(parsed => {
      if (cancelled) return;
      setScore(parsed);
      setSelected(Object.fromEntries(parsed.parts.map(p => [p.id, true])));
      setStrategies(Object.fromEntries(parsed.parts.map(p => [p.id, p.strategy])));
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; controller.current?.abort(); };
  }, [file]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const preview = useMemo(() => {
    if (!score) return { tracks: [] as ScoreTrack[], error: '' };
    try { return { tracks: buildScoreTracks({ ...score, parts: score.parts.filter(p => selected[p.id]) }, strategies, bpm), error: '' }; }
    catch (e) { return { tracks: [] as ScoreTrack[], error: (e as Error).message }; }
  }, [score, strategies, selected, bpm]);
  const total = preview.tracks.length + (replace ? 0 : loadedCount);
  const busy = progress !== null;
  const cancel = () => { if (busy) controller.current?.abort(); else onClose(); };
  const submit = async () => {
    if (!score || busy || preview.error || total > MAX_TRACKS) return;
    setError(''); setProgress(0);
    const abort = new AbortController(); controller.current = abort;
    try {
      await onImport(preview.tracks, { replace, bpm: score.tempos.find(t => t.beat === 0 && t.bpm > 0)?.bpm ?? bpm, beatsPerBar: score.beatsPerBar }, abort.signal, setProgress);
      onClose();
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message || 'Could not import this score.');
      else setError('Import cancelled. Your existing tracks are unchanged.');
    } finally { setProgress(null); controller.current = null; }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-3">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="score-import-title"
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
          if (e.key === 'Tab') {
            const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
            if (!focusable?.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
          e.stopPropagation();
        }}
        className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-200 shadow-2xl select-text">
        <h2 id="score-import-title" className="font-bold text-lg">Import MuseScore</h2>
        <p className="text-sm text-slate-400 mt-1 break-words">{score?.title ?? file.name}</p>
        {!score && !error && <p role="status" className="my-4">Reading score…</p>}
        {score && <>
          <p className="text-xs text-slate-400 my-3">Choose parts and how to handle divisi. All tracks use an “aaah” sound. Chords kept together can accompany training; select a single melody as the singing target.</p>
          <fieldset disabled={busy} className="space-y-2">
            {score.parts.map(p => <div key={p.id} className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex-1 flex items-center gap-2 min-w-32 text-sm font-semibold">
                  <input type="checkbox" checked={!!selected[p.id]} onChange={e => setSelected(s => ({ ...s, [p.id]: e.target.checked }))} />
                  {p.name}
                </label>
                <select aria-label={`Import handling for ${p.name}`} value={strategies[p.id] ?? p.strategy}
                  onChange={e => setStrategies(s => ({ ...s, [p.id]: e.target.value as PartStrategy }))}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm max-w-full">
                  <option value="keep">Keep as one track</option>
                  <option value="split">Split by pitch ({p.maxPolyphony} {p.maxPolyphony === 1 ? 'track' : 'tracks'})</option>
                </select>
              </div>
              <p className="text-xs text-slate-400 mt-1">{p.reason}</p>
            </div>)}
            {(!score.tempos.length || score.tempos[0].bpm === 0) && <label className="flex items-center gap-2 text-sm py-2">
              Tempo before the first marking
              <input type="number" aria-label="Fallback tempo" min={20} max={400} value={bpm} onChange={e => setBpm(Number(e.target.value))} className="w-20 rounded bg-slate-950 border border-slate-700 px-2 py-1" /> BPM
            </label>}
            <label className="flex items-center gap-2 text-sm pt-2"><input type="radio" name="score-destination" checked={!replace} onChange={() => setReplace(false)} />Add to current tracks</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="score-destination" checked={replace} onChange={() => setReplace(true)} />Replace current tracks{loadedCount > 0 ? ` (${loadedCount} loaded)` : ''}</label>
          </fieldset>
          {score.warnings.map(w => <p key={w} className="text-xs text-amber-300 mt-2">{w}</p>)}
          <p className="text-sm mt-3" role="status">{preview.tracks.length} generated tracks · {total}/{MAX_TRACKS} total{preview.tracks[0] ? ` · ${Math.round(preview.tracks[0].duration)} seconds` : ''}</p>
          {preview.error && <p className="text-sm text-amber-300 mt-2">{preview.error}</p>}
          {total > MAX_TRACKS && <p className="text-sm text-amber-300 mt-2">Choose fewer parts, keep parts together, or replace the current session to stay within {MAX_TRACKS} tracks.</p>}
        </>}
        {error && <p role="alert" className="text-sm text-rose-300 my-3">{error}</p>}
        {busy && <div className="my-3" role="status"><p className="text-sm mb-1">Generating rehearsal audio… {Math.round(progress * 100)}%</p><progress className="w-full" max={1} value={progress} /></div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={cancel} className="px-3 py-2 rounded bg-slate-800 text-sm">{busy ? 'Cancel import' : 'Close'}</button>
          <button onClick={submit} disabled={busy || !score || !!preview.error || total > MAX_TRACKS} className="px-3 py-2 rounded bg-cyan-500 text-slate-950 text-sm font-bold disabled:opacity-40">Import tracks</button>
        </div>
      </div>
    </div>
  );
}
