import React, { useRef, useEffect, useState } from 'react';
import { NoteGridRenderer, RendererOptions, NOTE_AXIS_WIDTH } from '../visualizer/NoteGridRenderer';
import { AudioTrackState } from '../audio/MultiTrackMixer';
import { PitchFrame } from '../audio/PraatPitchEngine';

interface VisualizerCanvasProps {
  tracks: AudioTrackState[];
  micHistory: PitchFrame[];
  options: RendererOptions;
  onSeek: (timeSeconds: number) => void;
  /** Scroll the view horizontally by a number of seconds (positive = later). */
  onScrollBy?: (deltaSeconds: number) => void;
  /** Zoom by a factor (>1 = zoom in) keeping `anchorTime` at the same screen position. */
  onZoomAt?: (factor: number, anchorTime: number) => void;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  tracks,
  micHistory,
  options,
  onSeek,
  onScrollBy,
  onZoomAt
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<NoteGridRenderer | null>(null);

  // Latest props for the render loop and native event handlers (avoids re-subscribing every frame)
  const latest = useRef({ tracks, micHistory, options, onSeek, onScrollBy, onZoomAt });
  latest.current = { tracks, micHistory, options, onSeek, onScrollBy, onZoomAt };

  const [dragMode, setDragMode] = useState<'none' | 'seek' | 'pan'>('none');
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
      const { tracks: t, micHistory: m, options: o } = latest.current;
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
      const { options: o, onZoomAt: zoomAt, onScrollBy: scrollBy } = latest.current;
      e.preventDefault();

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

  // Pointer interactions: left-drag = seek/scrub, middle-drag / Alt+drag / Shift+drag = pan
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    setDragMode('none');
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer was not captured
    }
  };

  return (
    <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onAuxClick={(e) => e.preventDefault()}
        className={`w-full h-full block ${dragMode === 'pan' ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        title="Click/drag: seek · Wheel: scroll · Ctrl+Wheel / pinch: zoom · Shift/Alt/middle-drag: pan"
      />
    </div>
  );
};
