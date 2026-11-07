/**
 * Praat Pitch Engine
 * 
 * Implements Paul Boersma's Normalized Autocorrelation algorithm with 
 * Sinc / Parabolic interpolation for sub-cent fundamental frequency (F0) estimation.
 * Reference: Boersma, P. (1993). "Accurate short-term analysis of the fundamental frequency 
 * and the harmonics-to-noise ratio of a sampled sound." Proc. Institute of Phonetic Sciences 17: 97–110.
 */

export interface PitchFrame {
  timestamp: number;       // In seconds
  frequency: number;       // Fundamental frequency in Hz (0 if unvoiced)
  exactMidi: number;       // Continuous MIDI pitch (e.g., 69.34)
  nearestMidi: number;     // Nearest integer MIDI note (e.g., 69 = A4)
  noteName: string;        // E.g., "A4" or "C#4"
  cents: number;           // Cent deviation from nearest note (-50 to +50)
  voiced: boolean;         // Voiced / unvoiced classification
  strength: number;        // Autocorrelation strength / periodicity (0.0 to 1.0)
  intensity: number;       // RMS energy
}

export interface PitchEngineConfig {
  sampleRate: number;      // e.g. 44100 or 48000
  pitchFloor: number;      // Min frequency in Hz (default: 75 Hz)
  pitchCeiling: number;    // Max frequency in Hz (default: 800 Hz)
  voicingThreshold: number;// Threshold for voiced decision (default: 0.40)
  silenceThreshold: number;// RMS silence threshold (default: 0.015)
  octaveCost: number;      // Octave cost factor (default: 0.01)
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export class PraatPitchEngine {
  private config: PitchEngineConfig;
  private windowBuffer: Float32Array;
  private windowR: Float32Array; // Autocorrelation of the window function

  constructor(config: Partial<PitchEngineConfig> = {}) {
    this.config = {
      sampleRate: config.sampleRate || 44100,
      pitchFloor: config.pitchFloor || 70,       // Supports down to D2 (~73Hz)
      pitchCeiling: config.pitchCeiling || 950,   // Supports up to Bb5 (~932Hz)
      voicingThreshold: config.voicingThreshold || 0.38,
      silenceThreshold: config.silenceThreshold || 0.012,
      octaveCost: config.octaveCost || 0.01
    };

    const maxWindowSize = 4096;
    this.windowBuffer = new Float32Array(maxWindowSize);
    this.windowR = new Float32Array(maxWindowSize);
    this.precomputeWindow(2048);
  }

  public updateConfig(newConfig: Partial<PitchEngineConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Precomputes Hanning window and its exact normalized autocorrelation.
   * This is key to Praat's algorithm: dividing the signal autocorrelation by the 
   * window's autocorrelation prevents attenuation at larger lags (lower pitches).
   */
  private precomputeWindow(windowLength: number) {
    if (this.windowBuffer.length < windowLength) {
      this.windowBuffer = new Float32Array(windowLength);
      this.windowR = new Float32Array(windowLength);
    }

    // 1. Generate Hanning window
    for (let i = 0; i < windowLength; i++) {
      this.windowBuffer[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowLength - 1)));
    }

    // 2. Compute Autocorrelation of the window function: r_w(tau)
    for (let tau = 0; tau < windowLength; tau++) {
      let sum = 0.0;
      for (let i = 0; i < windowLength - tau; i++) {
        sum += this.windowBuffer[i] * this.windowBuffer[i + tau];
      }
      this.windowR[tau] = sum;
    }

    // Normalize so that windowR[0] = 1.0
    const r0 = this.windowR[0];
    if (r0 > 0) {
      for (let tau = 0; tau < windowLength; tau++) {
        this.windowR[tau] /= r0;
      }
    }
  }

  /**
   * Analyzes an audio buffer frame and extracts pitch with 1-cent accuracy.
   */
  public analyzeFrame(samples: Float32Array, timestamp: number = 0, enharmonic: 'sharp' | 'flat' = 'sharp'): PitchFrame {
    const N = samples.length;
    if (N < 256) {
      return this.emptyFrame(timestamp);
    }

    if (this.windowBuffer.length !== N) {
      this.precomputeWindow(N);
    }

    // 1. Calculate RMS intensity & remove DC bias
    let sumSquares = 0.0;
    let mean = 0.0;
    for (let i = 0; i < N; i++) {
      mean += samples[i];
    }
    mean /= N;

    for (let i = 0; i < N; i++) {
      const centered = samples[i] - mean;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / N);

    // Silence detection
    if (rms < this.config.silenceThreshold) {
      return this.emptyFrame(timestamp, rms);
    }

    // 2. Apply window to DC-centered frame
    const windowed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      windowed[i] = (samples[i] - mean) * this.windowBuffer[i];
    }

    // 3. Compute raw autocorrelation of windowed signal
    const minLag = Math.max(2, Math.floor(this.config.sampleRate / this.config.pitchCeiling));
    const maxLag = Math.min(N - 2, Math.floor(this.config.sampleRate / this.config.pitchFloor));

    let zeroLagEnergy = 0.0;
    for (let i = 0; i < N; i++) {
      zeroLagEnergy += windowed[i] * windowed[i];
    }
    if (zeroLagEnergy === 0) {
      return this.emptyFrame(timestamp, rms);
    }

    const r = new Float32Array(maxLag + 2);
    r[0] = 1.0;

    for (let tau = 1; tau <= maxLag + 1; tau++) {
      let sum = 0.0;
      for (let i = 0; i < N - tau; i++) {
        sum += windowed[i] * windowed[i + tau];
      }

      // Praat normalization: divide by window autocorrelation to cancel tapering
      const wR = this.windowR[tau];
      if (wR > 0.01) {
        r[tau] = sum / (zeroLagEnergy * wR);
      } else {
        r[tau] = 0.0;
      }
    }

    // 4. Find candidates with parabolic and sinc interpolation
    interface Candidate {
      tau: number;
      strength: number;
    }
    const candidates: Candidate[] = [];
    let maxStrength = 0;

    for (let tau = minLag; tau <= maxLag; tau++) {
      // Local peak test
      if (r[tau] > r[tau - 1] && r[tau] >= r[tau + 1] && r[tau] > 0.5 * this.config.voicingThreshold) {
        // Parabolic refinement
        const dr = 0.5 * (r[tau + 1] - r[tau - 1]);
        const d2r = (r[tau] - r[tau - 1]) + (r[tau] - r[tau + 1]);
        
        let refinedTau = tau;
        if (d2r > 0) {
          refinedTau = tau + dr / d2r;
        }

        // Sinc interpolation around refinedTau for sub-sample continuous accuracy
        const sincRefinedStrength = this.sincInterpolate(r, refinedTau);
        if (sincRefinedStrength > maxStrength) {
          maxStrength = sincRefinedStrength;
        }

        candidates.push({
          tau: refinedTau,
          strength: sincRefinedStrength
        });
      }
    }

    if (candidates.length === 0 || maxStrength < this.config.voicingThreshold) {
      return this.emptyFrame(timestamp, rms);
    }

    // Praat Fundamental Lag Selection:
    // The earliest candidate (highest frequency) within 82% of max correlation peak
    // is the true fundamental period, preventing sub-octave multiples (2T, 3T, 4T).
    const fundamental = candidates.find(c => c.strength >= 0.82 * maxStrength) || candidates[0];

    const bestTau = fundamental.tau;
    const bestStrength = fundamental.strength;

    const frequency = this.config.sampleRate / bestTau;
    const noteInfo = PraatPitchEngine.frequencyToNote(frequency, enharmonic);

    return {
      timestamp,
      frequency,
      exactMidi: noteInfo.exactMidi,
      nearestMidi: noteInfo.nearestMidi,
      noteName: noteInfo.noteName,
      cents: noteInfo.cents,
      voiced: true,
      strength: Math.min(1.0, Math.max(0.0, bestStrength)),
      intensity: rms
    };
  }

  /**
   * Sinc interpolation for exact peak height and sub-sample lag estimation.
   */
  private sincInterpolate(r: Float32Array, t: number): number {
    const intT = Math.round(t);
    const radius = 6; // Sinc window radius
    let sum = 0.0;
    let weightSum = 0.0;

    for (let i = intT - radius; i <= intT + radius; i++) {
      if (i >= 0 && i < r.length) {
        const x = Math.PI * (t - i);
        let sinc = 1.0;
        if (Math.abs(x) > 1e-6) {
          sinc = Math.sin(x) / x;
        }
        // Blackman window weighting on sinc kernel
        const bw = 0.42 - 0.5 * Math.cos((2 * Math.PI * (i - (intT - radius))) / (2 * radius)) +
                          0.08 * Math.cos((4 * Math.PI * (i - (intT - radius))) / (2 * radius));
        sum += r[i] * sinc * bw;
        weightSum += sinc * bw;
      }
    }

    return weightSum > 0 ? sum / weightSum : r[Math.min(r.length - 1, Math.max(0, intT))];
  }

  private emptyFrame(timestamp: number, intensity: number = 0): PitchFrame {
    return {
      timestamp,
      frequency: 0,
      exactMidi: 0,
      nearestMidi: 0,
      noteName: '—',
      cents: 0,
      voiced: false,
      strength: 0,
      intensity
    };
  }

  /**
   * Maps frequency in Hz to musical note with 1-cent exact precision.
   * A4 = 440 Hz = MIDI 69.
   */
  public static frequencyToNote(freqHz: number, enharmonic: 'sharp' | 'flat' = 'sharp') {
    if (freqHz <= 0) {
      return { exactMidi: 0, nearestMidi: 0, noteName: '—', octave: 0, cents: 0 };
    }

    // MIDI = 69 + 12 * log2(freq / 440)
    const exactMidi = 69 + 12 * (Math.log(freqHz / 440) / Math.LN2);
    const nearestMidi = Math.round(exactMidi);
    
    // Cents offset = (exactMidi - nearestMidi) * 100
    // 1 cent precision guaranteed
    const cents = Math.round((exactMidi - nearestMidi) * 100 * 10) / 10;

    const noteIndex = ((nearestMidi % 12) + 12) % 12;
    const octave = Math.floor(nearestMidi / 12) - 1;
    const nameTable = enharmonic === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
    const noteName = `${nameTable[noteIndex]}${octave}`;

    return {
      exactMidi,
      nearestMidi,
      noteName,
      octave,
      cents
    };
  }

  /**
   * Converts MIDI number back to Frequency (Hz)
   */
  public static midiToFrequency(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
}
