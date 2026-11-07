import React, { useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, LocateFixed } from 'lucide-react';
import { AudioTrackState } from '../audio/MultiTrackMixer';
import { NoteGridRenderer } from '../visualizer/NoteGridRenderer';

export interface TimelineScrollbarProps {
  duration: number;
  currentTime: number;
  timeOffset: number;
  visibleDuration: number;
  minVisibleDuration: number;
  tracks: AudioTrackState[];
  autoFollow: boolean;
  /** Move the view so it starts at `offset` seconds. */
  onScrollTo: (offset: number) => void;
  /** Set both start and length of the view (used by the resize handles). */
  onSetView: (offset: number, visibleDuration: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleAutoFollow: () => void;
  onFitSong: () => void;
  /** Background colour of the theme (track colours are adjusted to stay visible on it) */
  themeBackground?: string;
}

type DragAction = 'thumb' | 'left-handle' | 'right-handle';

const formatSec = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const TimelineScrollbar: React.FC<TimelineScrollbarProps> = ({
  duration,
  currentTime,
  timeOffset,
  visibleDuration,
  minVisibleDuration,
  tracks,
  autoFollow,
  onScrollTo,
  onSetView,
  onZoomIn,
  onZoomOut,
  onToggleAutoFollow,
  onFitSong,
  themeBackground = '#0b111e'
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragAction, setDragAction] = useState<DragAction | null>(null);
  const dragStart = useRef({ x: 0, offset: 0, visible: 0 });

  const totalDuration = Math.max(visibleDuration, duration, 1);
  const thumbLeftPct = (Math.max(0, timeOffset) / totalDuration) * 100;
  const thumbWidthPct = Math.max(1.5, Math.min(100 - thumbLeftPct, (visibleDuration / totalDuration) * 100));
  const playheadPct = Math.min(100, Math.max(0, (currentTime / totalDuration) * 100));

  // Minimap of all note segments (memoized: only rebuilt when tracks or the time scale change)
  const minimap = useMemo(() => {
    const visibleTracks = tracks.filter(t => !t.muted && t.pitchFrames.length > 0);
    if (visibleTracks.length === 0) return null;

    const all = visibleTracks.map(t => ({ track: t, segments: NoteGridRenderer.getSegments(t.pitchFrames) }));
    let lo = Infinity;
    let hi = -Infinity;
    for (const { segments } of all) {
      for (const s of segments) {
        lo = Math.min(lo, s.medianMidi);
        hi = Math.max(hi, s.medianMidi);
      }
    }
    if (!isFinite(lo)) return null;
    const span = Math.max(6, hi - lo);

    return (
      <div className="absolute inset-x-0 top-1 bottom-1 pointer-events-none">
        {all.map(({ track, segments }) =>
          segments.map(s => (
            <div
              key={`${track.id}-${s.id}`}
              style={{
                position: 'absolute',
                left: `${(s.startTime / totalDuration) * 100}%`,
                width: `max(1px, ${((s.endTime - s.startTime) / totalDuration) * 100}%)`,
                top: `${(1 - (s.medianMidi - lo) / span) * 80 + 5}%`,
                height: '2px',
                borderRadius: '1px',
                backgroundColor: NoteGridRenderer.readable(track.color, themeBackground),
                opacity: 0.75
              }}
            />
          ))
        )}
      </div>
    );
  }, [tracks, totalDuration, themeBackground]);

  // Time tick labels
  const ticks = useMemo(() => {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => totalDuration / s <= 10) ?? 600;
    const result: number[] = [];
    for (let t = step; t < totalDuration - step * 0.3; t += step) result.push(t);
    return result;
  }, [totalDuration]);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>, action: DragAction) => {
    e.stopPropagation();
    e.preventDefault();
    trackRef.current?.setPointerCapture(e.pointerId);
    setDragAction(action);
    dragStart.current = { x: e.clientX, offset: timeOffset, visible: visibleDuration };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragAction || !trackRef.current) return;
    const trackWidth = trackRef.current.clientWidth;
    if (trackWidth <= 0) return;

    const dt = ((e.clientX - dragStart.current.x) / trackWidth) * totalDuration;
    const { offset, visible } = dragStart.current;

    if (dragAction === 'thumb') {
      onScrollTo(offset + dt);
    } else if (dragAction === 'right-handle') {
      onSetView(offset, Math.max(minVisibleDuration, visible + dt));
    } else {
      // Left handle: keep the right edge fixed
      const rightEdge = offset + visible;
      const newOffset = Math.max(0, Math.min(rightEdge - minVisibleDuration, offset + dt));
      onSetView(newOffset, rightEdge - newOffset);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragAction) return;
    setDragAction(null);
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer was not captured
    }
  };

  // Click on the empty track centres the view there, then allows dragging
  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clickTime = ((e.clientX - rect.left) / rect.width) * totalDuration;
    const newOffset = clickTime - visibleDuration / 2;
    onScrollTo(newOffset);
    trackRef.current.setPointerCapture(e.pointerId);
    setDragAction('thumb');
    dragStart.current = { x: e.clientX, offset: Math.max(0, newOffset), visible: visibleDuration };
  };

  const isFullView = visibleDuration >= duration - 0.01;

  return (
    <div className="h-11 bg-slate-950/95 border-t border-slate-800 flex items-center px-2 select-none gap-2 z-10">
      {/* Fit & follow (aligned with the note axis) */}
      <div className="w-[48px] flex items-center justify-between text-slate-400 shrink-0">
        <button
          onClick={onFitSong}
          className="p-1 rounded hover:bg-slate-800 hover:text-cyan-400 text-slate-400 transition"
          title="Fit entire song (0)"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onToggleAutoFollow}
          className={`p-1 rounded transition ${autoFollow ? 'bg-cyan-950 text-cyan-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          title={autoFollow ? 'Follow playhead: ON (F)' : 'Follow playhead: OFF (F)'}
        >
          <LocateFixed className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollbar track with song overview */}
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
        className="flex-1 h-8 bg-slate-900/80 rounded-md border border-slate-800/80 relative cursor-pointer overflow-hidden"
        title="Drag the window to scroll · drag its edges to zoom · click to jump"
      >
        {/* Time ticks */}
        <div className="absolute inset-0 pointer-events-none text-[9px] font-mono text-slate-600">
          {ticks.map(t => (
            <span
              key={t}
              className="absolute bottom-0 -translate-x-1/2 leading-none pb-0.5"
              style={{ left: `${(t / totalDuration) * 100}%` }}
            >
              {formatSec(t)}
            </span>
          ))}
        </div>

        {minimap}

        {/* Playhead */}
        <div
          style={{ left: `${playheadPct}%` }}
          className="absolute top-0 bottom-0 w-px bg-sky-400 z-10 pointer-events-none"
        />

        {/* Viewport window */}
        {!isFullView && (
          <div
            onPointerDown={(e) => handleDragStart(e, 'thumb')}
            style={{ left: `${thumbLeftPct}%`, width: `${thumbWidthPct}%` }}
            className={`absolute top-0 bottom-0 border rounded z-20 flex items-stretch justify-between cursor-grab active:cursor-grabbing transition-colors ${
              dragAction ? 'bg-cyan-400/25 border-cyan-300' : 'bg-cyan-500/15 hover:bg-cyan-500/25 border-cyan-400/60'
            }`}
          >
            <div
              onPointerDown={(e) => handleDragStart(e, 'left-handle')}
              className="w-2 cursor-ew-resize hover:bg-cyan-400/40 flex items-center justify-center rounded-l"
              title="Drag to zoom"
            >
              <div className="w-0.5 h-3 bg-cyan-300/80 rounded" />
            </div>
            <div
              onPointerDown={(e) => handleDragStart(e, 'right-handle')}
              className="w-2 cursor-ew-resize hover:bg-cyan-400/40 flex items-center justify-center rounded-r"
              title="Drag to zoom"
            >
              <div className="w-0.5 h-3 bg-cyan-300/80 rounded" />
            </div>
          </div>
        )}
      </div>

      {/* Zoom buttons & readout */}
      <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-1 rounded-lg border border-slate-800 text-xs text-slate-400 shrink-0">
        <button
          onClick={onZoomOut}
          className="p-1 hover:text-white transition rounded hover:bg-slate-800"
          title="Zoom out (−)"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono text-[11px] text-slate-300 w-12 text-center" title="Visible time span">
          {visibleDuration >= 10 ? visibleDuration.toFixed(0) : visibleDuration.toFixed(1)}s
        </span>
        <button
          onClick={onZoomIn}
          className="p-1 hover:text-white transition rounded hover:bg-slate-800"
          title="Zoom in (+)"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
