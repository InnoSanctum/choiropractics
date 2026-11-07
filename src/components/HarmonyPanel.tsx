import React from 'react';
import { Sparkles, Music, Sliders, ChevronDown } from 'lucide-react';
import { 
  MusicalMode, 
  HarmonyPreset, 
  STANDARD_HARMONY_PRESETS,
  DetectedKeyResult 
} from '../audio/MusicalHarmonyEngine';

interface HarmonyPanelProps {
  activePreset: HarmonyPreset;
  onSelectPreset: (preset: HarmonyPreset) => void;

  rootIndex: number;
  onSelectRoot: (index: number) => void;

  activeMode: MusicalMode;
  onSelectMode: (mode: MusicalMode) => void;

  customSemitones: number;
  onChangeCustomSemitones: (st: number) => void;

  detectedKey: DetectedKeyResult | null;
  onApplyDetectedKey: () => void;
}

const ROOT_NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const MODE_OPTIONS: { id: MusicalMode; name: string }[] = [
  { id: 'major', name: 'Major (Ionian)' },
  { id: 'minor', name: 'Natural Minor (Aeolian)' },
  { id: 'dorian', name: 'Dorian' },
  { id: 'mixolydian', name: 'Mixolydian' },
  { id: 'phrygian', name: 'Phrygian' },
  { id: 'harmonic_minor', name: 'Harmonic Minor' }
];

export const HarmonyPanel: React.FC<HarmonyPanelProps> = ({
  activePreset,
  onSelectPreset,
  rootIndex,
  onSelectRoot,
  activeMode,
  onSelectMode,
  customSemitones,
  onChangeCustomSemitones,
  detectedKey,
  onApplyDetectedKey
}) => {
  return (
    <div className="mx-4 my-2 p-3 bg-slate-900/60 border border-slate-800 rounded-xl backdrop-blur flex flex-wrap items-center justify-between gap-3 text-xs">
      {/* Left: Mode / Key Selection & Presets */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-indigo-400 font-bold uppercase tracking-wider text-[11px]">
          <Music className="w-3.5 h-3.5" />
          <span>Harmony & Intervals:</span>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-lg border border-slate-800">
          <select
            value={activePreset.id}
            onChange={(e) => {
              const p = STANDARD_HARMONY_PRESETS.find(x => x.id === e.target.value);
              if (p) onSelectPreset(p);
            }}
            className="bg-transparent text-slate-200 font-medium outline-none cursor-pointer pr-1"
          >
            {STANDARD_HARMONY_PRESETS.map((p) => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Diatonic Scale / Mode Controls (Enabled if Diatonic preset selected) */}
        <div className="flex items-center gap-2 bg-slate-950/70 p-1 rounded-lg border border-slate-800">
          <span className="text-[10px] uppercase font-bold text-slate-400 px-1">Scale:</span>

          {/* Root Key */}
          <select
            value={rootIndex}
            onChange={(e) => onSelectRoot(Number(e.target.value))}
            className="bg-slate-900 text-cyan-300 font-bold px-2 py-0.5 rounded outline-none cursor-pointer"
          >
            {ROOT_NOTE_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>

          {/* Mode */}
          <select
            value={activeMode}
            onChange={(e) => onSelectMode(e.target.value as MusicalMode)}
            className="bg-slate-900 text-slate-200 px-2 py-0.5 rounded outline-none cursor-pointer"
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Custom Semitone Slider (if custom selected) */}
        {activePreset.id === 'custom_chromatic' && (
          <div className="flex items-center gap-2 bg-slate-950/70 px-2 py-1 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-400 font-mono">Shift:</span>
            <input
              type="range"
              min="-24"
              max="24"
              value={customSemitones}
              onChange={(e) => onChangeCustomSemitones(Number(e.target.value))}
              className="w-20 accent-cyan-400 cursor-pointer"
            />
            <span className="font-mono text-cyan-300 font-bold min-w-[3ch]">
              {customSemitones > 0 ? `+${customSemitones}` : customSemitones} st
            </span>
          </div>
        )}
      </div>

      {/* Right: AI Key & Mode Detection Suggestion Banner */}
      {detectedKey && (
        <div className="flex items-center gap-2 bg-gradient-to-r from-indigo-950/80 to-purple-950/80 border border-indigo-500/40 px-3 py-1.5 rounded-lg shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 animate-pulse" />
          <div className="text-[11px]">
            <span className="text-slate-300">Detected: </span>
            <span className="font-bold text-indigo-300 font-mono">{detectedKey.fullKeyName}</span>
            <span className="text-slate-400 text-[10px] ml-1">({Math.round(detectedKey.confidence * 100)}% match)</span>
          </div>
          <button
            onClick={onApplyDetectedKey}
            className="ml-1 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-2 py-0.5 rounded text-[10px] transition active:scale-95 shadow"
          >
            Apply Mode
          </button>
        </div>
      )}
    </div>
  );
};
