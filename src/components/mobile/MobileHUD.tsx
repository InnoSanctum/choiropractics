import React from 'react';
import { ArrowUp, ArrowDown, Check } from 'lucide-react';
import { CoachingHUDProps } from '../CoachingHUD';

/** One-line coaching bar for phones: target, your note, cents needle, score. */
export const MobileHUD: React.FC<CoachingHUDProps & { compact?: boolean }> = ({
  feedback, hasMainTrack, tunerMode = false, referenceA4 = 440, compact = false, precisionCents = 10
}) => {
  const { status, centsDiff, targetNote, micNote, inTunePercentage, micHz, targetHz } = feedback;
  const active = micHz > 0 && targetHz > 0;
  const clamped = Math.max(-50, Math.min(50, feedback.needleCents ?? centsDiff));
  const zone = Math.max(0.5, Math.min(50, precisionCents));
  const needle = ((clamped + 50) / 100) * 100;

  const tone = status === 'in_tune' ? 'emerald' : status === 'flat' ? 'amber' : status === 'sharp' ? 'purple' : 'slate';
  const toneText = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    purple: 'text-purple-400',
    slate: 'text-slate-400'
  }[tone];
  const toneBg = {
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    purple: 'bg-purple-400',
    slate: 'bg-slate-500'
  }[tone];
  const Icon = status === 'in_tune' ? Check : status === 'flat' ? ArrowUp : status === 'sharp' ? ArrowDown : null;
  const centsLabel = !active
    ? ''
    : Math.abs(centsDiff) >= 100
      ? `${centsDiff > 0 ? '+' : '−'}${(Math.abs(centsDiff) / 100).toFixed(1)} st`
      : `${centsDiff > 0 ? '+' : ''}${Math.round(centsDiff)}c`;

  const gauge = (
    <div className="relative h-2.5 bg-slate-950 rounded-full border border-slate-800 overflow-hidden">
      <div className="absolute h-full bg-emerald-500/20" style={{ left: `${50 - zone}%`, right: `${50 - zone}%` }} />
      <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-full bg-emerald-400/60" />
      {active && (
        <div
          className={`absolute top-0 bottom-0 w-2 rounded-full -translate-x-1/2 transition-all duration-75 ${toneBg}`}
          style={{ left: `${needle}%` }}
        />
      )}
    </div>
  );

  if (tunerMode) {
    return (
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/80 flex items-center gap-3">
        <div className="flex flex-col items-center min-w-[72px]">
          <span className={`text-3xl font-black font-mono leading-none ${active ? toneText : 'text-slate-600'}`}>
            {active ? targetNote : '—'}
          </span>
          <span className="text-[10px] text-slate-500 font-mono mt-0.5">
            {micHz > 0 ? `${micHz.toFixed(1)} Hz` : `A4 = ${referenceA4}`}
          </span>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex justify-between text-[10px] font-mono text-slate-500">
            <span>−50c</span>
            <span className={`font-bold ${toneText}`}>{active ? centsLabel : 'Sing a note'}</span>
            <span>+50c</span>
          </div>
          {gauge}
        </div>
      </div>
    );
  }

  return (
    <div className={`px-3 ${compact ? 'py-0.5' : 'py-1.5'} border-b border-slate-800 bg-slate-900/80 flex items-center gap-2.5 text-xs`}>
      <div className="flex flex-col leading-tight min-w-[44px]">
        <span className="text-[9px] uppercase font-bold text-slate-500">Target</span>
        <span className="font-mono font-bold text-indigo-300 text-sm">{targetNote || '—'}</span>
      </div>
      <div className="flex flex-col leading-tight min-w-[44px]">
        <span className="text-[9px] uppercase font-bold text-slate-500">You</span>
        <span className="font-mono font-bold text-rose-300 text-sm">{micNote || '—'}</span>
      </div>
      <div className={`flex-1 flex ${compact ? 'flex-row items-center gap-2' : 'flex-col gap-1'} min-w-0`}>
        <div className="flex-1">{gauge}</div>
        <div className={`text-[10px] font-mono text-center truncate ${compact ? 'min-w-[90px]' : ''} ${toneText}`}>
          {active ? (
            <span className="inline-flex items-center gap-1">
              {Icon && <Icon className="w-3 h-3" />}
              {centsLabel}
            </span>
          ) : (
            <span className="text-slate-500">{hasMainTrack ? 'Press play & sing' : 'Load a track (★ = reference)'}</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end leading-tight">
        <span className="text-[9px] uppercase font-bold text-slate-500">Score</span>
        <span className="font-mono font-bold text-orange-400 text-sm">{inTunePercentage}%</span>
      </div>
    </div>
  );
};
