/**
 * Audio Filter Pipeline for Vocal Extraction & Dominant Tone Isolation
 * 
 * Used for polyphonic tracks, chords, or full-band audio to suppress
 * low bass rumble (kick drums, bass synth) and high percussion (cymbals, hi-hats),
 * maximizing the fundamental pitch clarity of the lead singer or solo instrument.
 */

export interface FilterSettings {
  enabled: boolean;
  lowCutHz: number;    // High-pass cutoff (e.g. 85 Hz - cuts sub-bass & kick drum)
  highCutHz: number;   // Low-pass cutoff (e.g. 1100 Hz - cuts hi-hats, cymbals, upper harmonics)
  vocalPreset: 'all' | 'male' | 'female' | 'soprano' | 'custom';
}

export class AudioFilter {
  /**
   * Applies a 2-pole cascaded high-pass and low-pass Butterworth IIR filter
   * to a mono buffer of Float32 samples.
   */
  public static filterBandpass(
    samples: Float32Array,
    sampleRate: number,
    lowCut: number = 85,
    highCut: number = 1100
  ): Float32Array {
    const output = new Float32Array(samples.length);
    
    // 1. High-Pass Filter (Butterworth 2nd order)
    const hpOut = AudioFilter.applyBiquad(samples, sampleRate, lowCut, 'highpass');

    // 2. Low-Pass Filter (Butterworth 2nd order)
    const bpOut = AudioFilter.applyBiquad(hpOut, sampleRate, highCut, 'lowpass');

    return bpOut;
  }

  /**
   * Standard Direct Form II Transposed Biquad Filter
   */
  private static applyBiquad(
    input: Float32Array,
    sampleRate: number,
    frequency: number,
    type: 'lowpass' | 'highpass'
  ): Float32Array {
    const n = input.length;
    const output = new Float32Array(n);

    // Filter coefficients calculation
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * Math.SQRT2); // Q = 0.707 (Butterworth maximally flat)

    let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    if (type === 'lowpass') {
      b0 = (1 - cosOmega) / 2;
      b1 = 1 - cosOmega;
      b2 = (1 - cosOmega) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
    } else {
      b0 = (1 + cosOmega) / 2;
      b1 = -(1 + cosOmega);
      b2 = (1 + cosOmega) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
    }

    // Normalize coefficients by a0
    const invA0 = 1.0 / a0;
    b0 *= invA0;
    b1 *= invA0;
    b2 *= invA0;
    a1 *= invA0;
    a2 *= invA0;

    // Filter execution (Direct Form II Transposed)
    let s1 = 0.0;
    let s2 = 0.0;

    for (let i = 0; i < n; i++) {
      const x = input[i];
      const y = b0 * x + s1;
      s1 = b1 * x - a1 * y + s2;
      s2 = b2 * x - a2 * y;
      output[i] = y;
    }

    return output;
  }

  /**
   * Applies non-linear dynamic range compression / spectral softening to suppress
   * sharp percussive transients (drums) before pitch autocorrelation.
   */
  public static softCompress(samples: Float32Array, threshold: number = 0.3): Float32Array {
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const sign = Math.sign(x);
      const absX = Math.abs(x);
      if (absX < threshold) {
        out[i] = x;
      } else {
        // Soft knee saturation: tanh compression
        out[i] = sign * (threshold + (1 - threshold) * Math.tanh((absX - threshold) / (1 - threshold)));
      }
    }
    return out;
  }

  /**
   * Helper to get recommended cutoff bounds for different vocal types
   */
  public static getPresetBounds(preset: 'all' | 'male' | 'female' | 'soprano' | 'custom'): { low: number, high: number } {
    switch (preset) {
      case 'male':
        return { low: 65, high: 600 };     // C2 (~65Hz) to D5 (~587Hz)
      case 'female':
        return { low: 130, high: 950 };    // C3 (~130Hz) to Bb5 (~932Hz)
      case 'soprano':
        return { low: 200, high: 1300 };   // G3 (~196Hz) to E6 (~1318Hz)
      case 'all':
      default:
        return { low: 50, high: 1400 };    // Comprehensive full musical range (piano & vocal ensemble)
    }
  }
}
