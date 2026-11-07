/**
 * Note Grid Canvas Renderer
 * 
 * Draws the interactive piano-roll style note grid, rounded note pills,
 * bezier pitch transitions, multi-track curves, live mic trail, and playhead.
 * Exactly matches the reference design.
 */

import { PitchFrame } from '../audio/PraatPitchEngine';
import { AudioTrackState } from '../audio/MultiTrackMixer';
import { ThemeColors, NoteLabelMode } from './ThemeManager';

export interface RendererOptions {
  theme: ThemeColors;
  noteLabelMode: NoteLabelMode;
  enharmonic: 'sharp' | 'flat';
  minMidi: number;        // e.g. 45 = A2
  maxMidi: number;        // e.g. 77 = F5
  visibleDuration: number;// e.g. 8.0 seconds visible horizontally
  timeOffset: number;     // Current scroll position in seconds
  currentTime: number;    // Playback playhead position
  /** Harmony target notes (reference melody transposed by the active interval) */
  harmonyNotes?: HarmonyNote[];
  harmonyColor?: string;
  /** Beat grid (metronome tempo); bar lines are drawn when set */
  beatGrid?: { bpm: number; firstBeat: number; beatsPerBar: number } | null;
  /** Row to highlight (tuner mode: nearest note) */
  highlightMidi?: number | null;
  /** Hide the playhead (tuner mode) */
  hidePlayhead?: boolean;
}

export interface HarmonyNote {
  startTime: number;
  endTime: number;
  midi: number;
}

/** One continuous pass of singing into the microphone. */
export interface MicTake {
  id: number;
  color: string;
  frames: PitchFrame[];
}

export interface NoteSegment {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  medianMidi: number;
  nearestMidi: number;
  noteName: string;
  frames: PitchFrame[];
}

/** Width of the left note-label axis, in CSS pixels. */
export const NOTE_AXIS_WIDTH = 56;

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export class NoteGridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;
  }

  public render(
    tracks: AudioTrackState[],
    takes: MicTake[],
    options: RendererOptions,
    logicalWidth?: number,
    logicalHeight?: number
  ) {
    const width = logicalWidth || this.canvas.clientWidth || this.canvas.width;
    const height = logicalHeight || this.canvas.clientHeight || this.canvas.height;
    const ctx = this.ctx;
    const theme = options.theme;

    // 1. Clear background
    ctx.fillStyle = theme.bgMain;
    ctx.fillRect(0, 0, width, height);

    const noteAxisWidth = NOTE_AXIS_WIDTH; // Left margin reserved for note labels
    const plotWidth = width - noteAxisWidth;
    const plotHeight = height;

    const midiRange = Math.max(1, options.maxMidi - options.minMidi);
    const midiToY = (midi: number) => {
      const normalized = (options.maxMidi - midi) / midiRange;
      return normalized * plotHeight;
    };

    const timeToX = (time: number) => {
      const relTime = time - options.timeOffset;
      return noteAxisWidth + (relTime / Math.max(0.01, options.visibleDuration)) * plotWidth;
    };

    // 2. Draw Horizontal Semitone Grid & Note Labels
    this.drawGrid(ctx, options, noteAxisWidth, plotWidth, plotHeight, midiToY);
    if (options.highlightMidi != null) {
      const rowH = plotHeight / midiRange;
      ctx.fillStyle = options.theme.playhead;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(noteAxisWidth, midiToY(options.highlightMidi) - rowH / 2, plotWidth, rowH);
      ctx.globalAlpha = 1;
    }
    if (options.beatGrid) {
      this.drawBeatGrid(ctx, options, noteAxisWidth, plotWidth, plotHeight, timeToX);
    }
    this.drawTimeRuler(ctx, options, noteAxisWidth, plotWidth, plotHeight, timeToX);

    // 3. Render Pre-Analyzed Audio Tracks
    ctx.save();
    // Clip plot area to avoid drawing over note labels
    ctx.beginPath();
    ctx.rect(noteAxisWidth, 0, plotWidth, plotHeight);
    ctx.clip();

    for (const track of tracks) {
      if (track.pitchFrames && track.pitchFrames.length > 0 && !track.muted) {
        this.renderTrackPills(ctx, track.pitchFrames, NoteGridRenderer.readable(track.color, theme.bgMain), options, timeToX, midiToY, plotHeight, midiRange);
      }
    }

    // Harmony target notes (what the singer should sing when an interval is selected)
    if (options.harmonyNotes && options.harmonyNotes.length > 0) {
      this.renderHarmonyNotes(ctx, options, timeToX, midiToY, plotHeight, midiRange);
    }

    // 4. Render microphone takes (older takes faded, latest take bright)
    takes.forEach((take, i) => {
      if (take.frames.length > 0) {
        this.renderMicTrail(ctx, take.frames, NoteGridRenderer.readable(take.color, theme.bgMain), i === takes.length - 1, options, timeToX, midiToY);
      }
    });

    // 5. Draw Playhead Vertical Line
    const playheadX = timeToX(options.currentTime);
    if (!options.hidePlayhead && playheadX >= noteAxisWidth && playheadX <= width) {
      ctx.strokeStyle = theme.playhead;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Playhead top handle
      ctx.fillStyle = theme.playhead;
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX, 10);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Draws metronome bar lines (and beat lines when zoomed in far enough).
   */
  private drawBeatGrid(
    ctx: CanvasRenderingContext2D,
    options: RendererOptions,
    axisWidth: number,
    plotWidth: number,
    plotHeight: number,
    timeToX: (t: number) => number
  ) {
    const grid = options.beatGrid;
    if (!grid || grid.bpm <= 0) return;
    const beat = 60 / grid.bpm;
    const pxPerBeat = (plotWidth / Math.max(0.01, options.visibleDuration)) * beat;
    const showBeats = pxPerBeat >= 14;
    if (!showBeats && pxPerBeat * grid.beatsPerBar < 10) return;

    const first = Math.ceil((options.timeOffset - grid.firstBeat) / beat);
    const last = Math.floor((options.timeOffset + options.visibleDuration - grid.firstBeat) / beat);
    ctx.save();
    ctx.strokeStyle = options.theme.playhead;
    for (let i = first; i <= last; i++) {
      const isBar = ((i % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
      if (!isBar && !showBeats) continue;
      const x = Math.round(timeToX(grid.firstBeat + i * beat)) + 0.5;
      if (x < axisWidth) continue;
      ctx.globalAlpha = isBar ? 0.22 : 0.08;
      ctx.lineWidth = 1;
      ctx.setLineDash(isBar ? [] : [2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 16);
      ctx.lineTo(x, plotHeight);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draws harmony target notes as dashed outline bars.
   */
  private renderHarmonyNotes(
    ctx: CanvasRenderingContext2D,
    options: RendererOptions,
    timeToX: (t: number) => number,
    midiToY: (m: number) => number,
    plotHeight: number,
    midiRange: number
  ) {
    const start = options.timeOffset - 0.5;
    const end = options.timeOffset + options.visibleDuration + 0.5;
    const color = options.harmonyColor || '#a78bfa';
    const rowHeight = plotHeight / midiRange;
    const h = Math.max(6, Math.min(rowHeight * 0.8, 16));

    ctx.save();
    for (const n of options.harmonyNotes!) {
      if (n.endTime < start || n.startTime > end) continue;
      const x1 = timeToX(n.startTime);
      const w = Math.max(8, timeToX(n.endTime) - x1);
      const y = midiToY(n.midi);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x1, y - h / 2, w, h, 4);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (w >= 22) {
        ctx.fillStyle = color;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(NoteGridRenderer.midiName(Math.round(n.midi), options.enharmonic), x1 + 2, y + h / 2 + 2);
      }
    }
    ctx.restore();
  }

  /**
   * Draws vertical time gridlines with labels; the step adapts to the zoom level.
   */
  private drawTimeRuler(
    ctx: CanvasRenderingContext2D,
    options: RendererOptions,
    axisWidth: number,
    plotWidth: number,
    plotHeight: number,
    timeToX: (t: number) => number
  ) {
    const theme = options.theme;
    const pxPerSecond = plotWidth / Math.max(0.01, options.visibleDuration);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => s * pxPerSecond >= 80) ?? steps[steps.length - 1];

    const formatTime = (t: number) => {
      const m = Math.floor(t / 60);
      const sec = t - m * 60;
      const secStr = step < 1 ? sec.toFixed(step === 0.25 ? 2 : 1) : Math.round(sec).toString();
      return `${m}:${sec < 10 ? '0' : ''}${secStr}`;
    };

    const first = Math.max(0, Math.ceil(options.timeOffset / step) * step);
    const last = options.timeOffset + options.visibleDuration;

    ctx.save();
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let t = first; t <= last + 1e-9; t += step) {
      const x = Math.round(timeToX(t)) + 0.5;
      if (x < axisWidth || x > axisWidth + plotWidth) continue;
      ctx.strokeStyle = theme.gridLineSemitone;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotHeight);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = theme.gridText;
      ctx.fillText(formatTime(t), x + 4, 4);
    }
    ctx.restore();
  }

  /**
   * Draws semitone rows and note labels on the left axis
   */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    options: RendererOptions,
    axisWidth: number,
    plotWidth: number,
    plotHeight: number,
    midiToY: (midi: number) => number
  ) {
    const theme = options.theme;
    const nameTable = options.enharmonic === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';

    for (let midi = options.minMidi; midi <= options.maxMidi; midi++) {
      const y = Math.round(midiToY(midi));
      const noteIndex = ((midi % 12) + 12) % 12;
      const octave = Math.floor(midi / 12) - 1;
      const isC = noteIndex === 0;
      const isAccidental = [1, 3, 6, 8, 10].includes(noteIndex);

      // Grid line style
      ctx.beginPath();
      ctx.moveTo(axisWidth, y);
      ctx.lineTo(axisWidth + plotWidth, y);

      if (isC) {
        ctx.strokeStyle = theme.gridLineOctave;
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = theme.gridLineSemitone;
        ctx.lineWidth = 1;
      }
      ctx.stroke();

      // Note label decision based on user display mode
      let shouldShowLabel = false;
      let labelText = '';

      if (options.noteLabelMode === 'cs_only') {
        if (isC) {
          shouldShowLabel = true;
          labelText = `C${octave}`;
        }
      } else if (options.noteLabelMode === 'flats_only') {
        if (isC || isAccidental) {
          shouldShowLabel = true;
          labelText = `${nameTable[noteIndex]}${octave}`;
        }
      } else {
        // all_notes
        shouldShowLabel = true;
        labelText = `${nameTable[noteIndex]}${octave}`;
      }

      if (shouldShowLabel) {
        ctx.fillStyle = isC ? theme.gridTextOctave : theme.gridText;
        ctx.textAlign = 'right';
        ctx.fillText(labelText, axisWidth - 10, y);
      }
    }

    // Left axis dividing border line
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisWidth, 0);
    ctx.lineTo(axisWidth, plotHeight);
    ctx.stroke();
  }

  private static readableCache = new Map<string, string>();

  /**
   * Returns `color`, darkened or lightened until it stands out against `background`
   * (e.g. the cream track colour on the light theme).
   */
  public static readable(color: string, background: string): string {
    const key = `${color}|${background}`;
    const cached = NoteGridRenderer.readableCache.get(key);
    if (cached) return cached;

    const parse = (hex: string) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const fg = parse(color);
    const bg = parse(background);
    let result = color;
    if (fg && bg) {
      const bgL = lum(bg);
      const contrast = (rgb: number[]) => {
        const a = lum(rgb);
        return (Math.max(a, bgL) + 0.05) / (Math.min(a, bgL) + 0.05);
      };
      const target = bgL > 0.5 ? [0, 0, 0] : [255, 255, 255];
      let rgb = fg;
      for (let step = 1; step <= 10 && contrast(rgb) < 2.6; step++) {
        const t = step * 0.08;
        rgb = fg.map((v, i) => Math.round(v + (target[i] - v) * t));
      }
      result = `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
    }
    NoteGridRenderer.readableCache.set(key, result);
    return result;
  }

  /** Segments cache: pitch frame arrays are immutable once analyzed, so key by reference. */
  private static segmentCache = new WeakMap<PitchFrame[], NoteSegment[]>();

  /**
   * Returns note segments for a whole track (cached per frames array).
   */
  public static getSegments(frames: PitchFrame[]): NoteSegment[] {
    let segs = NoteGridRenderer.segmentCache.get(frames);
    if (!segs) {
      segs = NoteGridRenderer.segmentNotes(frames);
      NoteGridRenderer.segmentCache.set(frames, segs);
    }
    return segs;
  }

  /**
   * Segments continuous pitch frames into musical note events based on:
   * 1. Voicing/silence boundaries
   * 2. Sustained pitch changes (>= SPLIT_SEMITONES for SPLIT_FRAMES consecutive frames),
   *    so vibrato and short scoops do not fragment a sung note
   * 3. Intensity onsets (e.g. repeated piano keystrokes on the same note)
   */
  public static segmentNotes(frames: PitchFrame[], timeRange?: { start: number; end: number }): NoteSegment[] {
    const SPLIT_SEMITONES = 0.6;
    const SPLIT_FRAMES = 5;
    const MIN_FRAMES = 4;       // Shortest note that is drawn
    const MIN_SPLIT_FRAMES = 8; // A note must last this long before it can be split again
    const REF_WINDOW = 50;      // Reference pitch = mean of the last 0.5 s of the note (spans several vibrato cycles)
    const VIBRATO_PERIOD = 18;  // ~180 ms = one cycle of a typical 5-6 Hz vibrato
    const STEP_SEMITONES = 0.6; // Minimum change of the period-averaged pitch to count as a new note

    const segments: NoteSegment[] = [];
    if (!frames || frames.length === 0) return segments;

    const startTime = timeRange ? timeRange.start : -Infinity;
    const endTime = timeRange ? timeRange.end : Infinity;

    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    let current: PitchFrame[] = [];
    let currentStartIdx = 0;

    const flush = (frameList: PitchFrame[]) => {
      if (frameList.length >= MIN_FRAMES) {
        const medianMidi = median(frameList.map(f => f.exactMidi));
        const nearestMidi = Math.round(medianMidi);
        const noteIndex = ((nearestMidi % 12) + 12) % 12;
        const octave = Math.floor(nearestMidi / 12) - 1;
        const first = frameList[0];
        const last = frameList[frameList.length - 1];
        segments.push({
          id: `seg-${segments.length}`,
          startTime: first.timestamp,
          endTime: last.timestamp,
          duration: last.timestamp - first.timestamp,
          medianMidi,
          nearestMidi,
          noteName: `${NOTE_NAMES_SHARP[noteIndex]}${octave}`,
          frames: frameList
        });
      }
    };

    // Mean pitch of voiced frames in [from, to), stopping at the first unvoiced frame
    const meanMidi = (from: number, to: number, backwards: boolean) => {
      let sum = 0;
      let count = 0;
      if (backwards) {
        for (let k = to - 1; k >= from && frames[k].voiced; k--) { sum += frames[k].exactMidi; count++; }
      } else {
        for (let k = from; k < to && k < frames.length && frames[k].voiced; k++) { sum += frames[k].exactMidi; count++; }
      }
      return { mean: count > 0 ? sum / count : NaN, count };
    };

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.timestamp < startTime || f.timestamp > endTime) continue;

      if (!f.voiced || f.frequency <= 0) {
        flush(current);
        current = [];
        continue;
      }

      if (current.length >= MIN_SPLIT_FRAMES) {
        const ref = meanMidi(Math.max(currentStartIdx, i - REF_WINDOW), i, true).mean;

        // Candidate split: this and the following frames all moved away from the note...
        if (Math.abs(f.exactMidi - ref) >= SPLIT_SEMITONES) {
          const dir = Math.sign(f.exactMidi - ref);
          let sustained = true;
          for (let k = 1; k < SPLIT_FRAMES; k++) {
            const nf = frames[i + k];
            if (!nf || !nf.voiced || Math.sign(nf.exactMidi - ref) !== dir || Math.abs(nf.exactMidi - ref) < SPLIT_SEMITONES) {
              sustained = false;
              break;
            }
          }
          // ...and the average pitch over ~one vibrato period after the candidate differs from
          // the period before it. Vibrato averages out over a full period; a real note change does not.
          if (sustained) {
            const before = meanMidi(Math.max(currentStartIdx, i - VIBRATO_PERIOD), i, true);
            const after = meanMidi(i, i + VIBRATO_PERIOD, false);
            // A short tail (note about to end) cannot average out vibrato: demand a larger step
            const required = after.count >= VIBRATO_PERIOD * 0.6 ? STEP_SEMITONES : 1.5;
            sustained = Math.abs(after.mean - before.mean) >= required;
          }
          if (sustained) {
            flush(current);
            current = [f];
            currentStartIdx = i;
            continue;
          }
        }

        // Onset: sudden intensity rise (re-attack of the same pitch). Analysis windows overlap,
        // so an attack rises over several frames: compare with the level ~50 ms earlier and
        // split where the rise began.
        const prevFrame = current[current.length - 1];
        const LOOKBACK = 5;
        if (current.length >= 8 && f.intensity > prevFrame.intensity) {
          const recent = current.slice(-LOOKBACK);
          let minIdx = 0;
          for (let k = 1; k < recent.length; k++) if (recent[k].intensity < recent[minIdx].intensity) minIdx = k;
          const base = recent[minIdx].intensity;
          if (base > 0.002 && f.intensity > 1.8 * base) {
            const cut = current.length - LOOKBACK + minIdx + 1;
            const head = current.slice(0, cut);
            const tail = current.slice(cut);
            flush(head);
            current = [...tail, f];
            currentStartIdx = i - tail.length;
            continue;
          }
        }
      }

      if (current.length === 0) currentStartIdx = i;
      current.push(f);
    }

    flush(current);
    return NoteGridRenderer.mergeSlivers(segments, median);
  }

  /**
   * Merges very short segments (< 100 ms) into a directly adjacent note that is within about a
   * semitone. These slivers are vibrato peaks or scoops right at a note boundary, not notes.
   */
  private static mergeSlivers(segments: NoteSegment[], median: (v: number[]) => number): NoteSegment[] {
    const SLIVER_FRAMES = 10;
    const MAX_GAP = 0.015;
    const MAX_DIFF = 1.25;
    const result = [...segments];

    for (let s = 0; s < result.length; s++) {
      const seg = result[s];
      if (seg.frames.length >= SLIVER_FRAMES) continue;
      const prev = s > 0 ? result[s - 1] : null;
      const next = s < result.length - 1 ? result[s + 1] : null;
      const prevOk = prev && seg.startTime - prev.endTime <= MAX_GAP && Math.abs(prev.medianMidi - seg.medianMidi) < MAX_DIFF;
      const nextOk = next && next.startTime - seg.endTime <= MAX_GAP && Math.abs(next.medianMidi - seg.medianMidi) < MAX_DIFF;
      if (!prevOk && !nextOk) continue;

      const intoPrev = prevOk && (!nextOk || Math.abs(prev!.medianMidi - seg.medianMidi) <= Math.abs(next!.medianMidi - seg.medianMidi));
      const target = intoPrev ? prev! : next!;
      const frames = intoPrev ? [...target.frames, ...seg.frames] : [...seg.frames, ...target.frames];
      const medianMidi = median(frames.map(f => f.exactMidi));
      const nearestMidi = Math.round(medianMidi);
      const merged: NoteSegment = {
        ...target,
        startTime: frames[0].timestamp,
        endTime: frames[frames.length - 1].timestamp,
        duration: frames[frames.length - 1].timestamp - frames[0].timestamp,
        medianMidi,
        nearestMidi,
        noteName: `${NOTE_NAMES_SHARP[((nearestMidi % 12) + 12) % 12]}${Math.floor(nearestMidi / 12) - 1}`,
        frames
      };
      if (intoPrev) {
        result.splice(s - 1, 2, merged);
      } else {
        result.splice(s, 2, merged);
      }
      s = Math.max(-1, s - 2);
    }

    return result.map((seg, i) => ({ ...seg, id: `seg-${i}` }));
  }

  /** Display name for a MIDI note honoring sharp/flat preference. */
  private static midiName(midi: number, enharmonic: 'sharp' | 'flat') {
    const table = enharmonic === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
    return `${table[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }

  /**
   * Renders note segments as horizontal rounded bars (pills) with note names,
   * continuous high-precision pitch contours, and smooth transitions.
   */
  private renderTrackPills(
    ctx: CanvasRenderingContext2D,
    frames: PitchFrame[],
    color: string,
    options: RendererOptions,
    timeToX: (t: number) => number,
    midiToY: (m: number) => number,
    plotHeight: number,
    midiRange: number
  ) {
    if (frames.length === 0) return;

    // Only segments overlapping the visible window (plus margin for transition curves)
    const startTime = options.timeOffset - 0.5;
    const endTime = options.timeOffset + options.visibleDuration + 0.5;
    const segments = NoteGridRenderer.getSegments(frames).filter(
      s => s.endTime >= startTime && s.startTime <= endTime
    );
    if (segments.length === 0) return;

    const rowHeight = plotHeight / midiRange;
    const pillHeight = Math.max(6, Math.min(rowHeight * 0.8, 16));

    // 1. Draw connecting transition curves between segments (glissandos / pitch transitions)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;

    for (let s = 0; s < segments.length - 1; s++) {
      const segA = segments[s];
      const segB = segments[s + 1];

      const gap = segB.startTime - segA.endTime;
      if (gap >= 0 && gap < 0.35) {
        const x1 = timeToX(segA.endTime);
        const y1 = midiToY(segA.medianMidi);
        const x2 = timeToX(segB.startTime);
        const y2 = midiToY(segB.medianMidi);

        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const midX = (x1 + x2) / 2;
        ctx.bezierCurveTo(midX, y1, midX, y2, x2, y2);
        ctx.stroke();
      }
    }

    // 2. Draw Note Pills and Pitch Contours
    for (const seg of segments) {
      const x1 = timeToX(seg.startTime);
      const x2 = Math.max(x1 + 8, timeToX(seg.endTime));
      const width = x2 - x1;
      const y = midiToY(seg.medianMidi);
      const halfH = pillHeight / 2;

      // Draw rounded background pill
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x1, y - halfH, width, pillHeight, 4);
      ctx.fill();

      // Border of pill
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Note name just above the bar (inside it would collide with the pitch contour line)
      if (width >= 22) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = color;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(NoteGridRenderer.midiName(seg.nearestMidi, options.enharmonic), x1 + 2, y - halfH - 2);
      }
      ctx.restore();

      // 3. Draw continuous high-precision pitch contour line inside the note
      if (seg.frames.length >= 2) {
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        let started = false;
        for (let i = 0; i < seg.frames.length; i++) {
          const f = seg.frames[i];
          const fx = timeToX(f.timestamp);
          const fy = midiToY(f.exactMidi);
          if (!started) {
            ctx.moveTo(fx, fy);
            started = true;
          } else {
            ctx.lineTo(fx, fy);
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // Small endpoint circle dot at the transition edge
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x2, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 1.0;
  }

  /**
   * Renders one microphone take. The line is broken on unvoiced frames and on time gaps,
   * so a take never draws a connecting line back across the screen.
   */
  private renderMicTrail(
    ctx: CanvasRenderingContext2D,
    frames: PitchFrame[],
    color: string,
    isActive: boolean,
    options: RendererOptions,
    timeToX: (t: number) => number,
    midiToY: (m: number) => number
  ) {
    const MAX_GAP = 0.15; // seconds; larger jumps start a new line segment
    const start = options.timeOffset - 1;
    const end = options.timeOffset + options.visibleDuration + 1;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 3.5 : 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = isActive ? 1 : 0.55;
    if (isActive) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }

    ctx.beginPath();
    let drawing = false;
    let prevTime = -Infinity;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.timestamp < start || f.timestamp > end) {
        drawing = false;
        prevTime = f.timestamp;
        continue;
      }
      const gap = f.timestamp - prevTime;
      prevTime = f.timestamp;
      if (!f.voiced || f.frequency <= 0) {
        drawing = false;
        continue;
      }
      const x = timeToX(f.timestamp);
      const y = midiToY(f.exactMidi);
      if (!drawing || gap > MAX_GAP || gap < 0) {
        ctx.moveTo(x, y);
        drawing = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Live head dot on the most recent frame of the active take
    const latest = frames[frames.length - 1];
    if (isActive && latest && latest.voiced && latest.frequency > 0) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(timeToX(latest.timestamp), midiToY(latest.exactMidi), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.restore();
  }
}
