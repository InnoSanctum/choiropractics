import React from 'react';

export interface TunerPanelProps {
  referenceA4: number;
  onChangeReferenceA4: (hz: number) => void;
  isMicActive: boolean;
  onEnableMic: () => void;
  /** Render without the outer card (inside a mobile sheet) */
  embedded?: boolean;
}

export const TunerPanel: React.FC<TunerPanelProps> = ({
  referenceA4,
  onChangeReferenceA4,
  isMicActive,
  onEnableMic,
  embedded = false
}) => (
  <div className={embedded
    ? 'flex flex-col items-start gap-3 text-sm'
    : 'mx-4 mb-2 px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-wrap items-center gap-3 text-xs'}>
    {!embedded && <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Tuner</span>}
    <div className="flex items-center gap-1.5 bg-slate-950/70 px-2 py-1 rounded-lg border border-slate-800">
      <span className="text-[10px] uppercase font-bold text-slate-400">A4 =</span>
      <input
        type="number"
        min={400}
        max={480}
        step={0.5}
        value={referenceA4}
        onChange={(e) => onChangeReferenceA4(Math.max(400, Math.min(480, Number(e.target.value) || 440)))}
        className="bg-slate-900 text-cyan-300 font-mono px-1.5 py-0.5 rounded outline-none border border-slate-800 w-20"
      />
      <span className="text-slate-500 text-[10px]">Hz</span>
      {referenceA4 !== 440 && (
        <button onClick={() => onChangeReferenceA4(440)} className="text-[10px] text-slate-400 hover:text-cyan-300 ml-1">reset</button>
      )}
    </div>
    <span className="text-slate-400">
      Sing or play a sustained note — the needle shows the distance to the nearest note. No reference track needed.
    </span>
    {!isMicActive && (
      <button onClick={onEnableMic} className={`${embedded ? '' : 'ml-auto'} px-3 py-1 rounded bg-rose-600 text-white font-semibold`}>
        Enable mic
      </button>
    )}
  </div>
);
