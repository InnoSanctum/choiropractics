import React from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Mic, 
  MicOff, 
  Trash2,
  Layers,
  Activity,
  Palette, 
  SlidersHorizontal,
  Music2
} from 'lucide-react';
import { ThemeId, THEMES, NoteLabelMode } from '../visualizer/ThemeManager';

export interface TopBarProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  currentTime: number;
  duration: number;
  
  isMicActive: boolean;
  onToggleMic: () => void;
  inputDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelectDevice: (id: string) => void;

  theme: ThemeId;
  onSelectTheme: (theme: ThemeId) => void;

  noteLabelMode: NoteLabelMode;
  onSelectNoteLabelMode: (mode: NoteLabelMode) => void;

  enharmonic: 'sharp' | 'flat';
  onToggleEnharmonic: () => void;

  appMode: 'practice' | 'training' | 'tuner';
  onSetAppMode: (mode: 'practice' | 'training' | 'tuner') => void;

  keepTakes: boolean;
  onToggleKeepTakes: () => void;
  takeCount: number;
  onClearTakes: () => void;

  /** Extra controls at the start of the right-hand group (desktop) */
  extra?: React.ReactNode;
}

export const TopBar: React.FC<TopBarProps> = ({
  isPlaying,
  onPlayPause,
  onStop,
  currentTime,
  duration,
  isMicActive,
  onToggleMic,
  inputDevices,
  selectedDeviceId,
  onSelectDevice,
  theme,
  onSelectTheme,
  noteLabelMode,
  onSelectNoteLabelMode,
  enharmonic,
  onToggleEnharmonic,
  appMode,
  onSetAppMode,
  keepTakes,
  onToggleKeepTakes,
  takeCount,
  onClearTakes,
  extra
}) => {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 flex items-center justify-between gap-4 z-20">
      {/* Brand & Mic Toggle */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Music2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-50 flex items-center gap-1.5">
              Praat Tuner <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/50">1-Cent</span>
            </h1>
          </div>
        </div>

        {/* Microphone Button & Device Selector */}
        <div className="flex items-center gap-2 bg-slate-950/60 p-1 rounded-lg border border-slate-800">
          <button
            onClick={onToggleMic}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all shadow-sm ${
              isMicActive
                ? 'bg-rose-600 text-white shadow-rose-600/30 animate-pulse'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            {isMicActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            <span>{isMicActive ? 'Mic Active' : 'Enable Mic'}</span>
          </button>

          {inputDevices.length > 0 && (
            <select
              value={selectedDeviceId}
              onChange={(e) => onSelectDevice(e.target.value)}
              className="bg-transparent text-xs text-slate-300 outline-none max-w-[130px] truncate pr-1 cursor-pointer"
            >
              <option value="default" className="bg-slate-900">Default Mic</option>
              {inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId} className="bg-slate-900">
                  {d.label || `Device ${d.deviceId.slice(0, 5)}`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Sung takes */}
        <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800 text-xs">
          <label
            className="flex items-center gap-1.5 px-1.5 cursor-pointer text-slate-300 select-none"
            title="On: every pass keeps its own colored line. Off: each new pass replaces the previous one."
          >
            <input
              type="checkbox"
              checked={keepTakes}
              onChange={onToggleKeepTakes}
              className="accent-rose-500 cursor-pointer"
            />
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>Keep takes</span>
            {takeCount > 0 && <span className="font-mono text-[10px] text-rose-300">({takeCount})</span>}
          </label>
          <button
            onClick={onClearTakes}
            disabled={takeCount === 0}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 disabled:opacity-30 disabled:hover:bg-transparent transition"
            title="Clear sung pitch lines (C)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center: Playback Transport Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPlayPause}
          className="w-10 h-10 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 flex items-center justify-center transition shadow-lg shadow-cyan-500/20 active:scale-95"
          title={isPlaying ? 'Pause' : 'Play All Tracks'}
        >
          {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>

        <button
          onClick={onStop}
          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition active:scale-95"
          title="Stop & Rewind"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>

        <div className="font-mono text-xs bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-1.5">
          <span className="text-cyan-400 font-bold">{formatTime(currentTime)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Mode, Display Preferences & Theme */}
      <div className="flex items-center gap-2">
        {extra}
        <div className="flex items-center gap-0.5 bg-slate-950/60 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => onSetAppMode('practice')}
            className={`px-2 py-1 rounded transition ${appMode === 'practice' ? 'bg-cyan-900 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
            title="Sing along with the uploaded tracks"
          >
            Practice
          </button>
          <button
            onClick={() => onSetAppMode('training')}
            aria-pressed={appMode === 'training'}
            className={`px-2 py-1 rounded transition ${appMode === 'training' ? 'bg-cyan-900 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
            title="Sing the silent reference part with the other voices"
          >
            Training
          </button>
          <button
            onClick={() => onSetAppMode('tuner')}
            className={`flex items-center gap-1 px-2 py-1 rounded transition ${appMode === 'tuner' ? 'bg-cyan-900 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
            title="Tuner: shows the nearest note and how far you are from it - no reference track needed"
          >
            <Activity className="w-3.5 h-3.5" />
            Tuner
          </button>
        </div>

        {/* Note Grid Label Mode */}
        <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800 text-xs">
          <span className="text-slate-400 px-1 text-[11px] font-medium">Labels:</span>
          <button
            onClick={() => onSelectNoteLabelMode('cs_only')}
            className={`px-2 py-1 rounded transition text-xs ${
              noteLabelMode === 'cs_only' ? 'bg-cyan-900 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cs Only
          </button>
          <button
            onClick={() => onSelectNoteLabelMode('flats_only')}
            className={`px-2 py-1 rounded transition text-xs ${
              noteLabelMode === 'flats_only' ? 'bg-cyan-900 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Flats
          </button>
          <button
            onClick={() => onSelectNoteLabelMode('all_notes')}
            className={`px-2 py-1 rounded transition text-xs ${
              noteLabelMode === 'all_notes' ? 'bg-cyan-900 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All
          </button>

          {/* Enharmonic Switch */}
          <button
            onClick={onToggleEnharmonic}
            className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[11px]"
            title="Toggle Sharps / Flats"
          >
            {enharmonic === 'flat' ? '♭' : '♯'}
          </button>
        </div>

        {/* Theme Selector */}
        <div className="flex items-center gap-1.5 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800">
          <Palette className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={theme}
            onChange={(e) => onSelectTheme(e.target.value as ThemeId)}
            className="bg-transparent text-xs text-slate-300 outline-none cursor-pointer"
          >
            {Object.values(THEMES).map((t) => (
              <option key={t.id} value={t.id} className="bg-slate-900">
                {t.name}
              </option>
            ))}
          </select>
        </div>

      </div>
    </header>
  );
};
