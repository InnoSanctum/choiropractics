import { AudioTrackState } from '../audio/MultiTrackMixer';
import { emptyTrack, MAX_TRACKS, INITIAL_TRACKS } from '../audio/TrackState';
import { PitchFrame } from '../audio/PraatPitchEngine';
import { LibraryPart, LibrarySong, fetchLibraryBytes } from './catalogue';

export interface CachedLibraryPart { key: string; blob: Blob; frames: PitchFrame[]; updatedAt: number }
export interface LibraryLoadProgress { fraction: number; message: string }
export interface PreparedLibrarySong { tracks: AudioTrackState[]; blobs: Blob[]; song: LibrarySong }
export interface LibraryLoader {
  analysisKey: string;
  decode: (blob: Blob) => Promise<AudioBuffer>;
  analyze: (audio: AudioBuffer, part: LibraryPart, signal: AbortSignal, progress: (fraction: number) => void) => Promise<PitchFrame[]>;
  getCached: (key: string) => Promise<CachedLibraryPart | undefined>;
  cache: (part: CachedLibraryPart) => Promise<void>;
}

/** Prepare every part before replacing a rehearsal. Cancel/failure never installs partial tracks. */
export async function prepareLibrarySong(song: LibrarySong, partIds: string[], loader: LibraryLoader, signal: AbortSignal,
  progress: (progress: LibraryLoadProgress) => void): Promise<PreparedLibrarySong> {
  const ids = new Set(partIds);
  const parts = song.parts.filter(p => ids.has(p.id));
  if (!ids.size) throw new Error('Select at least one recording to load.');
  if (parts.length !== ids.size) throw new Error('The selected recording is no longer available in the catalogue.');
  if (parts.length > MAX_TRACKS) throw new Error(`Select at most ${MAX_TRACKS} recordings.`);
  const tracks: AudioTrackState[] = [], blobs: Blob[] = [];
  let samples = 0;
  for (const [i, part] of parts.entries()) {
    signal.throwIfAborted();
    const report = (fraction: number, stage: string) => progress({ fraction: (i + fraction) / parts.length * 0.95, message: `${stage} ${part.label} (${i + 1}/${parts.length})` });
    const key = `${loader.analysisKey}|${part.voice}|${part.duration ?? ''}|${part.url}`;
    let cached: CachedLibraryPart | undefined;
    try { cached = await loader.getCached(key); } catch { /* Network loading still works if the cache cannot be read. */ }
    signal.throwIfAborted();
    report(0, cached ? 'Opening saved' : 'Downloading');
    let blob: Blob;
    if (cached) blob = cached.blob;
    else {
      try {
        const { bytes, type } = await fetchLibraryBytes(part.url, signal, 32_000_000, f => report(f * 0.2, 'Downloading'));
        blob = new Blob([bytes], { type });
      } catch (e) { signal.throwIfAborted(); throw new Error(`${part.label}: ${(e as Error).message}`); }
    }
    signal.throwIfAborted();
    report(0.22, 'Opening');
    let audioBuffer: AudioBuffer;
    try { audioBuffer = await loader.decode(blob); }
    catch { signal.throwIfAborted(); throw new Error(`Could not decode the recording for ${part.label}. Your existing tracks have been kept.`); }
    signal.throwIfAborted();
    samples += audioBuffer.length * audioBuffer.numberOfChannels;
    if (samples > 64_000_000) throw new Error('The selected recordings need too much audio memory. Select fewer parts.');
    const audioOnly = part.isMix || part.isAccompaniment;
    const frames = audioOnly ? [] : cached?.frames ?? await loader.analyze(audioBuffer, part, signal, f => report(0.25 + f * 0.7, 'Analyzing'));
    signal.throwIfAborted();
    const state = { ...emptyTrack(i), name: part.label, audioBuffer, pitchFrames: frames, duration: audioBuffer.duration,
      source: 'audio' as const, isMain: false, isPolyphonic: !!audioOnly, muted: part.isMix && parts.some(p => !p.isMix && !p.isAccompaniment), visible: !audioOnly,
      librarySongId: song.id, librarySongTitle: song.title, libraryPartUrl: part.url };
    tracks.push(state); blobs.push(blob);
    if (!cached) {
      try { await loader.cache({ key, blob, frames, updatedAt: Date.now() }); } catch { /* Cache quota must not prevent loading a song. */ }
    }
    report(1, 'Ready');
  }
  const main = tracks.find(t => !t.isPolyphonic);
  while (tracks.length < INITIAL_TRACKS) tracks.push(emptyTrack(tracks.length));
  return { song, blobs, tracks: tracks.map(t => ({ ...t, isMain: t.index === main?.index })) };
}
