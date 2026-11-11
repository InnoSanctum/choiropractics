import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Loader2, Search, X } from 'lucide-react';
import { LibraryCatalogue, LibrarySong, fetchCatalogue, parseCatalogue, searchSongs, canTrainOnLibraryPart, defaultLibraryParts } from '../library/catalogue';
import { LibraryLoadProgress } from '../library/loadSong';
import { MAX_TRACKS } from '../score/types';
import { db } from '../storage/db';

export interface LibrarySelection { partIds: string[]; targetPartId: string }
export interface LibraryDialogProps {
  currentSongTitle?: string;
  hasTracks: boolean;
  onClose: () => void;
  onLoad: (song: LibrarySong, selection: LibrarySelection, signal: AbortSignal, progress: (value: LibraryLoadProgress) => void) => Promise<void>;
}
const formatDuration = (seconds?: number) => seconds === undefined ? '—' : `${Math.floor(seconds / 60)}:${Math.round(seconds % 60).toString().padStart(2, '0')}`;
const CACHE_KEY = 'choiro.libraryCatalogue.v1';

export function LibraryDialog({ currentSongTitle, hasTracks, onClose, onLoad }: LibraryDialogProps) {
  const [catalogue, setCatalogue] = useState<LibraryCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [songId, setSongId] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [targetPartId, setTargetPartId] = useState('');
  const [progress, setProgress] = useState<LibraryLoadProgress | null>(null);
  const [loadError, setLoadError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const loadController = useRef<AbortController | null>(null);
  const busy = progress !== null;
  const song = catalogue?.songs.find(s => s.id === songId);
  const songRevision = song?.parts.map(p => `${p.id}|${p.url}|${p.variant}|${p.isAccompaniment}`).join('\n');
  const filtered = useMemo(() => searchSongs(catalogue?.songs ?? [], query), [catalogue, query]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    return () => { loadController.current?.abort(); dialogRef.current?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setNotice(''); setCatalogue(null);
    (async () => {
      try {
        const fresh = await fetchCatalogue(controller.signal);
        if (controller.signal.aborted) return;
        setCatalogue(fresh);
        try { await db.preferences.put({ key: CACHE_KEY, value: JSON.stringify(fresh) }); } catch { /* Catalogue remains usable. */ }
      } catch (e) {
        if (controller.signal.aborted) return;
        let cached: LibraryCatalogue | null = null;
        try {
          const record = await db.preferences.get(CACHE_KEY);
          if (record) {
            const parsed = JSON.parse(record.value);
            cached = { songs: parseCatalogue(parsed), fetchedAt: Number(parsed.fetchedAt) || 0 };
          }
        } catch { /* A failed cache must not hide the network error. */ }
        if (controller.signal.aborted) return;
        if (cached) setCatalogue(cached);
        if (cached) setNotice('Showing the saved catalogue. Saved recordings can load offline; other parts need an internet connection.');
        else setError((e as Error).message || 'Could not open the Library.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [request]);
  useEffect(() => {
    if (!song) return;
    const defaults = defaultLibraryParts(song);
    const individual = defaults.filter(canTrainOnLibraryPart);
    setChecked(defaults.map(p => p.id));
    setTargetPartId(individual[0]?.id ?? '');
    setLoadError('');
  }, [song?.id, songRevision]);

  const close = () => { if (busy) loadController.current?.abort(); else onClose(); };
  const load = async () => {
    if (!song || busy || !checked.length || checked.length > MAX_TRACKS) return;
    const controller = new AbortController(); loadController.current = controller;
    setLoadError(''); setProgress({ fraction: 0, message: 'Preparing recordings…' });
    try {
      await onLoad(song, { partIds: checked, targetPartId }, controller.signal, setProgress);
      onClose();
    } catch (e) {
      setLoadError(controller.signal.aborted ? 'Loading cancelled. Your current rehearsal has been kept.' : (e as Error).message || 'Could not load this song.');
    } finally { loadController.current = null; setProgress(null); }
  };
  return (
    <dialog ref={dialogRef} onCancel={e => { e.preventDefault(); close(); }} aria-labelledby="library-title"
      onKeyDown={e => e.stopPropagation()}
      className="fixed inset-0 m-auto w-[calc(100%_-_1.5rem)] max-w-3xl max-h-[90dvh] p-0 rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl backdrop:bg-slate-950/80 select-text">
      <div className="flex flex-col max-h-[90dvh]">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 shrink-0">
          <BookOpen className="w-5 h-5 text-cyan-300" />
          <h2 id="library-title" className="text-lg font-bold flex-1">Library</h2>
          {!busy && <button onClick={() => setRequest(r => r + 1)} disabled={loading} className="text-xs text-slate-400 hover:text-cyan-300 disabled:opacity-40">Refresh</button>}
          <button onClick={close} aria-label={busy ? 'Cancel song loading' : 'Close Library'} className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </header>
        <div className="p-4 overflow-y-auto overscroll-contain">
          {notice && <p role="status" className="text-sm text-amber-200 mb-3">{notice}</p>}
          {error && <div role="alert" className="rounded-lg border border-rose-900 p-3 text-sm text-rose-200">{error}<button onClick={() => setRequest(r => r + 1)} className="ml-3 underline">Retry</button></div>}
          {loading && !catalogue && <p role="status" className="flex items-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Opening repertoire…</p>}
          {!song && catalogue && <>
            <label className="flex gap-2 items-center rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 mb-3">
              <Search className="w-4 h-4 text-slate-500" />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search songs, composers, or voices" aria-label="Search Library" className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
            </label>
            <p className="text-xs text-slate-500 mb-3">{filtered.length} {filtered.length === 1 ? 'song' : 'songs'}{loading ? ' · Refreshing…' : ''}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {filtered.map(s => <button key={s.id} onClick={() => setSongId(s.id)} disabled={!s.parts.length}
                className="p-3 rounded-xl border border-slate-700 bg-slate-950/50 hover:border-cyan-500/60 text-left transition disabled:opacity-45 disabled:hover:border-slate-700">
                <span className="block text-sm font-bold text-slate-100">{s.title}</span>
                <span className="block text-xs text-slate-400 mt-1">{s.subtitle}</span>
                <span className="block text-xs text-cyan-300 mt-2">{s.parts.length ? `${defaultLibraryParts(s).filter(canTrainOnLibraryPart).length || s.parts.filter(p => !p.isAccompaniment).length} voice parts${s.parts.some(p => p.isAccompaniment) ? ' · accompaniment' : ''}${s.parts.some(p => p.isMix) ? ' · mix available' : ''}` : 'No recordings yet'}</span>
              </button>)}
            </div>
            {!filtered.length && <p className="text-sm text-slate-400 py-6 text-center">No songs match your search.</p>}
          </>}
          {song && <>
            <button onClick={() => { setSongId(null); setLoadError(''); }} disabled={busy} className="flex items-center gap-1.5 text-xs text-cyan-300 mb-3 disabled:opacity-40"><ArrowLeft className="w-3.5 h-3.5" />All songs</button>
            <h3 className="font-bold text-xl">{song.title}</h3>
            <p className="text-sm text-slate-400 mt-1 mb-4">{song.subtitle}</p>
            <fieldset disabled={busy} className="space-y-2">
              <legend className="text-xs font-semibold text-slate-400 mb-2">Recordings to load</legend>
              {song.parts.map(p => <label key={p.id} className="flex items-center gap-3 rounded-lg bg-slate-950/60 border border-slate-800 p-3 text-sm">
                <input type="checkbox" checked={checked.includes(p.id)} onChange={e => {
                  const ids = e.target.checked ? [...checked, p.id] : checked.filter(id => id !== p.id);
                  setChecked(ids);
                  if (!ids.includes(targetPartId)) setTargetPartId(song.parts.find(part => ids.includes(part.id) && canTrainOnLibraryPart(part))?.id ?? '');
                }} className="accent-cyan-400 w-4 h-4" />
                <span className="flex-1 min-w-0">{p.label}{p.isMix && <span className="text-slate-500 text-xs ml-2">Optional mix · starts muted with voice parts</span>}{p.isAccompaniment && <span className="text-slate-500 text-xs ml-2">Audio only · plays with your voices</span>}</span>
                <span className="font-mono text-xs text-slate-500">{formatDuration(p.duration)}</span>
              </label>)}
              {song.parts.some(p => checked.includes(p.id) && canTrainOnLibraryPart(p)) && <label className="flex items-center gap-2 pt-2 text-sm">Your part
                <select aria-label="Your Library part" value={targetPartId} onChange={e => setTargetPartId(e.target.value)} className="max-w-48 bg-slate-950 border border-slate-700 rounded px-2 py-1">
                  {song.parts.filter(p => checked.includes(p.id) && canTrainOnLibraryPart(p)).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>}
            </fieldset>
            {song.parts.filter(p => checked.includes(p.id) && p.duration).length > 1 && Math.max(...song.parts.filter(p => checked.includes(p.id)).map(p => p.duration ?? 0)) - Math.min(...song.parts.filter(p => checked.includes(p.id)).map(p => p.duration ?? Infinity)) > 5
              && <p className="text-xs text-amber-200 mt-3">These recordings have different lengths. Use each track’s alignment button to adjust its entrance after loading. Saved adjustments on this device will be applied.</p>}
            {hasTracks && <p className="text-xs text-slate-400 mt-3">Loading replaces {currentSongTitle ? `“${currentSongTitle}”` : 'the current tracks'} once all recordings are ready.</p>}
            {checked.length > MAX_TRACKS && <p className="text-sm text-amber-200 mt-2">Select at most {MAX_TRACKS} recordings.</p>}
          </>}
          {loadError && <p role="alert" className="text-sm text-rose-300 mt-3">{loadError}</p>}
        </div>
        {song && <footer className="px-4 py-3 border-t border-slate-800 shrink-0">
          {progress && <div role="status" className="mb-3"><p className="text-xs text-slate-300 mb-1">{progress.message} · {Math.round(progress.fraction * 100)}%</p><progress className="w-full" max={1} value={progress.fraction} /></div>}
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg bg-slate-800 px-3 py-2 text-sm">{busy ? 'Cancel loading' : 'Close'}</button>
            <button onClick={load} disabled={busy || !checked.length || checked.length > MAX_TRACKS} className="rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-4 py-2 text-sm disabled:opacity-40">Load song</button>
          </div>
        </footer>}
      </div>
    </dialog>
  );
}
