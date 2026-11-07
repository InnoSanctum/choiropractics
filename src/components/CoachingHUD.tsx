import React from 'react';
import { ArrowUp, ArrowDown, CheckCircle2, Mic, Target, Flame } from 'lucide-react';
import { CoachingFeedback } from '../audio/PitchComparator';

interface CoachingHUDProps {
  feedback: CoachingFeedback;
  hasMainTrack: boolean;
  tunerMode?: boolean;
  /** Tuner calibration, shown next to the note */
  referenceA4?: number;
}

export const CoachingHUD: React.FC<CoachingHUDProps> = ({ feedback, hasMainTrack, tunerMode = false, referenceA4 = 440 }) => {
  const { status, centsDiff, suggestion, targetNote, micNote, inTunePercentage, targetHz, micHz } = feedback;

  // Determine meter needle position: -50 cents to +50 cents -> 0% to 100%
  const clampedCents = Math.max(-50, Math.min(50, centsDiff));
  const meterPercent = ((clampedCents + 50) / 100) * 100;

  let statusBg = 'bg-slate-900/80 border-slate-800';
  let badgeColor = 'bg-slate-800 text-slate-400';
  let IconComponent = null;

  if (status === 'in_tune') {
    statusBg = 'bg-emerald-950/40 border-emerald-500/50 shadow-lg shadow-emerald-500/10';
    badgeColor = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    IconComponent = CheckCircle2;
  } else if (status === 'flat') {
    statusBg = 'bg-amber-950/40 border-amber-500/50 shadow-lg shadow-amber-500/10';
    badgeColor = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    IconComponent = ArrowUp;
  } else if (status === 'sharp') {
    statusBg = 'bg-purple-950/40 border-purple-500/50 shadow-lg shadow-purple-500/10';
    badgeColor = 'bg-purple-500/20 text-purple-400 border border-purple-500/30';
    IconComponent = ArrowDown;
  }

  return (
    <div className={`mx-4 my-2 p-3 rounded-xl border backdrop-blur transition-all duration-200 flex flex-wrap items-center justify-between gap-4 ${statusBg}`}>
      {/* Target Note vs Live Mic Note */}
      <div className="flex items-center gap-4">
        {/* Target */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-950 border border-indigo-800/60 flex items-center justify-center">
            <Target className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              {tunerMode ? `Nearest note (A4 = ${referenceA4} Hz)` : 'Target'}
            </div>
            <div className="text-lg font-bold font-mono text-indigo-300 flex items-baseline gap-1">
              {targetNote || '—'}
              {targetHz > 0 && <span className="text-[10px] font-normal text-slate-400">{Math.round(targetHz)}Hz</span>}
            </div>
          </div>
        </div>

        <div className="h-8 w-px bg-slate-800" />

        {/* Live Mic */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-rose-950 border border-rose-800/60 flex items-center justify-center">
            <Mic className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{tunerMode ? 'Detected' : 'Your Voice'}</div>
            <div className="text-lg font-bold font-mono text-rose-300 flex items-baseline gap-1">
              {micNote || '—'}
              {micHz > 0 && <span className="text-[10px] font-normal text-slate-400">{micHz.toFixed(1)}Hz</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Center: Real-Time Cent Deviation Needle */}
      <div className="flex-1 max-w-md flex flex-col items-center">
        <div className="w-full flex justify-between text-[10px] font-mono text-slate-400 mb-1">
          <span>-50c (Flat)</span>
          <span className="font-bold text-cyan-400">0c (Perfect)</span>
          <span>+50c (Sharp)</span>
        </div>

        {/* Visual Cents Gauge */}
        <div className="w-full h-3 bg-slate-950 rounded-full border border-slate-800 relative overflow-hidden flex items-center">
          {/* Safe in-tune zone (±10 cents) */}
          <div className="absolute left-[40%] right-[40%] h-full bg-emerald-500/20" />
          {/* Center line */}
          <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-full bg-emerald-400/60" />

          {/* Animated Needle */}
          {micHz > 0 && (
            <div
              className={`absolute top-0 bottom-0 w-2.5 rounded-full -translate-x-1/2 shadow-lg transition-all duration-75 ${
                status === 'in_tune'
                  ? 'bg-emerald-400 shadow-emerald-400/50'
                  : status === 'flat'
                  ? 'bg-amber-400 shadow-amber-400/50'
                  : 'bg-purple-400 shadow-purple-400/50'
              }`}
              style={{ left: `${meterPercent}%` }}
            />
          )}
        </div>

        {/* Cents discrepancy text */}
        <div className="mt-1 font-mono text-xs font-semibold">
          {micHz > 0 && targetHz > 0 ? (
            <span className={status === 'in_tune' ? 'text-emerald-400' : status === 'flat' ? 'text-amber-400' : 'text-purple-400'}>
              {Math.abs(centsDiff) >= 100
                ? `${centsDiff > 0 ? '+' : '−'}${(Math.abs(centsDiff) / 100).toFixed(1)} semitones`
                : `${centsDiff > 0 ? '+' : ''}${centsDiff} cents`}
            </span>
          ) : (
            <span className="text-slate-500 text-[11px]">
              {tunerMode
                ? 'Sing or play a note'
                : hasMainTrack ? 'Awaiting voice or playback' : 'Select a track with ⭐ to enable pitch coaching'}
            </span>
          )}
        </div>
      </div>

      {/* Right: Suggestion Pill & Accuracy Score */}
      <div className="flex items-center gap-3">
        {/* Suggestion Badge */}
        <div className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold tracking-tight ${badgeColor}`}>
          {IconComponent && <IconComponent className="w-4 h-4 shrink-0" />}
          <span>{suggestion}</span>
        </div>

        {/* Accuracy Score */}
        <div className="bg-slate-950/70 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
          <Flame className="w-3.5 h-3.5 text-orange-400" />
          <div className="text-right">
            <div className="text-[9px] uppercase font-bold text-slate-400">Intonation</div>
            <div className="text-xs font-mono font-bold text-orange-400">{inTunePercentage}%</div>
          </div>
        </div>
      </div>
    </div>
  );
};
