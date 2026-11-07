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
  targetPitchMidi?: number; // Harmonized target pitch
}

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
    micHistory: PitchFrame[],
    options: RendererOptions
  ) {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    const theme = options.theme;

    // 1. Clear background
    ctx.fillStyle = theme.bgMain;
    ctx.fillRect(0, 0, width, height);

    const noteAxisWidth = 56; // Left margin reserved for note labels
    const plotWidth = width - noteAxisWidth;
    const plotHeight = height;

    const midiRange = options.maxMidi - options.minMidi;
    const midiToY = (midi: number) => {
      const normalized = (options.maxMidi - midi) / midiRange;
      return normalized * plotHeight;
    };

    const timeToX = (time: number) => {
      const relTime = time - options.timeOffset;
      return noteAxisWidth + (relTime / options.visibleDuration) * plotWidth;
    };

    // 2. Draw Horizontal Semitone Grid & Note Labels
    this.drawGrid(ctx, options, noteAxisWidth, plotWidth, plotHeight, midiToY);

    // 3. Render Pre-Analyzed Audio Tracks
    ctx.save();
    // Clip plot area to avoid drawing over note labels
    ctx.beginPath();
    ctx.rect(noteAxisWidth, 0, plotWidth, plotHeight);
    ctx.clip();

    for (const track of tracks) {
      if (track.pitchFrames && track.pitchFrames.length > 0 && !track.muted) {
        this.renderTrackPills(ctx, track.pitchFrames, track.color, options, timeToX, midiToY);
      }
    }

    // 4. Render Live Microphone Trail
    if (micHistory.length > 0) {
      this.renderMicTrail(ctx, micHistory, theme.micTrail, options, timeToX, midiToY);
    }

    // 5. Draw Playhead Vertical Line
    const playheadX = timeToX(options.currentTime);
    if (playheadX >= noteAxisWidth && playheadX <= width) {
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

  /**
   * Renders note segments as horizontal rounded bars (pills) with endpoint dots
   * and smooth bezier curves connecting transitions, matching the reference image!
   */
  private renderTrackPills(
    ctx: CanvasRenderingContext2D,
    frames: PitchFrame[],
    color: string,
    options: RendererOptions,
    timeToX: (t: number) => number,
    midiToY: (m: number) => number
  ) {
    if (frames.length === 0) return;

    // Filter frames within or slightly outside the visible time window
    const startTime = options.timeOffset - 0.5;
    const endTime = options.timeOffset + options.visibleDuration + 0.5;

    // Group continuous voiced frames into note segments
    interface NoteSegment {
      startIdx: number;
      endIdx: number;
      startTime: number;
      endTime: number;
      avgMidi: number;
      frames: PitchFrame[];
    }

    const segments: NoteSegment[] = [];
    let currentFrames: PitchFrame[] = [];

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.timestamp < startTime || f.timestamp > endTime) continue;

      if (f.voiced && f.frequency > 0) {
        currentFrames.push(f);
      } else {
        if (currentFrames.length >= 3) {
          const sumMidi = currentFrames.reduce((acc, c) => acc + c.exactMidi, 0);
          segments.push({
            startIdx: i - currentFrames.length,
            endIdx: i - 1,
            startTime: currentFrames[0].timestamp,
            endTime: currentFrames[currentFrames.length - 1].timestamp,
            avgMidi: sumMidi / currentFrames.length,
            frames: [...currentFrames]
          });
        }
        currentFrames = [];
      }
    }
    if (currentFrames.length >= 3) {
      const sumMidi = currentFrames.reduce((acc, c) => acc + c.exactMidi, 0);
      segments.push({
        startIdx: frames.length - currentFrames.length,
        endIdx: frames.length - 1,
        startTime: currentFrames[0].timestamp,
        endTime: currentFrames[currentFrames.length - 1].timestamp,
        avgMidi: sumMidi / currentFrames.length,
        frames: [...currentFrames]
      });
    }

    // Draw connecting transition curves between segments (glissandos / pitch transitions)
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    for (let s = 0; s < segments.length - 1; s++) {
      const segA = segments[s];
      const segB = segments[s + 1];

      // If gap is less than 0.3s, connect with smooth bezier curve
      const gap = segB.startTime - segA.endTime;
      if (gap >= 0 && gap < 0.4) {
        const x1 = timeToX(segA.endTime);
        const y1 = midiToY(segA.avgMidi);
        const x2 = timeToX(segB.startTime);
        const y2 = midiToY(segB.avgMidi);

        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.moveTo(x1, y1);

        // Cubic bezier S-curve
        const midX = (x1 + x2) / 2;
        ctx.bezierCurveTo(midX, y1, midX, y2, x2, y2);
        ctx.stroke();
      }
    }

    // Draw horizontal rounded pills and endpoint circles
    const pillHeight = 7.0; // Thick rounded horizontal line
    for (const seg of segments) {
      const x1 = timeToX(seg.startTime);
      const x2 = Math.max(x1 + 6, timeToX(seg.endTime));
      const y = midiToY(seg.avgMidi);

      ctx.globalAlpha = 0.95;
      ctx.lineWidth = pillHeight;
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;

      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();

      // Small endpoint circle dot at the transition edge
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x2, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;
  }

  /**
   * Renders the real-time microphone live pitch trail
   */
  private renderMicTrail(
    ctx: CanvasRenderingContext2D,
    micHistory: PitchFrame[],
    color: string,
    options: RendererOptions,
    timeToX: (t: number) => number,
    midiToY: (m: number) => number
  ) {
    if (micHistory.length === 0) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8; // Glowing mic trail

    ctx.beginPath();
    let drawing = false;

    for (let i = 0; i < micHistory.length; i++) {
      const f = micHistory[i];
      if (f.voiced && f.frequency > 0) {
        const x = timeToX(f.timestamp);
        const y = midiToY(f.exactMidi);
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        drawing = false;
      }
    }
    ctx.stroke();

    // Draw live head cursor dot on the most recent frame
    const latest = micHistory[micHistory.length - 1];
    if (latest && latest.voiced && latest.frequency > 0) {
      const curX = timeToX(latest.timestamp);
      const curY = midiToY(latest.exactMidi);

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curX, curY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.restore();
  }
}
