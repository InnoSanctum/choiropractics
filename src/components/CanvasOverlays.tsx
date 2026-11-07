import React from 'react';

export interface CanvasOverlaysProps {
  /** Beats left in the count-in (0 = hidden) */
  countInLeft: number;
  /** Show the welcome card (no tracks loaded) */
  showWelcome: boolean;
  onLoadDemo: () => void;
  /** Text for where tracks are uploaded ("below" on desktop, "in the Tracks tab" on phones) */
  uploadHint: string;
}

/** Overlays drawn on top of the pitch diagram: count-in number and the welcome card. */
export const CanvasOverlays: React.FC<CanvasOverlaysProps> = ({ countInLeft, showWelcome, onLoadDemo, uploadHint }) => (
  <>
    {countInLeft > 0 && (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-7xl font-black font-mono text-cyan-300/80 drop-shadow-lg">{countInLeft}</div>
      </div>
    )}

    {showWelcome && (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4">
        <div className="bg-slate-900/90 border border-slate-700/80 p-5 rounded-2xl shadow-2xl backdrop-blur max-w-sm text-center pointer-events-auto">
          <h3 className="font-bold text-sm text-white mb-1">Welcome to Praat Vocal Studio</h3>
          <p className="text-xs text-slate-400 mb-4">
            Upload audio files {uploadHint}, try the instant demo, or switch to Tuner mode to sing freely.
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={onLoadDemo}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg transition active:scale-95"
            >
              Load Demo Reference
            </button>
          </div>
        </div>
      </div>
    )}
  </>
);
