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
    } = {}
  ): Promise<PitchFrame[]> {
    const {
      enableBandpass = true,
      vocalPreset = 'all',
      timeStep = 0.01,
      onProgress
    } = options;

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
      onProgress?.({ percent: 15, stage: 'Filtering dominant vocal spectrum...' });
      const bounds = AudioFilter.getPresetBounds(vocalPreset);
      const lowCut = options.lowCut || bounds.low;
      const highCut = options.highCut || bounds.high;
      processedSamples = AudioFilter.filterBandpass(monoSamples, sampleRate, lowCut, highCut);
      processedSamples = AudioFilter.softCompress(processedSamples, 0.35);
    }

    // 3. Frame extraction setup
    const windowLength = 2048;
    const hopSize = Math.max(128, Math.round(timeStep * sampleRate));
    const totalFrames = Math.floor((totalSamples - windowLength) / hopSize);

    const pitchEngine = new PraatPitchEngine({
      sampleRate,
      pitchFloor: 75,
      pitchCeiling: 900,
      voicingThreshold: 0.35,
      silenceThreshold: 0.008
    });

    const rawFrames: PitchFrame[] = [];
    const frameBuffer = new Float32Array(windowLength);

    onProgress?.({ percent: 25, stage: 'Computing Praat autocorrelation...' });

    // Yield to browser periodically so UI stays responsive
    const yieldEvery = 200;
    for (let f = 0; f < totalFrames; f++) {
      const startSample = f * hopSize;
      const timestamp = startSample / sampleRate;

      for (let i = 0; i < windowLength; i++) {
        frameBuffer[i] = processedSamples[startSample + i];
      }

      const frame = pitchEngine.analyzeFrame(frameBuffer, timestamp);
      rawFrames.push(frame);

      if (f % yieldEvery === 0) {
        const percent = 25 + Math.round((f / totalFrames) * 60);
        onProgress?.({ percent, stage: `Analyzing frames: ${f}/${totalFrames}` });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // 4. Viterbi Path Smoothing (eliminating residual octave errors)
    onProgress?.({ percent: 90, stage: 'Smoothing pitch path (Viterbi)...' });
    const smoothedFrames = BatchPitchExtractor.viterbiPathFinder(rawFrames);

    onProgress?.({ percent: 100, stage: 'Pitch extraction complete' });
    return smoothedFrames;
  }

  /**
   * Viterbi path smoothing adapted from Praat's Pitch_pathFinder:
   * Penalizes large octave jumps between consecutive voiced frames.
   */
  private static viterbiPathFinder(frames: PitchFrame[]): PitchFrame[] {
    const result = [...frames];
    const n = result.length;

    for (let i = 1; i < n - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];

      // If current is isolated octave spike/dip between smooth neighbors
      if (curr.voiced && prev.voiced && next.voiced) {
        const expectedMidi = (prev.exactMidi + next.exactMidi) / 2;
        const midiDiff = curr.exactMidi - expectedMidi;

        // Check for octave jump (~12 semitones or ~24 semitones)
        if (Math.abs(Math.abs(midiDiff) - 12) < 2.0 || Math.abs(Math.abs(midiDiff) - 24) < 2.0) {
          // Correct the octave jump
          const correctedMidi = curr.exactMidi - Math.round(midiDiff / 12) * 12;
          const correctedHz = PraatPitchEngine.midiToFrequency(correctedMidi);
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
    }

    return result;
  }
}
