import React, { useEffect, useState } from 'react';
import {
  Play, Pause, Square, Mic, MicOff, Activity, ListMusic, Music, Gauge, Settings, X, Trash2, Headphones
} from 'lucide-react';
import { TopBarProps } from '../TopBar';
import { CoachingHUDProps, PrecisionSlider } from '../CoachingHUD';
import { HarmonyPanel, HarmonyPanelProps } from '../HarmonyPanel';
import { PracticePanel, PracticePanelProps } from '../PracticePanel';
import { TunerPanel, TunerPanelProps } from '../TunerPanel';
import { VisualizerCanvas, VisualizerCanvasProps } from '../VisualizerCanvas';
import { TimelineScrollbar, TimelineScrollbarProps } from '../TimelineScrollbar';
import { TrackListProps } from '../TrackList';
import { CanvasOverlays, CanvasOverlaysProps } from '../CanvasOverlays';
import { MobileHUD } from './MobileHUD';
import { ReviewControlsEmbedded, ReviewControlsProps } from '../ReviewControls';
import { MobileTrackList } from './MobileTrackList';
import { THEMES, ThemeId } from '../../visualizer/ThemeManager';
import { useIsShortScreen } from '../../hooks/useIsMobile';

export interface MobileLayoutProps {
  topBar: TopBarProps;
  hud: CoachingHUDProps;
  harmony: HarmonyPanelProps;
  practice: PracticePanelProps;
  tuner: TunerPanelProps;
  visualizer: VisualizerCanvasProps;
  timeline: TimelineScrollbarProps;
  trackList: TrackListProps;
  overlays: Omit<CanvasOverlaysProps, 'uploadHint'>;
  review: ReviewControlsProps;
}

type SheetId = 'tracks' | 'harmony' | 'practice' | 'settings' | null;

const formatTime = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const HEADPHONES_KEY = 'choiro.headphonesTipDismissed';

/**
 * Phone layout: the pitch diagram fills the screen; settings live in bottom sheets.
 */
export const MobileLayout: React.FC<MobileLayoutProps> = ({
  topBar,
  hud,
  harmony,
  practice,
  tuner,
  visualizer,
  timeline,
  trackList,
  overlays,
  review
}) => {
  const [sheet, setSheet] = useState<SheetId>(null);
  const short = useIsShortScreen();
  const isTuner = topBar.appMode === 'tuner';
  const loadedCount = trackList.tracks.filter(t => t.audioBuffer).length;

  // Headphones tip: the phone mic would otherwise pick up the backing track from the speaker
  const [tipDismissed, setTipDismissed] = useState(() => {
    try { return localStorage.getItem(HEADPHONES_KEY) === '1'; } catch { return false; }
  });
  const showHeadphonesTip = !tipDismissed && topBar.isMicActive && !isTuner && loadedCount > 0;
  const dismissTip = () => {
    setTipDismissed(true);
    try { localStorage.setItem(HEADPHONES_KEY, '1'); } catch { /* storage unavailable */ }
  };

  // Close a sheet that does not exist in the current mode
  useEffect(() => {
    if (isTuner && (sheet === 'harmony' || sheet === 'practice' || sheet === 'tracks')) setSheet(null);
  }, [isTuner, sheet]);

  const tabs: { id: Exclude<SheetId, null>; label: string; icon: React.ReactNode; badge?: number }[] = isTuner
    ? [{ id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> }]
    : [
      { id: 'tracks', label: 'Tracks', icon: <ListMusic className="w-5 h-5" />, badge: loadedCount || undefined },
      { id: 'harmony', label: 'Harmony', icon: <Music className="w-5 h-5" /> },
      { id: 'practice', label: 'Tempo', icon: <Gauge className="w-5 h-5" /> },
      { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> }
    ];

  const sheetTitle: Record<Exclude<SheetId, null>, string> = {
    tracks: 'Tracks',
    harmony: 'Harmony & intervals',
    practice: 'Speed, metronome & count-in',
    settings: isTuner ? 'Tuner & display' : 'Microphone & display'
  };

  const segBtn = (active: boolean) =>
    `px-2.5 h-8 rounded-md text-xs font-semibold flex items-center gap-1 ${active ? 'bg-cyan-900 text-cyan-200' : 'text-slate-400'}`;

  return (
    <div className="touch-ui flex flex-col h-[100dvh] w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans select-none">
      {/* Header: mode, time, mic, transport */}
      <header className={`flex items-center gap-2 px-2 ${short ? 'h-11' : 'h-14'} shrink-0 border-b border-slate-800 bg-slate-900/90 pt-[env(safe-area-inset-top)]`}>
        <div className="flex bg-slate-950/70 p-0.5 rounded-lg border border-slate-800">
          <button className={segBtn(!isTuner)} onClick={() => topBar.onSetAppMode('practice')}>Practice</button>
          <button className={segBtn(isTuner)} onClick={() => topBar.onSetAppMode('tuner')}>
            <Activity className="w-3.5 h-3.5" />Tuner
          </button>
        </div>

        {!isTuner && (
          <div className="font-mono text-[11px] text-slate-400 ml-auto tabular-nums">
            <span className="text-cyan-300 font-bold">{formatTime(topBar.currentTime)}</span>
            <span className="text-slate-600"> / </span>
            {formatTime(topBar.duration)}
          </div>
        )}

        <div className={`flex items-center gap-1.5 ${isTuner ? 'ml-auto' : ''}`}>
          <button
            onClick={topBar.onToggleMic}
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              topBar.isMicActive ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
            aria-label={topBar.isMicActive ? 'Turn microphone off' : 'Turn microphone on'}
          >
            {topBar.isMicActive ? <Mic className="w-4.5 h-4.5" /> : <MicOff className="w-4.5 h-4.5" />}
          </button>
          {!isTuner && (
            <>
              <button
                onClick={topBar.onStop}
                className="w-10 h-10 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center"
                aria-label="Stop and rewind"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
              <button
                onClick={topBar.onPlayPause}
                className="w-11 h-11 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center shadow-lg shadow-cyan-500/20 active:scale-95"
                aria-label={topBar.isPlaying ? 'Pause' : 'Play'}
              >
                {topBar.isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
            </>
          )}
        </div>
      </header>

      <MobileHUD {...hud} compact={short} />

      {showHeadphonesTip && (
        <div className={`flex items-center gap-2 px-3 ${short ? 'py-0.5 text-[11px]' : 'py-2 text-xs'} bg-amber-950/70 border-b border-amber-700/50 text-amber-200`}>
          <Headphones className="w-4 h-4 shrink-0" />
          <span className="flex-1">Use headphones — otherwise the microphone hears the backing track from the speaker.</span>
          <button onClick={dismissTip} className="p-1" aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Diagram + sheets */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <VisualizerCanvas {...visualizer} />
        <CanvasOverlays {...overlays} showWelcome={overlays.showWelcome && sheet === null} uploadHint="in the Tracks tab" />

        {sheet && (
          <>
            <div className="absolute inset-0 bg-slate-950/50" onClick={() => setSheet(null)} />
            <section className="absolute inset-x-0 bottom-0 max-h-[75%] flex flex-col bg-slate-900 border-t border-slate-700 rounded-t-2xl shadow-2xl">
              <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
                <h2 className="text-sm font-bold text-slate-200">{sheetTitle[sheet]}</h2>
                <button onClick={() => setSheet(null)} className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 text-slate-300" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto overscroll-contain px-4 pb-4">
                {sheet === 'tracks' && <MobileTrackList {...trackList} />}
                {sheet === 'harmony' && <HarmonyPanel {...harmony} embedded />}
                {sheet === 'practice' && <PracticePanel {...practice} embedded />}
                {sheet === 'settings' && (
                  <div className="flex flex-col gap-4 text-sm">
                    {isTuner && <TunerPanel {...tuner} embedded />}

                    {hud.onPrecisionChange && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] uppercase font-bold text-slate-400">Pitch precision</span>
                        <PrecisionSlider value={hud.precisionCents ?? 10} onChange={hud.onPrecisionChange} large />
                        <span className="text-xs text-slate-500">
                          How close counts as in tune, and how finely the cents are shown. ±10 is relaxed, ±1 is strict.
                        </span>
                      </div>
                    )}

                    <ReviewControlsEmbedded {...review} />

                    {topBar.inputDevices.length > 0 && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] uppercase font-bold text-slate-400">Microphone</span>
                        <select
                          value={topBar.selectedDeviceId}
                          onChange={e => topBar.onSelectDevice(e.target.value)}
                          className="bg-slate-950 text-slate-200 rounded-lg px-2 border border-slate-800"
                        >
                          <option value="default">Default microphone</option>
                          {topBar.inputDevices.map(d => (
                            <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0, 5)}`}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {!isTuner && (
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 flex-1">
                          <input type="checkbox" checked={topBar.keepTakes} onChange={topBar.onToggleKeepTakes} className="w-5 h-5 accent-rose-500" />
                          <span>Keep takes <span className="text-slate-500 text-xs">(each pass in its own colour)</span></span>
                        </label>
                        <button
                          onClick={topBar.onClearTakes}
                          disabled={topBar.takeCount === 0}
                          className="flex items-center gap-1.5 px-3 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40"
                        >
                          <Trash2 className="w-4 h-4" />Clear{topBar.takeCount > 0 ? ` (${topBar.takeCount})` : ''}
                        </button>
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase font-bold text-slate-400">Note labels</span>
                      <div className="flex gap-1.5">
                        {([['cs_only', 'C only'], ['flats_only', 'C + accidentals'], ['all_notes', 'All']] as const).map(([id, label]) => (
                          <button
                            key={id}
                            onClick={() => topBar.onSelectNoteLabelMode(id)}
                            className={`px-3 rounded-lg ${topBar.noteLabelMode === id ? 'bg-cyan-900 text-cyan-200 font-semibold' : 'bg-slate-800 text-slate-400'}`}
                          >
                            {label}
                          </button>
                        ))}
                        <button onClick={topBar.onToggleEnharmonic} className="px-3 rounded-lg bg-slate-800 text-slate-200 font-mono" aria-label="Sharps or flats">
                          {topBar.enharmonic === 'flat' ? '♭' : '♯'}
                        </button>
                      </div>
                    </div>

                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase font-bold text-slate-400">Theme</span>
                      <select
                        value={topBar.theme}
                        onChange={e => topBar.onSelectTheme(e.target.value as ThemeId)}
                        className="bg-slate-950 text-slate-200 rounded-lg px-2 border border-slate-800"
                      >
                        {Object.values(THEMES).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>

                    <p className="text-xs text-slate-500 leading-relaxed">
                      Diagram: tap to move the playhead, drag to scroll, pinch to zoom. Use headphones when singing along.
                    </p>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {!isTuner && <TimelineScrollbar {...timeline} />}

      {/* Bottom tabs */}
      <nav className="flex shrink-0 border-t border-slate-800 bg-slate-900/95 pb-[env(safe-area-inset-bottom)]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSheet(s => (s === tab.id ? null : tab.id))}
            className={`flex-1 ${short ? 'h-10 flex-row gap-1.5 text-xs' : 'h-14 flex-col gap-0.5 text-[10px]'} flex items-center justify-center font-semibold relative ${
              sheet === tab.id ? 'text-cyan-300' : 'text-slate-400'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && (
              <span className={`${short ? '' : 'absolute top-1.5 left-1/2 ml-2'} min-w-4 h-4 px-1 rounded-full bg-cyan-600 text-white text-[9px] leading-4`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};
