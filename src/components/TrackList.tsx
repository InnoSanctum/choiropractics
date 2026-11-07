import React, { useRef } from 'react';
import { 
  Upload, 
  Volume2, 
  VolumeX, 
  Star, 
  Trash2, 
  Filter, 
  Loader2, 
  Palette,
  FileAudio
} from 'lucide-react';
import { AudioTrackState, DEFAULT_TRACK_COLORS } from '../audio/MultiTrackMixer';

interface TrackListProps {
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
    <div className="mx-4 my-2 flex flex-col gap-2">
      {/* Track List Header & Filter Toggle */}
      <div className="flex items-center justify-between text-xs px-1 text-slate-400">
        <span className="font-bold uppercase tracking-wider text-[11px] text-slate-300">
          Audio Tracks (Up to 6 Files)
        </span>

        {/* Vocal Bandpass Dominant Filter Switch */}
        <div className="flex items-center gap-2 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
          <Filter className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px]">Vocal Isolation Filter:</span>
          <button
            onClick={onToggleBandpass}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
              enableBandpass
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-400'
            }`}
            title="Filters out bass drums and cymbals to isolate lead vocal fundamental"
          >
            {enableBandpass ? 'Active' : 'Bypassed'}
          </button>

          {enableBandpass && (
            <select
              value={vocalPreset}
              onChange={(e) => onSelectVocalPreset(e.target.value as any)}
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

      {/* Grid of 6 Tracks */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
        {tracks.map((track) => {
          const hasAudio = !!track.audioBuffer;

          return (
            <div
              key={track.id}
              className={`p-2.5 rounded-xl border backdrop-blur transition-all flex flex-col justify-between min-h-[145px] ${
                track.isMain
                  ? 'bg-indigo-950/30 border-indigo-500/50 shadow-md shadow-indigo-500/10'
                  : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Hidden File Input */}
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
                ref={(el) => (fileInputRefs.current[track.index] = el)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile(track.index, file);
                }}
                className="hidden"
              />

              {/* Track Top Row */}
              <div className="flex items-center justify-between gap-1">
                {/* Track Number & Color Dot */}
                <div className="flex items-center gap-1.5 truncate">
                  <div className="relative group">
                    <div
                      className="w-3.5 h-3.5 rounded-full border border-white/20 shadow cursor-pointer transition hover:scale-110"
                      style={{ backgroundColor: track.color }}
                      title="Click to customize track curve color"
                    />
                    <input
                      type="color"
                      value={track.color}
                      onChange={(e) => onChangeColor(track.index, e.target.value)}
                      className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                    />
                  </div>
                  <span className="text-[11px] font-bold text-slate-300 truncate">
                    T{track.index + 1}: {track.name}
                  </span>
                </div>

                {/* Main Reference Star Button */}
                {hasAudio && (
                  <button
                    onClick={() => onSetMainTrack(track.index)}
                    className={`p-1 rounded transition ${
                      track.isMain
                        ? 'text-amber-400 bg-amber-400/20'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title={track.isMain ? 'Main reference target' : 'Set as main reference target'}
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>
                )}
              </div>

              {/* Middle Section: Upload button or waveform stats */}
              <div className="my-2">
                {track.isAnalyzing ? (
                  <div className="flex flex-col items-center justify-center py-2 text-cyan-400">
                    <Loader2 className="w-5 h-5 animate-spin mb-1" />
                    <span className="text-[10px] font-mono">Analyzing {track.analysisProgress}%</span>
                  </div>
                ) : !hasAudio ? (
                  <button
                    onClick={() => fileInputRefs.current[track.index]?.click()}
                    className="w-full py-3 border border-dashed border-slate-700 hover:border-cyan-500/50 hover:bg-cyan-500/5 rounded-lg flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-cyan-300 transition text-[11px]"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Audio</span>
                  </button>
                ) : (
                  <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800 text-[10px] flex items-center justify-between">
                    <div className="flex items-center gap-1 text-slate-400 truncate">
                      <FileAudio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">{track.duration.toFixed(1)}s</span>
                    </div>
                    <span className="font-mono text-cyan-400">
                      {track.pitchFrames.filter(f => f.voiced).length} frames
                    </span>
                  </div>
                )}
              </div>

              {/* Bottom Row: Mute, Solo, Volume & Delete */}
              {hasAudio ? (
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-800">
                  {/* Mute (M) */}
                  <button
                    onClick={() => onToggleMute(track.index)}
                    className={`w-6 h-6 rounded text-[10px] font-bold transition flex items-center justify-center ${
                      track.muted
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                    title={track.muted ? 'Unmute' : 'Mute'}
                  >
                    M
                  </button>

                  {/* Solo (S) */}
                  <button
                    onClick={() => onToggleSolo(track.index)}
                    className={`w-6 h-6 rounded text-[10px] font-bold transition flex items-center justify-center ${
                      track.solo
                        ? 'bg-amber-400 text-slate-950 shadow-sm'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                    title={track.solo ? 'Solo Active' : 'Solo'}
                  >
                    S
                  </button>

                  {/* Volume Slider */}
                  <div className="flex-1 px-1">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={track.volume}
                      onChange={(e) => onChangeVolume(track.index, parseFloat(e.target.value))}
                      className="w-full accent-cyan-400 h-1 bg-slate-800 rounded cursor-pointer"
                      title={`Volume: ${Math.round(track.volume * 100)}%`}
                    />
                  </div>

                  {/* Clear / Delete Track */}
                  <button
                    onClick={() => onClearTrack(track.index)}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 transition"
                    title="Remove Track"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="text-[10px] text-center text-slate-600 italic">
                  Slot empty
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
