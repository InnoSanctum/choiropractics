import React, { useRef, useEffect, useState } from 'react';
import { NoteGridRenderer, RendererOptions, NOTE_AXIS_WIDTH, MicTake } from '../visualizer/NoteGridRenderer';
import { AudioTrackState } from '../audio/MultiTrackMixer';
import { dragTrackOffset, trackOffset } from '../audio/TrackTiming';

export interface VisualizerCanvasProps {
  tracks: AudioTrackState[];
  takes: MicTake[];
  options: RendererOptions;
  /**
   * Live mode (tuner): performance.now() timestamp of t=0. The view scrolls with the clock
   * every animation frame and timeline interactions are disabled.
   */
  liveClockStart?: number | null;
  onSeek: (timeSeconds: number) => void;
  /** Scroll the view horizontally by a number of seconds (positive = later). */
  onScrollBy?: (deltaSeconds: number) => void;
  /** Zoom by a factor (>1 = zoom in) keeping `anchorTime` at the same screen position. */
  onZoomAt?: (factor: number, anchorTime: number) => void;
  aligningTrackIndex?: number | null;
  onMoveTrack?: (index: number, offset: number, commit: boolean) => void;
  moveSnapSeconds?: number;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  tracks,
  takes,
  options,
  liveClockStart,
  onSeek,
  onScrollBy,
  onZoomAt,
  aligningTrackIndex = null,
  onMoveTrack,
  moveSnapSeconds = 0
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<NoteGridRenderer | null>(null);

  // Latest props for the render loop and native event handlers (avoids re-subscribing every frame)
  const latest = useRef({ tracks, takes, options, liveClockStart, onSeek, onScrollBy, onZoomAt, aligningTrackIndex, onMoveTrack, moveSnapSeconds });
  latest.current = { tracks, takes, options, liveClockStart, onSeek, onScrollBy, onZoomAt, aligningTrackIndex, onMoveTrack, moveSnapSeconds };

  const [dragMode, setDragMode] = useState<'none' | 'seek' | 'pan' | 'move'>('none');
  const offsetDrag = useRef<{ pointerId: number; index: number; startX: number; startOffset: number; lastOffset: number; secondsPerPixel: number; snap: number } | null>(null);
  const lastMouseXRef = useRef<number>(0);

  // Initialize renderer
  useEffect(() => {
    if (canvasRef.current) {
      rendererRef.current = new NoteGridRenderer(canvasRef.current);
    }
  }, []);

  // Handle Resize with DPI scaling
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    handleResize();

    return () => observer.disconnect();
  }, []);

  // Render loop (single long-lived rAF loop reading the latest props)
  useEffect(() => {
    let animId: number;
    const renderLoop = () => {
      const { tracks: t, takes: m, liveClockStart: live } = latest.current;
      let o = latest.current.options;
      if (live != null) {
        // Scroll with the live clock: "now" sits at 85% of the width
        const now = (performance.now() - live) / 1000;
        o = { ...o, currentTime: now, timeOffset: now - o.visibleDuration * 0.85 };
      }
      if (rendererRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          rendererRef.current.render(t, m, o, rect.width, rect.height);
        }
      }
      animId = requestAnimationFrame(renderLoop);
    };
    renderLoop();
    return () => cancelAnimationFrame(animId);
  }, []);

  // Converts a client X coordinate into a timeline position
  const clientXToTime = (clientX: number) => {
    const canvas = canvasRef.current;
    const { options: o } = latest.current;
    if (!canvas) return o.timeOffset;
    const rect = canvas.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - NOTE_AXIS_WIDTH);
    const x = Math.max(NOTE_AXIS_WIDTH, Math.min(rect.width, clientX - rect.left));
    return o.timeOffset + ((x - NOTE_AXIS_WIDTH) / plotWidth) * o.visibleDuration;
  };

  // Non-passive wheel handler: Ctrl/⌘ + wheel or trackpad pinch = zoom, wheel = horizontal scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      const { options: o, onZoomAt: zoomAt, onScrollBy: scrollBy, liveClockStart: live } = latest.current;
      e.preventDefault();
      if (live != null) return;

      // Normalize delta to pixels
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;

      if (e.ctrlKey || e.metaKey) {
        if (!zoomAt) return;
        const factor = Math.exp(-e.deltaY * unit * 0.0025);
        zoomAt(factor, clientXToTime(e.clientX));
        return;
      }

      if (!scrollBy) return;
      const plotWidth = Math.max(1, canvas.clientWidth - NOTE_AXIS_WIDTH);
      const deltaPx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      scrollBy(((deltaPx * unit) / plotWidth) * o.visibleDuration);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // ---- Touch: tap = seek, one-finger drag = pan, two-finger pinch = zoom (+ pan) ----
  const touchPoints = useRef(new Map<number, number>()); // pointerId -> clientX
  const touchGesture = useRef<{ mode: 'tap' | 'pan' | 'pinch'; startX: number; lastX: number; lastDist: number; lastMid: number }>(
    { mode: 'tap', startX: 0, lastX: 0, lastDist: 0, lastMid: 0 }
  );
  const TAP_SLOP = 8; // px a finger may move and still count as a tap

  const plotWidthPx = () => Math.max(1, (canvasRef.current?.clientWidth ?? 1) - NOTE_AXIS_WIDTH);
  const pinchState = () => {
    const xs = [...touchPoints.current.values()];
    return { dist: Math.max(1, Math.abs(xs[0] - xs[1])), mid: (xs[0] + xs[1]) / 2 };
  };

  const handleTouchDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    touchPoints.current.set(e.pointerId, e.clientX);
    const g = touchGesture.current;
    if (touchPoints.current.size === 1) {
      Object.assign(g, { mode: 'tap', startX: e.clientX, lastX: e.clientX });
    } else if (touchPoints.current.size === 2) {
      const { dist, mid } = pinchState();
      Object.assign(g, { mode: 'pinch', lastDist: dist, lastMid: mid });
    }
  };

  const handleTouchMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!touchPoints.current.has(e.pointerId)) return;
    touchPoints.current.set(e.pointerId, e.clientX);
    const g = touchGesture.current;
    const visible = latest.current.options.visibleDuration;

    if (g.mode === 'pinch' && touchPoints.current.size >= 2) {
      const { dist, mid } = pinchState();
      // Horizontal pinch zooms the timeline around the fingers; moving both fingers pans
      onZoomAt?.(dist / g.lastDist, clientXToTime(mid));
      onScrollBy?.(-((mid - g.lastMid) / plotWidthPx()) * visible);
      g.lastDist = dist;
      g.lastMid = mid;
      return;
    }
    if (g.mode === 'tap' && Math.abs(e.clientX - g.startX) > TAP_SLOP) {
      g.mode = 'pan';
    }
    if (g.mode === 'pan') {
      onScrollBy?.(-((e.clientX - g.lastX) / plotWidthPx()) * visible);
    }
    g.lastX = e.clientX;
  };

  const handleTouchUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = touchGesture.current;
    if (g.mode === 'tap' && touchPoints.current.size === 1 && e.type === 'pointerup') {
      onSeek(Math.max(0, clientXToTime(e.clientX)));
    }
    touchPoints.current.delete(e.pointerId);
    if (touchPoints.current.size === 1) {
      // One finger left after a pinch: continue as a pan from its position (no jump)
      const x = [...touchPoints.current.values()][0];
      Object.assign(g, { mode: 'pan', lastX: x, startX: x });
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer was not captured
    }
  };

  // Mouse/pen: left-drag = seek/scrub, middle-drag / Alt+drag / Shift+drag = pan
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || liveClockStart != null) return;
    const current = latest.current;
    const moving = current.tracks.find(t => t.index === current.aligningTrackIndex && t.audioBuffer);
    if (moving && current.onMoveTrack && !e.altKey && !e.shiftKey && e.button !== 1 && e.clientX - canvas.getBoundingClientRect().left >= NOTE_AXIS_WIDTH) {
      if (offsetDrag.current) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      const offset = trackOffset(moving);
      offsetDrag.current = { pointerId: e.pointerId, index: moving.index, startX: e.clientX, startOffset: offset, lastOffset: offset,
        secondsPerPixel: current.options.visibleDuration / plotWidthPx(), snap: current.moveSnapSeconds };
      setDragMode('move'); return;
    }
    if (e.pointerType === 'touch') {
      handleTouchDown(e);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    lastMouseXRef.current = e.clientX;

    if (e.button === 1 || e.altKey || e.shiftKey) {
      e.preventDefault();
      setDragMode('pan');
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (e.clientX - rect.left < NOTE_AXIS_WIDTH) {
      // Dragging on the note axis pans as well
      setDragMode('pan');
      return;
    }

    setDragMode('seek');
    onSeek(Math.max(0, clientXToTime(e.clientX)));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const moving = offsetDrag.current;
    if (moving) {
      if (moving.pointerId === e.pointerId) {
        moving.lastOffset = dragTrackOffset(moving.startOffset, e.clientX - moving.startX, moving.secondsPerPixel, moving.snap);
        latest.current.onMoveTrack?.(moving.index, moving.lastOffset, false);
      }
      return;
    }
    if (e.pointerType === 'touch') {
      handleTouchMove(e);
      return;
    }
    if (dragMode === 'none') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragMode === 'pan') {
      const dx = e.clientX - lastMouseXRef.current;
      lastMouseXRef.current = e.clientX;
      const plotWidth = Math.max(1, canvas.clientWidth - NOTE_AXIS_WIDTH);
      onScrollBy?.(-(dx / plotWidth) * options.visibleDuration);
    } else {
      onSeek(Math.max(0, clientXToTime(e.clientX)));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const moving = offsetDrag.current;
    if (moving && moving.pointerId === e.pointerId) {
      offsetDrag.current = null;
      latest.current.onMoveTrack?.(moving.index, e.type === 'pointercancel' ? moving.startOffset : moving.lastOffset, true);
      setDragMode('none');
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* Already released. */ }
      return;
    }
    if (e.pointerType === 'touch') {
      handleTouchUp(e);
      return;
    }
    setDragMode('none');
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer was not captured
    }
  };

  const aligningTrack = tracks.find(t => t.index === aligningTrackIndex);
  const entryFraction = aligningTrack ? (trackOffset(aligningTrack) - options.timeOffset) / options.visibleDuration : -1;
  return (
    <div ref={containerRef} data-diagram className="flex-1 w-full h-full relative overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={e => {
          const moving = offsetDrag.current;
          if (moving?.pointerId === e.pointerId) {
            offsetDrag.current = null; setDragMode('none');
            latest.current.onMoveTrack?.(moving.index, moving.lastOffset, true);
          }
        }}
        onAuxClick={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
        className={`w-full h-full block ${dragMode === 'pan' ? 'cursor-grabbing' : aligningTrack ? 'cursor-ew-resize' : 'cursor-crosshair'}`}
        title={aligningTrack ? `Drag to move ${aligningTrack.name}. Alt/Shift/middle-drag to pan.` : 'Click/drag: seek · Wheel: scroll · Ctrl+Wheel / pinch: zoom · Shift/Alt/middle-drag: pan'}
      />
      {aligningTrack && entryFraction >= 0 && entryFraction <= 1 && <div className="absolute inset-y-0 right-0 pointer-events-none overflow-hidden" style={{ left: NOTE_AXIS_WIDTH }}>
        <div className="absolute inset-y-0 border-l border-dashed" style={{ left: `${entryFraction * 100}%`, borderColor: aligningTrack.color }}>
          <span className="absolute top-5 left-1 text-[10px] font-mono whitespace-nowrap px-1 rounded bg-slate-950/80" style={{ color: aligningTrack.color }}>{aligningTrack.name} · {trackOffset(aligningTrack)}s</span>
        </div>
      </div>}
    </div>
  );
};
