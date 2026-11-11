import React, { useEffect, useState } from 'react';
import { MoveHorizontal } from 'lucide-react';
import { AudioTrackState } from '../audio/MultiTrackMixer';
import { barStartSeconds, MAX_TRACK_OFFSET, normalizeTrackOffset, trackOffset } from '../audio/TrackTiming';

export interface TrackAlignmentPanelProps {
  tracks: AudioTrackState[];
  trackIndex: number | null;
  onSelectTrack: (index: number) => void;
  onChangeOffset: (index: number, seconds: number, commit: boolean) => void;
  onDone: () => void;
  onShowStart: () => void;
  bpm: number;
  beatsPerBar: number;
  snapToBeat: boolean;
  onToggleSnap: () => void;
}

export function TrackAlignmentPanel({ tracks, trackIndex, onSelectTrack, onChangeOffset, onDone, onShowStart,
  bpm, beatsPerBar, snapToBeat, onToggleSnap }: TrackAlignmentPanelProps) {
  const track = tracks.find(t => t.index === trackIndex && t.audioBuffer);
  const offset = track ? trackOffset(track) : 0;
  const [seconds, setSeconds] = useState(String(offset));
  const [bar, setBar] = useState('');
  useEffect(() => { setSeconds(String(offset)); }, [offset, trackIndex]);
  useEffect(() => { setBar(''); }, [trackIndex]);
  if (!track) return null;
  const commit = () => {
    const next = seconds.trim() === '' ? offset : normalizeTrackOffset(Number(seconds));
    setSeconds(String(next)); onChangeOffset(track.index, next, true);
  };
  const placeBar = () => {
    const number = Number(bar);
    if (Number.isInteger(number) && number >= 1) onChangeOffset(track.index, barStartSeconds(number, bpm, beatsPerBar), true);
  };
  return (
    <section aria-label="Align voice part" className="mx-3 my-1 px-3 py-2 rounded-lg border border-cyan-700/60 bg-cyan-950/30 text-xs text-slate-300 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <MoveHorizontal className="w-4 h-4 text-cyan-300" />
        <select aria-label="Part to move" value={track.index} onChange={e => onSelectTrack(Number(e.target.value))} className="max-w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-cyan-200">
          {tracks.filter(t => t.audioBuffer).map(t => <option key={t.id} value={t.index}>{t.name}</option>)}
        </select>
        <span className="flex-1 min-w-32">Drag left or right on the diagram to move this part.</span>
        <button onClick={onDone} className="rounded bg-cyan-500 px-3 py-1 font-bold text-slate-950">Done</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <label className="flex items-center gap-1">Start
          <input type="number" aria-label="Part start in seconds" min={-MAX_TRACK_OFFSET} max={MAX_TRACK_OFFSET} step="0.01" value={seconds}
            onChange={e => setSeconds(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono" />s
        </label>
        <button onClick={() => onChangeOffset(track.index, offset - 0.1, true)} aria-label="Move part earlier by 0.1 seconds" className="rounded bg-slate-800 px-2 py-1">−0.1</button>
        <button onClick={() => onChangeOffset(track.index, offset + 0.1, true)} aria-label="Move part later by 0.1 seconds" className="rounded bg-slate-800 px-2 py-1">+0.1</button>
        <label className="flex items-center gap-1">Bar
          <input type="number" aria-label="Entry bar" min="1" step="1" value={bar} placeholder="e.g. 16" onChange={e => setBar(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') placeBar(); }} className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1" />
        </label>
        <button onClick={placeBar} disabled={!Number.isInteger(Number(bar)) || Number(bar) < 1} className="rounded bg-slate-800 px-2 py-1 disabled:opacity-40">Place</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={snapToBeat} onChange={onToggleSnap} className="accent-cyan-400" />Snap drag to beat</label>
        <button onClick={onShowStart} className="rounded bg-slate-800 px-2 py-1">Show start</button>
        <button onClick={() => onChangeOffset(track.index, 0, true)} disabled={offset === 0} className="rounded bg-slate-800 px-2 py-1 disabled:opacity-40">Reset</button>
      </div>
      <p className="text-[10px] text-slate-500 mt-1">Bar placement uses {bpm} BPM and {beatsPerBar} beats per bar from song time 0. Negative seconds skip the recording’s beginning.</p>
    </section>
  );
}
