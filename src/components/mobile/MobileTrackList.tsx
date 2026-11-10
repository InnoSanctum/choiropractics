import React, { useRef, useState } from 'react';
import { Upload, Star, Trash2, Loader2, Filter, Volume2, Eye, EyeOff } from 'lucide-react';
import { TrackListProps } from '../TrackList';
import { MAX_TRACKS } from '../../score/types';

/** Compact track list for phones: one row per track. */
export const MobileTrackList: React.FC<TrackListProps> = ({
  tracks,
  trainingTrackIndex = null,
  trainingMode = false,
  onToggleVisibility,
  onAddTrack,
  onImportScore,
  importDisabled,
  onUploadFile,
  onToggleMute,
  onToggleSolo,
  onChangeVolume,
  onChangeColor,
  onSetMainTrack,
  onClearTrack,
  enableBandpass,
  onToggleBandpass,
  vocalPreset,
  onSelectVocalPreset
}) => {
  const fileInputs = useRef<(HTMLInputElement | null)[]>([]);
  const scoreInput = useRef<HTMLInputElement>(null);
  const [volumeOpen, setVolumeOpen] = useState<number | null>(null);
  const btn = 'w-9 h-9 shrink-0 rounded-lg flex items-center justify-center';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center text-sm">
        <button onClick={onAddTrack} disabled={tracks.length >= MAX_TRACKS} className="rounded bg-slate-800 px-3 py-2 disabled:opacity-40">Add track</button>
        <button onClick={() => scoreInput.current?.click()} disabled={importDisabled} className="rounded bg-indigo-900 text-indigo-100 px-3 py-2 disabled:opacity-40">Import score</button>
        <span className="text-slate-400 text-xs">{tracks.filter(t => t.audioBuffer).length}/{MAX_TRACKS}</span>
        <input ref={scoreInput} type="file" accept=".mscz,.mscx" aria-label="Import MuseScore file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onImportScore(f); e.target.value = ''; }} />
      </div>
      {tracks.map(track => {
        const hasAudio = !!track.audioBuffer;
        return (
          <div
            key={track.id}
            className={`rounded-xl border px-2 py-1.5 ${
              track.isMain && hasAudio ? 'bg-indigo-950/40 border-indigo-500/50' : 'bg-slate-900/60 border-slate-800'
            }`}
          >
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
              ref={el => { fileInputs.current[track.index] = el; }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) onUploadFile(track.index, file);
                e.target.value = '';
              }}
              className="hidden"
            />

            <div className="flex items-center flex-wrap gap-1.5">
              {/* Color dot (tap to change) */}
              <label className="relative w-5 h-5 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: track.color }}>
                <input
                  type="color"
                  value={track.color}
                  onChange={e => onChangeColor(track.index, e.target.value)}
                  className="opacity-0 absolute inset-0 w-full h-full"
                  aria-label={`Track ${track.index + 1} color`}
                />
              </label>

              {track.isAnalyzing ? (
                <div className="flex-1 flex items-center gap-2 text-cyan-300 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="truncate">Analyzing {track.analysisProgress}%</span>
                </div>
              ) : !hasAudio ? (
                <button
                  onClick={() => fileInputs.current[track.index]?.click()}
                  className="flex-1 flex items-center gap-2 h-9 px-3 rounded-lg border border-dashed border-slate-700 text-slate-400 active:bg-cyan-500/10 text-sm"
                >
                  <Upload className="w-4 h-4" />
                  <span>Track {track.index + 1}: upload audio</span>
                </button>
              ) : (
                <>
                  <div className="flex-1 min-w-24 leading-tight">
                    <div className="text-sm font-semibold text-slate-200 truncate">{track.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{track.index === trainingTrackIndex ? 'Sing · silent · ' : ''}T{track.index + 1} · {track.duration.toFixed(1)}s</div>
                  </div>
                  <button
                    onClick={() => onSetMainTrack(track.index)}
                    disabled={track.isPolyphonic}
                    className={`${btn} ${track.isMain ? 'text-amber-400 bg-amber-400/15' : 'text-slate-500 bg-slate-800'}`}
                    aria-label="Use as reference"
                    aria-pressed={track.isMain}
                    title={track.index === trainingTrackIndex ? 'Your training part (silent)' : 'Reference track for coaching'}
                  >
                    <Star className="w-4 h-4 fill-current" />
                  </button>
                  <button onClick={() => onToggleVisibility(track.index)} disabled={trainingMode}
                    aria-label={`${trainingMode ? track.index === trainingTrackIndex ? 'Visible' : 'Hidden' : track.visible !== false ? 'Hide' : 'Show'} diagram for ${track.name}`}
                    aria-pressed={trainingMode ? track.index === trainingTrackIndex : track.visible !== false}
                    title={trainingMode ? 'Training shows only the selected part' : 'Toggle diagram visibility'}
                    className={`${btn} bg-slate-800 text-cyan-300 disabled:opacity-50`}>
                    {(trainingMode ? track.index === trainingTrackIndex : track.visible !== false) ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => onToggleMute(track.index)}
                    disabled={track.index === trainingTrackIndex}
                    className={`${btn} text-xs font-bold ${track.muted || track.index === trainingTrackIndex ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400'}`}
                    aria-label={track.index === trainingTrackIndex ? 'Silent while you sing this part' : 'Mute'}
                    aria-pressed={track.muted || track.index === trainingTrackIndex}
                  >
                    M
                  </button>
                  <button
                    onClick={() => onToggleSolo(track.index)}
                    disabled={track.index === trainingTrackIndex}
                    aria-pressed={track.solo && track.index !== trainingTrackIndex}
                    className={`${btn} text-xs font-bold ${track.solo && track.index !== trainingTrackIndex ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-400'}`}
                    aria-label="Solo"
                  >
                    S
                  </button>
                  <button
                    onClick={() => setVolumeOpen(v => (v === track.index ? null : track.index))}
                    className={`${btn} ${volumeOpen === track.index ? 'bg-cyan-900 text-cyan-200' : 'bg-slate-800 text-slate-400'}`}
                    aria-label="Volume"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onClearTrack(track.index)}
                    className={`${btn} text-slate-500 bg-slate-800`}
                    aria-label="Remove track"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {hasAudio && !track.isAnalyzing && volumeOpen === track.index && (
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={track.volume}
                onChange={e => onChangeVolume(track.index, parseFloat(e.target.value))}
                className="w-full mt-2 accent-cyan-400"
                aria-label="Volume"
              />
            )}
          </div>
        );
      })}

      {/* Analysis filter (applies to the next upload) */}
      <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-slate-400">
        <Filter className="w-4 h-4 text-cyan-400" />
        <span>Vocal filter for uploads:</span>
        <button
          onClick={onToggleBandpass}
          className={`px-3 h-9 rounded-lg font-semibold ${enableBandpass ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}
        >
          {enableBandpass ? 'On' : 'Off'}
        </button>
        {enableBandpass && (
          <select
            value={vocalPreset}
            onChange={e => onSelectVocalPreset(e.target.value as TrackListProps['vocalPreset'])}
            className="bg-slate-950 text-cyan-300 rounded-lg px-2 h-9 outline-none border border-slate-800"
          >
            <option value="all">Full range (50–1400 Hz)</option>
            <option value="male">Male (65–600 Hz)</option>
            <option value="female">Female (130–950 Hz)</option>
            <option value="soprano">Soprano (200–1300 Hz)</option>
          </select>
        )}
      </div>
    </div>
  );
};
