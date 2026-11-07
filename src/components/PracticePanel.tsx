import React, { useState } from 'react';
import { Gauge, Timer, Hand, Wand2, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

export type CountInMode = 'off' | '1bar' | '2bars' | 'custom';

export interface PracticePanelProps {
  speed: number;
  onSpeedChange: (rate: number) => void;
  /** 0..1 while pitch-preserved audio for a new speed is being prepared, else null */
  speedProgress: number | null;

  metronomeOn: boolean;
  onToggleMetronome: () => void;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  beatsPerBar: number;
  onBeatsPerBarChange: (n: number) => void;
  onTap: () => void;
  /** Shift the bar lines by whole beats */
  onShiftDownbeat: (beats: number) => void;
  onDetectTempo: () => void;
  tempoStatus: string | null;
  canDetectTempo: boolean;

  countInMode: CountInMode;
  onCountInModeChange: (m: CountInMode) => void;
  countInCustomBeats: number;
  onCountInCustomBeatsChange: (n: number) => void;

  /** Render as a labelled form (inside a mobile sheet) instead of a single toolbar row */
  embedded?: boolean;
}

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1];
const METERS = [2, 3, 4, 5, 6, 7, 9, 12];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const PracticePanel: React.FC<PracticePanelProps> = ({
  speed,
  onSpeedChange,
  speedProgress,
  metronomeOn,
  onToggleMetronome,
  bpm,
  onBpmChange,
  beatsPerBar,
  onBeatsPerBarChange,
  onTap,
  onShiftDownbeat,
  onDetectTempo,
  tempoStatus,
  canDetectTempo,
  countInMode,
  onCountInModeChange,
  countInCustomBeats,
  onCountInCustomBeatsChange,
  embedded = false
}) => {
  const [customSpeed, setCustomSpeed] = useState(!SPEED_PRESETS.includes(speed));
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);

  // Same controls, two sizes: compact toolbar (desktop) or finger-sized form (phone sheet)
  const h = embedded ? 'h-10' : 'h-7';
  const select = `${h} bg-slate-900 text-slate-200 px-2 rounded-md border border-slate-800 outline-none cursor-pointer`;
  const numberInput = `${h} bg-slate-900 text-cyan-300 font-mono px-2 rounded-md outline-none border border-slate-800 focus:border-cyan-700`;
  const button = `${h} px-3 rounded-md flex items-center justify-center gap-1.5 bg-slate-800 text-slate-300 hover:bg-slate-700 transition disabled:opacity-40 disabled:cursor-not-allowed`;
  const icon = embedded ? 'w-4 h-4' : 'w-3.5 h-3.5';

  const speedSelect = (
    <select
      value={customSpeed ? 'custom' : String(speed)}
      onChange={(e) => {
        if (e.target.value === 'custom') {
          setCustomSpeed(true);
        } else {
          setCustomSpeed(false);
          onSpeedChange(Number(e.target.value));
        }
      }}
      className={`${select} ${embedded ? 'w-28' : ''}`}
      title="Playback speed (pitch is preserved)"
    >
      {SPEED_PRESETS.map(r => <option key={r} value={r}>×{r}</option>)}
      <option value="custom">Custom…</option>
    </select>
  );

  const customSpeedInput = customSpeed && (
    <input
      type="number"
      min={0.25}
      max={2}
      step={0.05}
      defaultValue={speed}
      onBlur={(e) => onSpeedChange(clamp(Number(e.target.value) || 1, 0.25, 2))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSpeedChange(clamp(Number((e.target as HTMLInputElement).value) || 1, 0.25, 2));
      }}
      className={`${numberInput} w-20`}
      title="0.25 – 2.0, press Enter to apply"
    />
  );

  const speedBusy = speedProgress !== null && (
    <span className="flex items-center gap-1 text-[11px] text-cyan-300 font-mono">
      <Loader2 className="w-3 h-3 animate-spin" />
      {Math.round(speedProgress * 100)}%
    </span>
  );

  const metronomeToggle = (
    <button
      onClick={onToggleMetronome}
      className={`${h} px-3 rounded-md flex items-center gap-1.5 font-semibold transition ${
        metronomeOn ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
      title="Metronome clicks during playback (M)"
    >
      <Timer className={icon} />
      {embedded ? (metronomeOn ? 'On' : 'Off') : 'Metronome'}
    </button>
  );

  const bpmInput = (
    <input
      type="number"
      min={30}
      max={260}
      value={bpmDraft ?? String(bpm)}
      onChange={(e) => setBpmDraft(e.target.value)}
      onBlur={() => {
        if (bpmDraft !== null) onBpmChange(clamp(Number(bpmDraft) || bpm, 30, 260));
        setBpmDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={`${numberInput} ${embedded ? 'w-20' : 'w-14'}`}
      title="Tempo (BPM)"
    />
  );

  const meterSelect = (
    <select
      value={beatsPerBar}
      onChange={(e) => onBeatsPerBarChange(Number(e.target.value))}
      className={select}
      title="Beats per bar"
    >
      {METERS.map(n => <option key={n} value={n}>{n}/4</option>)}
    </select>
  );

  const tapButton = (
    <button onClick={onTap} className={`${button} active:bg-cyan-700 active:text-white`} title="Tap tempo: tap 4+ times in rhythm (T)">
      <Hand className={icon} />
      Tap
    </button>
  );

  const detectButton = (
    <button
      onClick={onDetectTempo}
      disabled={!canDetectTempo}
      className={button}
      title="Detect tempo and bar position from the reference (⭐) track"
    >
      <Wand2 className={icon} />
      Detect
    </button>
  );

  const barShift = (
    <div className="flex items-center" title="Move the bar lines by one beat (if bar 1 starts on the wrong beat)">
      <button onClick={() => onShiftDownbeat(-1)} className={`${button} rounded-r-none px-2`} aria-label="Bar start one beat earlier">
        <ChevronLeft className={icon} />
      </button>
      <span className={`${h} px-2 flex items-center bg-slate-800/60 text-[11px] text-slate-400 border-x border-slate-900`}>Bar</span>
      <button onClick={() => onShiftDownbeat(1)} className={`${button} rounded-l-none px-2`} aria-label="Bar start one beat later">
        <ChevronRight className={icon} />
      </button>
    </div>
  );

  const countInSelect = (
    <select
      value={countInMode}
      onChange={(e) => onCountInModeChange(e.target.value as CountInMode)}
      className={`${select} ${embedded ? 'w-28' : ''}`}
      title="Metronome count-in before playback starts"
    >
      <option value="off">Off</option>
      <option value="1bar">1 bar</option>
      <option value="2bars">2 bars</option>
      <option value="custom">Custom</option>
    </select>
  );

  const countInCustom = countInMode === 'custom' && (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        max={32}
        value={countInCustomBeats}
        onChange={(e) => onCountInCustomBeatsChange(clamp(Math.round(Number(e.target.value) || 1), 1, 32))}
        className={`${numberInput} w-16`}
      />
      <span className="text-slate-500 text-xs">beats</span>
    </span>
  );

  const status = tempoStatus && <span className="text-[11px] text-slate-400 font-mono">{tempoStatus}</span>;

  // ---- Phone sheet: labelled form ----
  if (embedded) {
    const label = 'text-[11px] uppercase font-bold text-slate-400';
    const row = 'flex flex-wrap items-center gap-2';
    return (
      <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
        <span className={label}>Speed</span>
        <div className={row}>{speedSelect}{customSpeedInput}{speedBusy}</div>

        <span className={label}>Metronome</span>
        <div className={row}>{metronomeToggle}</div>

        <span className={label}>Tempo</span>
        <div className={row}>{bpmInput}<span className="text-slate-500 text-xs">BPM</span>{meterSelect}</div>

        <span className={label}>Find tempo</span>
        <div className={row}>{tapButton}{detectButton}</div>

        <span className={label}>Bar start</span>
        <div className={row}>{barShift}</div>

        <span className={label}>Count-in</span>
        <div className={row}>{countInSelect}{countInCustom}</div>

        {tempoStatus && <div className="col-span-2 text-xs text-slate-500 font-mono">{tempoStatus}</div>}
      </div>
    );
  }

  // ---- Desktop: one toolbar row ----
  const group = 'flex items-center gap-1.5 bg-slate-950/70 px-2 py-1 rounded-lg border border-slate-800';
  const groupLabel = 'text-[10px] uppercase font-bold text-slate-400';
  return (
    <div className="mx-4 mb-2 px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-wrap items-center gap-2 text-xs">
      <div className={group}>
        <Gauge className="w-3.5 h-3.5 text-cyan-400" />
        <span className={groupLabel}>Speed</span>
        {speedSelect}{customSpeedInput}{speedBusy}
      </div>
      <div className={group}>
        {metronomeToggle}{bpmInput}<span className="text-slate-500 text-[10px]">BPM</span>{meterSelect}
      </div>
      <div className={group}>
        {tapButton}{detectButton}{barShift}{status}
      </div>
      <div className={group}>
        <span className={groupLabel}>Count-in</span>
        {countInSelect}{countInCustom}
      </div>
    </div>
  );
};
