import React, { useRef } from 'react';
import { Upload, Star, Trash2, Filter, Loader2 } from 'lucide-react';
import { AudioTrackState } from '../audio/MultiTrackMixer';

export interface TrackListProps {
  tracks: AudioTrackState[];
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

  return (
    <div className="mx-4 my-2 flex flex-col gap-1.5">
      {/* Header & analysis filter */}
      <div className="flex items-center justify-between text-xs px-1 text-slate-400">
        <span className="font-bold uppercase tracking-wider text-[11px] text-slate-300">Tracks</span>

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
                    {track.name}
                    <span className="font-normal text-slate-500 font-mono ml-1.5">{track.duration.toFixed(1)}s</span>
                  </span>
                  <button
                    onClick={() => onSetMainTrack(track.index)}
                    className={`w-6 h-6 shrink-0 rounded flex items-center justify-center transition ${
                      track.isMain ? 'text-amber-400 bg-amber-400/20' : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title={track.isMain ? 'Reference track for coaching' : 'Use as reference track'}
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    onClick={() => onToggleMute(track.index)}
                    className={`w-6 h-6 shrink-0 rounded text-[10px] font-bold transition ${
                      track.muted ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                    title={track.muted ? 'Unmute' : 'Mute'}
                  >
                    M
                  </button>
                  <button
                    onClick={() => onToggleSolo(track.index)}
                    className={`w-6 h-6 shrink-0 rounded text-[10px] font-bold transition ${
                      track.solo ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                    title={track.solo ? 'Solo on' : 'Solo'}
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
