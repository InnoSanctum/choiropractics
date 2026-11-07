import React, { useRef, useEffect } from 'react';
import { NoteGridRenderer, RendererOptions } from '../visualizer/NoteGridRenderer';
import { AudioTrackState } from '../audio/MultiTrackMixer';
import { PitchFrame } from '../audio/PraatPitchEngine';

interface VisualizerCanvasProps {
  tracks: AudioTrackState[];
  micHistory: PitchFrame[];
  options: RendererOptions;
  onSeek: (timeSeconds: number) => void;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  tracks,
  micHistory,
  options,
  onSeek
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<NoteGridRenderer | null>(null);

  // Initialize renderer
  useEffect(() => {
    if (canvasRef.current) {
      rendererRef.current = new NoteGridRenderer(canvasRef.current);
    }
  }, []);

  // Handle Resize and High-DPI Retina scaling
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }

      if (rendererRef.current) {
        // Pass virtual dimensions to renderer
        (canvas as any)._virtualWidth = rect.width;
        (canvas as any)._virtualHeight = rect.height;
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    handleResize();

    return () => observer.disconnect();
  }, []);

  // Continuous animation loop for rendering
  useEffect(() => {
    let animId: number;

    const renderLoop = () => {
      if (rendererRef.current && canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          // Temporarily set canvas dimension properties for renderer
          const originalW = canvas.width;
          const originalH = canvas.height;
          canvas.width = rect.width;
          canvas.height = rect.height;

          rendererRef.current.render(tracks, micHistory, options);

          // Restore native canvas pixel buffer
          canvas.width = originalW;
          canvas.height = originalH;
          const ctx = canvas.getContext('2d');
          const dpr = window.devicePixelRatio || 1;
          if (ctx) {
            ctx.scale(dpr, dpr);
          }
          rendererRef.current.render(tracks, micHistory, options);
        }
      }
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [tracks, micHistory, options]);

  // Handle click to seek timeline
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const axisWidth = 56;

    if (x >= axisWidth) {
      const plotWidth = rect.width - axisWidth;
      const relFraction = (x - axisWidth) / plotWidth;
      const seekTime = options.timeOffset + relFraction * options.visibleDuration;
      onSeek(Math.max(0, seekTime));
    }
  };

  return (
    <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        className="w-full h-full block cursor-crosshair"
      />
    </div>
  );
};
