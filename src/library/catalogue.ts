export const CATALOGUE_URL = 'https://papaya-truffle-25f879.netlify.app/songs.json';

export interface LibraryPart {
  id: string;
  voice: string;
  label: string;
  url: string;
  duration?: number;
  isMix: boolean;
  isAccompaniment?: boolean;
  variant?: 'voice-only' | 'instrumental';
  sourceUrl?: string;
}
export interface LibrarySong { id: string; title: string; subtitle: string; parts: LibraryPart[] }
export interface LibraryCatalogue { songs: LibrarySong[]; fetchedAt: number }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function parseCatalogue(data: unknown, baseUrl = CATALOGUE_URL): LibrarySong[] {
  if (!object(data) || !Array.isArray(data.songs)) throw new Error('The Library catalogue has an unsupported format.');
  if (data.songs.length > 2000) throw new Error('The Library catalogue contains too many songs.');
  const ids = new Set<string>();
  return data.songs.map((song, si) => {
    if (!object(song) || !nonempty(song.id) || !nonempty(song.title) || !Array.isArray(song.parts)) throw new Error(`Invalid song at catalogue position ${si + 1}.`);
    if (ids.has(song.id)) throw new Error(`Duplicate song identifier: ${song.id}`);
    ids.add(song.id);
    if (song.parts.length > 200) throw new Error(`Too many recordings in ${song.title}.`);
    const parts = song.parts.map((part, pi): LibraryPart => {
      if (!object(part) || !nonempty(part.url) || !nonempty(part.voice)) throw new Error(`Invalid recording in ${song.title}.`);
      const url = new URL(part.url, baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`Unsupported recording URL in ${song.title}.`);
      const voice = part.voice.trim().toLowerCase();
      const duration = part.duration_sec ?? part.duration;
      const source = part.source_url ?? part.sourceUrl;
      const sourceUrl = nonempty(source) ? new URL(source, baseUrl) : undefined;
      if (sourceUrl && (!['https:', 'http:'].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password)) throw new Error(`Unsupported source recording URL in ${song.title}.`);
      return { id: `${song.id}:${pi}`, voice, label: nonempty(part.label) ? part.label.trim() : voice,
        url: url.href, duration: typeof duration === 'number' && duration > 0 && Number.isFinite(duration) ? duration : undefined,
        isAccompaniment: voice === 'accompaniment' || part.role === 'accompaniment' || part.isAccompaniment === true,
        variant: part.variant === 'voice-only' || part.variant === 'instrumental' ? part.variant : undefined,
        sourceUrl: sourceUrl?.href,
        isMix: voice === 'all' || voice === 'men' };
    });
    return { id: song.id, title: song.title.trim(), subtitle: nonempty(song.subtitle) ? song.subtitle.trim() : '', parts };
  });
}

export const canTrainOnLibraryPart = (part: LibraryPart) => !part.isMix && !part.isAccompaniment;

/** Appended catalogues keep originals available while preferring their separated vocals. */
export function defaultLibraryParts(song: LibrarySong): LibraryPart[] {
  const separatedSources = new Set(song.parts.filter(p => p.variant === 'voice-only' && p.sourceUrl).map(p => p.sourceUrl));
  const preferred = song.parts.filter(p => !separatedSources.has(p.url));
  const voices = preferred.filter(canTrainOnLibraryPart);
  return voices.length ? [...voices, ...preferred.filter(p => p.isAccompaniment)] : preferred;
}

/** Bounds apply while streaming, including servers that omit Content-Length. */
export async function fetchLibraryBytes(url: string, signal: AbortSignal, limit: number, onProgress?: (value: number) => void, cache: RequestCache = 'default'): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('The Library request timed out. Please try again.')), 90_000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', mode: 'cors', cache });
    if (!response.ok) throw new Error(`The Library server returned HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length'));
    if (length > limit) throw new Error('This Library file is too large to load.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The Library server returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        controller.signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error('This Library file is too large to load.');
        chunks.push(value);
        if (length > 0) onProgress?.(Math.min(1, size / length));
      }
    } catch (e) { await reader.cancel().catch(() => {}); throw e; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    onProgress?.(1);
    return { bytes, type: response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg' };
  } catch (e) {
    signal.throwIfAborted();
    if (controller.signal.aborted) throw controller.signal.reason;
    if (e instanceof TypeError) throw new Error('Could not reach the Library. Check your connection and try again.');
    throw e;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}

export async function fetchCatalogue(signal: AbortSignal): Promise<LibraryCatalogue> {
  const { bytes } = await fetchLibraryBytes(CATALOGUE_URL, signal, 2_000_000, undefined, 'no-store');
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('The Library server did not return valid JSON.'); }
  return { songs: parseCatalogue(data), fetchedAt: Date.now() };
}

export const searchSongs = (songs: LibrarySong[], query: string) => {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return songs.filter(s => words.every(w => `${s.title} ${s.subtitle} ${s.parts.map(p => `${p.label} ${p.voice}`).join(' ')}`.toLocaleLowerCase().includes(w)));
};
