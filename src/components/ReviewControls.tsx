import React, { useEffect, useRef, useState } from 'react';
import { CircleAlert, Download, Image, FileText, Loader2 } from 'lucide-react';
import { ExportFormat, ExportRange } from '../visualizer/DiagramExport';

export const MISTAKE_LEVELS = [10, 15, 20, 25, 30, 40, 50];

export interface ReviewControlsProps {
  /** Mistake highlighting (practice mode only) */
  showMistakeControls: boolean;
  highlightMistakes: boolean;
  onToggleHighlightMistakes: () => void;
  mistakeCents: number;
  onMistakeCentsChange: (cents: number) => void;
  canHighlight: boolean;

  onExport: (format: ExportFormat, range: ExportRange) => void;
  exporting: boolean;
  /** Whole-song export available (practice mode with a song loaded) */
  canExportSong: boolean;
}

const EXPORT_ITEMS: { format: ExportFormat; range: ExportRange; label: string; hint: string }[] = [
  { format: 'png', range: 'view', label: 'Picture (PNG) – this view', hint: 'Exactly what is on screen' },
  { format: 'png', range: 'song', label: 'Picture (PNG) – whole song', hint: 'One long image at this zoom' },
  { format: 'pdf', range: 'view', label: 'PDF – this view', hint: 'One page' },
  { format: 'pdf', range: 'song', label: 'PDF – whole song', hint: 'Page by page at this zoom' }
];

const MistakeSelect: React.FC<{ value: number; onChange: (c: number) => void; className: string }> = ({ value, onChange, className }) => (
  <select
    value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    className={className}
    title="Sensitivity: how far off (in cents) counts as a mistake"
  >
    {MISTAKE_LEVELS.map(c => <option key={c} value={c}>&gt; {c}¢</option>)}
  </select>
);

/** Desktop: compact toolbar group with the mistake toggle, sensitivity, and an Export menu. */
export const ReviewControls: React.FC<ReviewControlsProps> = (p) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="flex items-center gap-1.5">
      {p.showMistakeControls && (
        <div
          className={`flex items-center gap-1.5 p-1 rounded-lg border text-xs ${
            p.highlightMistakes ? 'bg-rose-950/50 border-rose-700/60' : 'bg-slate-950/60 border-slate-800'
          }`}
        >
          <label
            className={`flex items-center gap-1.5 px-1.5 cursor-pointer select-none ${p.canHighlight ? 'text-slate-300' : 'text-slate-500'}`}
            title={p.canHighlight
              ? 'Circle the places where a take goes off the reference (or harmony) notes'
              : 'Needs a reference track (⭐)'}
          >
            <input type="checkbox" checked={p.highlightMistakes} onChange={p.onToggleHighlightMistakes} className="accent-rose-500 cursor-pointer" />
            <CircleAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Mistakes</span>
          </label>
          {p.highlightMistakes && (
            <MistakeSelect
              value={p.mistakeCents}
              onChange={p.onMistakeCentsChange}
              className="bg-slate-900 text-slate-200 text-xs rounded px-1 h-6 border border-slate-800 outline-none cursor-pointer"
            />
          )}
        </div>
      )}

      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          disabled={p.exporting}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950/60 text-xs text-slate-300 hover:bg-slate-800 transition disabled:opacity-50"
          title="Save the diagram as a picture or PDF, exactly as shown"
        >
          {p.exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Export
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 w-64 py-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
            {EXPORT_ITEMS.filter(it => it.range === 'view' || p.canExportSong).map(it => (
              <button
                key={`${it.format}-${it.range}`}
                onClick={() => {
                  setOpen(false);
                  p.onExport(it.format, it.range);
                }}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-800"
              >
                {it.format === 'png' ? <Image className="w-4 h-4 mt-0.5 text-cyan-400" /> : <FileText className="w-4 h-4 mt-0.5 text-rose-400" />}
                <span>
                  <span className="block text-xs text-slate-200">{it.label}</span>
                  <span className="block text-[10px] text-slate-500">{it.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Phone: labelled sections for the Settings sheet. */
export const ReviewControlsEmbedded: React.FC<ReviewControlsProps> = (p) => (
  <>
    {p.showMistakeControls && (
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase font-bold text-slate-400">Mistakes</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 flex-1">
            <input type="checkbox" checked={p.highlightMistakes} onChange={p.onToggleHighlightMistakes} className="w-5 h-5 accent-rose-500" />
            <span>Circle mistakes</span>
          </label>
          <MistakeSelect
            value={p.mistakeCents}
            onChange={p.onMistakeCentsChange}
            className="bg-slate-950 text-slate-200 rounded-lg px-2 border border-slate-800"
          />
        </div>
        <span className="text-xs text-slate-500">
          {p.canHighlight
            ? 'Marks where a take is off the reference (or harmony) note by more than the chosen amount.'
            : 'Choose a reference track (⭐) first.'}
        </span>
      </div>
    )}

    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase font-bold text-slate-400 flex items-center gap-2">
        Export diagram {p.exporting && <Loader2 className="w-3 h-3 animate-spin" />}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {EXPORT_ITEMS.filter(it => it.range === 'view' || p.canExportSong).map(it => (
          <button
            key={`${it.format}-${it.range}`}
            onClick={() => p.onExport(it.format, it.range)}
            disabled={p.exporting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-xs text-left disabled:opacity-40"
          >
            {it.format === 'png' ? <Image className="w-4 h-4 shrink-0 text-cyan-400" /> : <FileText className="w-4 h-4 shrink-0 text-rose-400" />}
            {it.format.toUpperCase()} · {it.range === 'view' ? 'this view' : 'whole song'}
          </button>
        ))}
      </div>
      <span className="text-xs text-slate-500">Saved exactly as shown: takes, harmony, bar lines and mistake circles.</span>
    </div>
  </>
);
