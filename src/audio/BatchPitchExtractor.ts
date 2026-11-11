/**
 * Batch Pitch Extractor for Audio Files (MP3 / WAV)
 * 
 * Uses Praat's full Short-Term Autocorrelation with Viterbi Path Finding across all frames
 * to produce smooth, octave-jump-free pitch contours for uploaded tracks.
 */

import { PraatPitchEngine, PitchFrame } from './PraatPitchEngine';
import { AudioFilter } from './AudioFilter';

export interface BatchExtractionProgress {
  percent: number;
  stage: string;
}

/**
 * Bump whenever the analysis algorithm changes in a way that affects results.
 * Tracks persisted with an older version are re-analyzed when restored.
 */
export const PITCH_ANALYSIS_VERSION = 2;

export class BatchPitchExtractor {
  /**
   * Analyzes an entire AudioBuffer and returns time-aligned PitchFrames.
   */
  public static async extractPitchFromAudioBuffer(
    audioBuffer: AudioBuffer,
    options: {
      enableBandpass?: boolean;
      vocalPreset?: 'all' | 'male' | 'female' | 'soprano' | 'custom';
      lowCut?: number;
      highCut?: number;
      timeStep?: number; // Step between frames in seconds (default 0.01s = 10ms)
      onProgress?: (p: BatchExtractionProgress) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<PitchFrame[]> {
    const {
      enableBandpass = true,
      vocalPreset = 'all',
      timeStep = 0.01,
      onProgress
    } = options;
    options.signal?.throwIfAborted();

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;

    onProgress?.({ percent: 5, stage: 'Mixing channels to mono...' });

    // 1. Convert to Mono Float32Array
    const monoSamples = new Float32Array(totalSamples);
    if (numChannels === 1) {
      monoSamples.set(audioBuffer.getChannelData(0));
    } else {
      const ch0 = audioBuffer.getChannelData(0);
      const ch1 = audioBuffer.getChannelData(1);
      for (let i = 0; i < totalSamples; i++) {
        monoSamples[i] = (ch0[i] + ch1[i]) * 0.5;
      }
    }

    // 2. Pre-filter for dominant vocal tone isolation if requested
    let processedSamples: Float32Array<any> = monoSamples;
    if (enableBandpass) {
      onProgress?.({ percent: 15, stage: 'Filtering dominant audio spectrum...' });
      const bounds = AudioFilter.getPresetBounds(vocalPreset);
      const lowCut = options.lowCut || bounds.low;
      const highCut = options.highCut || bounds.high;
      processedSamples = AudioFilter.filterBandpass(monoSamples, sampleRate, lowCut, highCut);
    }

    // 3. Frame extraction setup
    const windowLength = 2048;
    const hopSize = Math.max(128, Math.round(timeStep * sampleRate));
    const totalFrames = Math.max(0, Math.floor((totalSamples - windowLength) / hopSize) + 1);

    // Silence threshold relative to the loudness of this recording (-26 dB below the
    // loudest frame), so quiet recordings and decaying notes are not cut off early.
    let peakRms = 0;
    for (let f = 0; f < totalFrames; f += 2) {
      const start = f * hopSize;
      let sum = 0;
      for (let i = 0; i < windowLength; i += 4) {
        const v = processedSamples[start + i];
        sum += v * v;
      }
      peakRms = Math.max(peakRms, Math.sqrt(sum / (windowLength / 4)));
    }
    const silenceThreshold = Math.min(0.01, Math.max(0.0005, peakRms * 0.05));

    const pitchEngine = new PraatPitchEngine({
      sampleRate,
      pitchFloor: 60,       // ~B1; the effective floor is also capped by the window length (3 periods)
      pitchCeiling: 1400,   // ~F6
      voicingThreshold: 0.45,
      silenceThreshold
    });

    const rawFrames: PitchFrame[] = [];
    const frameBuffer = new Float32Array(windowLength);

    onProgress?.({ percent: 25, stage: 'Computing Praat autocorrelation...' });

    // Yield to browser periodically so UI stays responsive
    const yieldEvery = 200;
    for (let f = 0; f < totalFrames; f++) {
      const startSample = f * hopSize;
      // Timestamp = centre of the analysis window, so notes line up with playback
      const timestamp = (startSample + windowLength / 2) / sampleRate;

      for (let i = 0; i < windowLength; i++) {
        frameBuffer[i] = processedSamples[startSample + i];
      }

      const frame = pitchEngine.analyzeFrame(frameBuffer, timestamp);
      rawFrames.push(frame);

      if (f % yieldEvery === 0) {
        const percent = 25 + Math.round((f / totalFrames) * 60);
        onProgress?.({ percent, stage: `Analyzing frames: ${f}/${totalFrames}` });
        await new Promise(resolve => setTimeout(resolve, 0));
        options.signal?.throwIfAborted();
      }
    }

    // 4. Pitch path clean-up (blips, dropouts, isolated octave jumps)
    options.signal?.throwIfAborted();
    onProgress?.({ percent: 90, stage: 'Smoothing pitch path...' });
    const smoothedFrames = BatchPitchExtractor.cleanPitchPath(rawFrames);

    onProgress?.({ percent: 100, stage: 'Pitch extraction complete' });
    return smoothedFrames;
  }

  private static unvoiced(frame: PitchFrame): PitchFrame {
    return {
      ...frame,
      frequency: 0,
      exactMidi: 0,
      nearestMidi: 0,
      noteName: '—',
      cents: 0,
      voiced: false,
      strength: 0
    };
  }

  /**
   * Post-processing of the raw frame-by-frame pitch track:
   * 1. Splits the voiced frames into runs of stable pitch.
   * 2. Removes very short runs (< MIN_RUN frames) - these are transition artefacts where the
   *    previous note is still ringing under the new one (typical for piano), or noise.
   * 3. Fills short unvoiced gaps between runs of the same pitch.
   * 4. Corrects isolated octave jumps.
   */
  public static cleanPitchPath(frames: PitchFrame[]): PitchFrame[] {
    const MIN_RUN = 5;        // 50 ms at the default 10 ms hop
    const MAX_GAP_FILL = 3;   // 30 ms
    const result = [...frames];
    const n = result.length;

    // Pass 1: Correct isolated single-frame octave jumps
    for (let i = 1; i < n - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];
      if (!(curr.voiced && prev.voiced && next.voiced)) continue;
      if (Math.abs(prev.exactMidi - next.exactMidi) > 1.0) continue;

      const expectedMidi = (prev.exactMidi + next.exactMidi) / 2;
      const midiDiff = curr.exactMidi - expectedMidi;
      const octaves = Math.round(midiDiff / 12);
      if (octaves !== 0 && Math.abs(midiDiff - octaves * 12) < 1.0) {
        const correctedHz = curr.frequency / Math.pow(2, octaves);
        const noteInfo = PraatPitchEngine.frequencyToNote(correctedHz);
        result[i] = {
          ...curr,
          frequency: correctedHz,
          exactMidi: noteInfo.exactMidi,
          nearestMidi: noteInfo.nearestMidi,
          noteName: noteInfo.noteName,
          cents: noteInfo.cents
        };
      }
    }

    // Pass 2: Remove short unstable runs
    let runStart = -1;
    const flushRun = (endExclusive: number) => {
      if (runStart >= 0 && endExclusive - runStart < MIN_RUN) {
        for (let k = runStart; k < endExclusive; k++) {
          result[k] = BatchPitchExtractor.unvoiced(result[k]);
        }
      }
      runStart = -1;
    };
    for (let i = 0; i < n; i++) {
      const f = result[i];
      if (!f.voiced) {
        flushRun(i);
        continue;
      }
      if (runStart < 0) {
        runStart = i;
      } else if (Math.abs(f.exactMidi - result[i - 1].exactMidi) > 0.8) {
        flushRun(i);
        runStart = i;
      }
    }
    flushRun(n);

    // Pass 2b: Remove short runs far BELOW both neighbouring notes. When two notes overlap
    // (previous note still ringing), the mixture's common period is a deep sub-harmonic
    // (e.g. D4 + A3 -> D2), which shows up as a brief low "dip" between the two notes.
    const runs: { start: number; end: number; midi: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (!result[i].voiced) continue;
      const start = i;
      while (i + 1 < n && result[i + 1].voiced && Math.abs(result[i + 1].exactMidi - result[i].exactMidi) <= 0.8) i++;
      const mids = result.slice(start, i + 1).map(f => f.exactMidi).sort((a, b) => a - b);
      runs.push({ start, end: i, midi: mids[Math.floor(mids.length / 2)] });
    }
    const SHORT_RUN = 12;     // 120 ms
    const NEIGHBOUR_GAP = 10; // 100 ms
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      if (run.end - run.start + 1 >= SHORT_RUN) continue;
      const prev = r > 0 && run.start - runs[r - 1].end <= NEIGHBOUR_GAP ? runs[r - 1] : null;
      const next = r < runs.length - 1 && runs[r + 1].start - run.end <= NEIGHBOUR_GAP ? runs[r + 1] : null;
      if (!prev && !next) continue;
      const lowestNeighbour = Math.min(prev ? prev.midi : Infinity, next ? next.midi : Infinity);
      if (run.midi < lowestNeighbour - 7 && (!prev || !next || Math.max(prev.midi, next.midi) > run.midi + 7)) {
        for (let k = run.start; k <= run.end; k++) {
          result[k] = BatchPitchExtractor.unvoiced(result[k]);
        }
      }
    }

    // Pass 3: Fill short unvoiced gaps between frames of (almost) the same pitch
    for (let i = 1; i < n; i++) {
      if (result[i].voiced || !result[i - 1].voiced) continue;
      let j = i;
      while (j < n && !result[j].voiced && j - i < MAX_GAP_FILL) j++;
      if (j >= n || !result[j].voiced) continue;
      const a = result[i - 1];
      const b = result[j];
      if (Math.abs(a.exactMidi - b.exactMidi) >= 0.5) continue;
      for (let k = i; k < j; k++) {
        const t = (k - i + 1) / (j - i + 1);
        const hz = a.frequency * Math.pow(b.frequency / a.frequency, t);
        const noteInfo = PraatPitchEngine.frequencyToNote(hz);
        result[k] = {
          timestamp: result[k].timestamp,
          frequency: hz,
          exactMidi: noteInfo.exactMidi,
          nearestMidi: noteInfo.nearestMidi,
          noteName: noteInfo.noteName,
          cents: noteInfo.cents,
          voiced: true,
          strength: Math.min(a.strength, b.strength),
          intensity: result[k].intensity
        };
      }
      i = j;
    }

    return result;
  }
}
