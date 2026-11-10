import { AudioTrackState, DEFAULT_TRACK_COLORS } from './MultiTrackMixer';

export { MAX_TRACKS } from '../score/types';
export const INITIAL_TRACKS = 6;
export function emptyTrack(index: number): AudioTrackState {
  return { id: `track-${index}`, index, name: `Track ${index + 1}`, audioBuffer: null, pitchFrames: [],
    volume: 0.85, muted: false, solo: false, visible: true,
    color: DEFAULT_TRACK_COLORS[index] ?? `#${[0, 1, 2].map(c => Math.round(150 + 85 * Math.sin(index * 2.4 + c * 2.1)).toString(16).padStart(2, '0')).join('')}`,
    isMain: index === 0, isAnalyzing: false, analysisProgress: 0, duration: 0 };
}
/** Visibility never affects audio. Training overrides the view without changing practice settings. */
export function visibleDiagramTracks(tracks: AudioTrackState[], training: boolean, targetIndex: number | null) {
  return tracks.filter(t => training ? t.index === targetIndex : t.visible !== false)
    .map(t => training && t.visible === false ? { ...t, visible: true } : t);
}
