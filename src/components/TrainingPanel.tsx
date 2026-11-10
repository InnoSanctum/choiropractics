import React from 'react';
import { AudioTrackState } from '../audio/MultiTrackMixer';

export interface TrainingPanelProps {
  tracks: AudioTrackState[];
  targetIndex: number | null;
  onSelectTarget: (index: number) => void;
  isMicActive: boolean;
  onEnableMic: () => void;
  anyOctave: boolean;
  onToggleAnyOctave: () => void;
}

export const TrainingPanel: React.FC<TrainingPanelProps> = ({
  tracks, targetIndex, onSelectTarget, isMicActive, onEnableMic, anyOctave, onToggleAnyOctave
}) => {
  const loaded = tracks.filter(t => t.audioBuffer && !t.isPolyphonic);
  const target = loaded.find(t => t.index === targetIndex);
  return (
    <section aria-label="Training setup" className="mx-3 my-1.5 px-3 py-2 rounded-lg border border-indigo-500/40 bg-indigo-950/30 text-xs text-slate-300 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 font-semibold">
        Sing this part
        <select
          aria-label="Training part"
          value={targetIndex ?? ''}
          disabled={loaded.length === 0}
          onChange={e => onSelectTarget(Number(e.target.value))}
          className="min-w-0 max-w-48 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-indigo-200"
        >
          {loaded.length === 0 && <option value="">Upload a voice part</option>}
          {loaded.map(t => <option key={t.id} value={t.index}>{t.name}</option>)}
        </select>
      </label>
      <span className="flex-1 min-w-40" role="status">
        {!target ? tracks.some(t => t.isPolyphonic) ? 'Choose or import a single melody for training. Chord tracks can accompany you.' : 'Upload parts in Tracks to begin.'
          : target.isAnalyzing ? 'Analyzing the selected part…'
          : target.pitchFrames.some(f => f.voiced) ? 'Your part is silent. Follow its diagram and sing with the other voices.'
          : 'No melody detected in this part. Choose another recording.'}
      </span>
      <label className="flex items-center gap-1.5 whitespace-nowrap">
        <input type="checkbox" checked={anyOctave} onChange={onToggleAnyOctave} className="accent-indigo-400" />
        Any octave
      </label>
      {!isMicActive && (
        <button onClick={onEnableMic} className="rounded bg-rose-600 hover:bg-rose-500 px-3 py-1.5 font-semibold text-white">
          Enable microphone
        </button>
      )}
    </section>
  );
};
