import React, { useState } from 'react';
import { Gauge, Timer, Hand, Wand2, Loader2 } from 'lucide-react';

export type CountInMode = 'off' | '1bar' | '2bars' | 'custom';

interface PracticePanelProps {
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
}

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1];

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
  onCountInCustomBeatsChange
}) => {
  const isPreset = SPEED_PRESETS.includes(speed);
  const [customSpeed, setCustomSpeed] = useState(isPreset ? false : true);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);

  const group = 'flex items-center gap-1.5 bg-slate-950/70 px-2 py-1 rounded-lg border border-slate-800';
  const label = 'text-[10px] uppercase font-bold text-slate-400';
  const select = 'bg-slate-900 text-slate-200 px-1.5 py-0.5 rounded outline-none cursor-pointer';
  const numberInput = 'bg-slate-900 text-cyan-300 font-mono px-1.5 py-0.5 rounded outline-none border border-slate-800 focus:border-cyan-700';

  return (
    <div className="mx-4 mb-2 px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-wrap items-center gap-3 text-xs">
      {/* Playback speed */}
      <div className={group} title="Playback speed (pitch is preserved)">
        <Gauge className="w-3.5 h-3.5 text-cyan-400" />
        <span className={label}>Speed</span>
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
          className={select}
        >
          {SPEED_PRESETS.map(r => <option key={r} value={r}>×{r}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {customSpeed && (
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
            className={`${numberInput} w-16`}
            title="0.25 – 2.0, press Enter to apply"
          />
        )}
        {speedProgress !== null && (
          <span className="flex items-center gap-1 text-[10px] text-cyan-300 font-mono">
            <Loader2 className="w-3 h-3 animate-spin" />
            {Math.round(speedProgress * 100)}%
          </span>
        )}
      </div>

      {/* Metronome */}
      <div className={group}>
        <button
          onClick={onToggleMetronome}
          className={`flex items-center gap-1 px-2 py-0.5 rounded font-semibold transition ${
            metronomeOn ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
          title="Metronome clicks during playback (M)"
        >
          <Timer className="w-3.5 h-3.5" />
          Metronome
        </button>
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
          className={`${numberInput} w-14`}
          title="Tempo (BPM)"
        />
        <span className="text-slate-500 text-[10px]">BPM</span>
        <select
          value={beatsPerBar}
          onChange={(e) => onBeatsPerBarChange(Number(e.target.value))}
          className={select}
          title="Beats per bar"
        >
          {[2, 3, 4, 5, 6, 7, 9, 12].map(n => <option key={n} value={n}>{n}/4</option>)}
        </select>
        <button
          onClick={onTap}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 active:bg-cyan-700 active:text-white transition"
          title="Tap tempo: tap 4+ times in rhythm (T)"
        >
          <Hand className="w-3.5 h-3.5" />
          Tap
        </button>
        <button
          onClick={onDetectTempo}
          disabled={!canDetectTempo}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          title="Detect tempo and beat position from the reference (⭐) track"
        >
          <Wand2 className="w-3.5 h-3.5" />
          Detect
        </button>
        <div className="flex items-center" title="Move the bar start by one beat (if the first beat of the bar is in the wrong place)">
          <button
            onClick={() => onShiftDownbeat(-1)}
            className="px-1.5 py-0.5 rounded-l bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
          >
            ‹
          </button>
          <span className="px-1.5 py-0.5 bg-slate-800/60 text-[10px] text-slate-400">Bar</span>
          <button
            onClick={() => onShiftDownbeat(1)}
            className="px-1.5 py-0.5 rounded-r bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
          >
            ›
          </button>
        </div>
        {tempoStatus && <span className="text-[10px] text-slate-400 font-mono">{tempoStatus}</span>}
      </div>

      {/* Count-in */}
      <div className={group} title="Metronome count-in before playback starts">
        <span className={label}>Count-in</span>
        <select
          value={countInMode}
          onChange={(e) => onCountInModeChange(e.target.value as CountInMode)}
          className={select}
        >
          <option value="off">Off</option>
          <option value="1bar">1 bar</option>
          <option value="2bars">2 bars</option>
          <option value="custom">Custom</option>
        </select>
        {countInMode === 'custom' && (
          <>
            <input
              type="number"
              min={1}
              max={32}
              value={countInCustomBeats}
              onChange={(e) => onCountInCustomBeatsChange(clamp(Math.round(Number(e.target.value) || 1), 1, 32))}
              className={`${numberInput} w-12`}
            />
            <span className="text-slate-500 text-[10px]">beats</span>
          </>
        )}
      </div>
    </div>
  );
};
