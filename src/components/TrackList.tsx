import React, { useRef } from 'react';
import { Upload, Star, Trash2, Filter, Loader2, Eye, EyeOff, Plus, BookOpen, MoveHorizontal } from 'lucide-react';
import { AudioTrackState } from '../audio/MultiTrackMixer';
import { MAX_TRACKS } from '../score/types';
import { trackOffset } from '../audio/TrackTiming';

export interface TrackListProps {
  tracks: AudioTrackState[];
  trainingTrackIndex?: number | null;
  trainingMode?: boolean;
  onToggleVisibility: (index: number) => void;
  onAddTrack: () => void;
  onImportScore: (file: File) => void;
  onOpenLibrary: () => void;
  onAlignTrack: (index: number) => void;
  aligningTrackIndex?: number | null;
  librarySongTitle?: string;
  importDisabled?: boolean;
  onUploadFile: (index: number, file: File) => void;
  onToggleMute: (index: number) => void;
  onToggleSolo: (index: number) => void;
  onChangeVolume: (index: number, vol: number) => void;
  onChangeColor: (index: number, color: string) => void;
  onSetMainTrack: (index: number) => void;
  onClearTrack: (index: number) => void;
  enableBandpass: boolean;
  onToggleBandpass: () => void;
  vocalPreset: 'all' | 'male' | 'female' | 'soprano' | 'custom';
  onSelectVocalPreset: (p: 'all' | 'male' | 'female' | 'soprano' | 'custom') => void;
}

/** Desktop track list: one compact line per track, 3 per row on wide screens. */
export const TrackList: React.FC<TrackListProps> = ({
  tracks,
  trainingTrackIndex = null,
  trainingMode = false,
  onToggleVisibility,
  onAddTrack,
  onImportScore,
  onOpenLibrary,
  onAlignTrack,
  aligningTrackIndex,
  librarySongTitle,
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
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const scoreInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-4 my-2 flex flex-col gap-1.5 shrink-0 max-h-[32vh] overflow-y-auto">
      {/* Header & analysis filter */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1 text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold uppercase tracking-wider text-[11px] text-slate-300">Tracks ({tracks.filter(t => t.audioBuffer).length}/{MAX_TRACKS})</span>
          <button onClick={onOpenLibrary} disabled={importDisabled} className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-900 text-cyan-100 disabled:opacity-40"><BookOpen className="w-3.5 h-3.5" />Library</button>
          <button onClick={onAddTrack} disabled={tracks.length >= MAX_TRACKS} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 disabled:opacity-40" title="Add an audio track"><Plus className="w-3.5 h-3.5" />Track</button>
          <button onClick={() => scoreInput.current?.click()} disabled={importDisabled} className="px-2 py-1 rounded bg-indigo-900 text-indigo-100 disabled:opacity-40">Import score</button>
          <input ref={scoreInput} type="file" accept=".mscz,.mscx" aria-label="Import MuseScore file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onImportScore(f); e.target.value = ''; }} />
        </div>

        <div className="flex items-center gap-2 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
          <Filter className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px]">Vocal filter for uploads:</span>
          <button
            onClick={onToggleBandpass}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
              enableBandpass ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'
            }`}
            title="Band-pass filter applied before pitch analysis (isolates the voice range)"
          >
            {enableBandpass ? 'On' : 'Off'}
          </button>
          {enableBandpass && (
            <select
              value={vocalPreset}
              onChange={(e) => onSelectVocalPreset(e.target.value as TrackListProps['vocalPreset'])}
              className="bg-slate-950 text-cyan-300 text-[10px] rounded px-1.5 py-0.5 outline-none cursor-pointer"
            >
              <option value="all">Full Range (50-1400Hz)</option>
              <option value="male">Male (65-600Hz)</option>
              <option value="female">Female (130-950Hz)</option>
              <option value="soprano">Soprano (200-1300Hz)</option>
            </select>
          )}
        </div>
      </div>

      {librarySongTitle && <div className="text-sm font-semibold text-cyan-200 px-1 truncate" title={librarySongTitle}>{librarySongTitle}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
        {tracks.map((track) => {
          const hasAudio = !!track.audioBuffer;
          return (
            <div
              key={track.id}
              className={`h-10 px-2 rounded-lg border flex items-center gap-1.5 text-xs ${
                track.isMain && hasAudio
                  ? 'bg-indigo-950/40 border-indigo-500/50'
                  : 'bg-slate-900/50 border-slate-800'
              }`}
            >
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
                ref={(el) => { fileInputRefs.current[track.index] = el; }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile(track.index, file);
                  e.target.value = '';
                }}
                className="hidden"
              />

              {/* Colour dot (click to change) */}
              <label
                className="relative w-3.5 h-3.5 shrink-0 rounded-full border border-white/20 cursor-pointer"
                style={{ backgroundColor: track.color }}
                title="Track colour"
              >
                <input
                  type="color"
                  value={track.color}
                  onChange={(e) => onChangeColor(track.index, e.target.value)}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                />
              </label>

              {track.isAnalyzing ? (
                <div className="flex-1 flex items-center gap-1.5 text-cyan-400 font-mono text-[11px]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  T{track.index + 1}: analyzing {track.analysisProgress}%
                </div>
              ) : !hasAudio ? (
                <button
                  onClick={() => fileInputRefs.current[track.index]?.click()}
                  className="flex-1 h-7 px-2 border border-dashed border-slate-700 hover:border-cyan-500/60 hover:text-cyan-300 rounded-md flex items-center gap-1.5 text-slate-500 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Track {track.index + 1}: upload audio
                </button>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate text-slate-200 font-semibold" title={track.name}>
                    {track.index === trainingTrackIndex && <span className="text-indigo-300 mr-1">Sing · silent</span>}
                    {track.name}
                    <span className="font-normal text-slate-500 font-mono ml-1.5">{track.duration.toFixed(1)}s</span>
                    {trackOffset(track) !== 0 && <span className="text-cyan-300 font-mono ml-1">{trackOffset(track) > 0 ? '+' : ''}{trackOffset(track)}s</span>}
                  </span>
                  <button
                    onClick={() => onSetMainTrack(track.index)}
                    disabled={track.isPolyphonic}
                    className={`w-6 h-6 shrink-0 rounded flex items-center justify-center transition ${
                      track.isMain ? 'text-amber-400 bg-amber-400/20' : 'text-slate-500 hover:text-slate-300'
                    }`}
                    aria-pressed={track.isMain}
                    title={track.isPolyphonic ? 'Chord accompaniment: choose a single melody for training' : track.index === trainingTrackIndex ? 'Your training part (silent)' : 'Use as reference track'}
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    onClick={() => onToggleVisibility(track.index)} disabled={trainingMode}
                    aria-label={`${trainingMode ? track.index === trainingTrackIndex ? 'Visible' : 'Hidden' : track.visible !== false ? 'Hide' : 'Show'} diagram for ${track.name}`}
                    aria-pressed={trainingMode ? track.index === trainingTrackIndex : track.visible !== false}
                    title={trainingMode ? 'Training shows only the selected part' : 'Toggle diagram visibility'}
                    className="w-6 h-6 shrink-0 rounded flex items-center justify-center text-cyan-300 bg-slate-800 disabled:opacity-50">
                    {(trainingMode ? track.index === trainingTrackIndex : track.visible !== false) ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => onAlignTrack(track.index)} aria-label={`Align ${track.name}`}
                    title={`Move this part on the timeline (start ${trackOffset(track)}s)`}
                    className={`w-6 h-6 shrink-0 rounded flex items-center justify-center ${aligningTrackIndex === track.index ? 'bg-cyan-700 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    <MoveHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onToggleMute(track.index)}
                    disabled={track.index === trainingTrackIndex}
                    aria-pressed={track.muted || track.index === trainingTrackIndex}
                    className={`w-6 h-6 shrink-0 rounded text-[10px] font-bold transition ${
                      track.muted || track.index === trainingTrackIndex ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                    title={track.index === trainingTrackIndex ? 'Silent while you sing this part' : track.muted ? 'Unmute' : 'Mute'}
                  >
                    M
                  </button>
                  <button
                    onClick={() => onToggleSolo(track.index)}
                    disabled={track.index === trainingTrackIndex}
                    aria-pressed={track.solo && track.index !== trainingTrackIndex}
                    className={`w-6 h-6 shrink-0 rounded text-[10px] font-bold transition ${
                      track.solo && track.index !== trainingTrackIndex ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                    title={track.index === trainingTrackIndex ? 'Solo is ignored for the silent training part' : track.solo ? 'Solo on' : 'Solo'}
                  >
                    S
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={track.volume}
                    onChange={(e) => onChangeVolume(track.index, parseFloat(e.target.value))}
                    className="w-20 shrink-0 accent-cyan-400 cursor-pointer"
                    title={`Volume: ${Math.round(track.volume * 100)}%`}
                  />
                  <button
                    onClick={() => onClearTrack(track.index)}
                    className="w-6 h-6 shrink-0 rounded flex items-center justify-center text-slate-500 hover:text-rose-400 transition"
                    title="Remove track"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
