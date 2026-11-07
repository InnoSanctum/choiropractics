/**
 * Musical Harmony Engine & Key/Mode Detector
 * 
 * Provides:
 * 1. Diatonic mode-dependent interval harmonization (smart 3rds, 5ths, 6ths, 9ths).
 * 2. Chromatic interval harmonization (fixed semitones: +12, -12, +7, etc.).
 * 3. Krumhansl-Schmuckler Key & Mode Detection from pitch trajectories.
 */

import { PitchFrame, PraatPitchEngine } from './PraatPitchEngine';

export type MusicalMode = 
  | 'major'           // Ionian: 0, 2, 4, 5, 7, 9, 11
  | 'minor'           // Aeolian / Natural Minor: 0, 2, 3, 5, 7, 8, 10
  | 'dorian'          // Dorian: 0, 2, 3, 5, 7, 9, 10
  | 'mixolydian'      // Mixolydian: 0, 2, 4, 5, 7, 9, 10
  | 'phrygian'        // Phrygian: 0, 1, 3, 5, 7, 8, 10
  | 'harmonic_minor'; // Harmonic Minor: 0, 2, 3, 5, 7, 8, 11

export type IntervalType =
  | 'chromatic'       // Fixed semitone offset
  | 'diatonic';       // Mode-dependent scale-degree offset

export interface HarmonyPreset {
  id: string;
  name: string;
  type: IntervalType;
  semitones: number;       // For chromatic (e.g. +12, -12, +7)
  scaleDegrees: number;    // For diatonic (e.g. +2 for 3rd above, -2 for 3rd below)
  description: string;
}

export const STANDARD_HARMONY_PRESETS: HarmonyPreset[] = [
  { id: 'octave_up', name: 'Octave Higher (+12 st)', type: 'chromatic', semitones: 12, scaleDegrees: 7, description: 'Double an octave above' },
  { id: 'octave_down', name: 'Octave Lower (-12 st)', type: 'chromatic', semitones: -12, scaleDegrees: -7, description: 'Double an octave below' },
  { id: 'diatonic_3rd_up', name: 'Diatonic 3rd Above (Smart)', type: 'diatonic', semitones: 4, scaleDegrees: 2, description: 'Dynamically selects Major or Minor 3rd based on mode' },
  { id: 'diatonic_3rd_down', name: 'Diatonic 3rd Below (Smart)', type: 'diatonic', semitones: -4, scaleDegrees: -2, description: 'Dynamically selects Major or Minor 3rd below based on mode' },
  { id: 'perfect_5th_up', name: 'Perfect 5th Higher (+7 st)', type: 'chromatic', semitones: 7, scaleDegrees: 4, description: 'Power harmony a 5th above' },
  { id: 'perfect_5th_down', name: 'Perfect 5th Lower (-7 st)', type: 'chromatic', semitones: -7, scaleDegrees: -4, description: 'Foundational 5th below' },
  { id: 'diatonic_6th_up', name: 'Diatonic 6th Above (Smart)', type: 'diatonic', semitones: 9, scaleDegrees: 5, description: 'Lush vocal choir 6th above' },
  { id: 'custom_chromatic', name: 'Custom Interval', type: 'chromatic', semitones: 0, scaleDegrees: 0, description: 'Manual semitone offset' }
];

// Scale degree intervals relative to root
const MODE_SCALE_STEPS: Record<MusicalMode, number[]> = {
  major:          [0, 2, 4, 5, 7, 9, 11],
  minor:          [0, 2, 3, 5, 7, 8, 10],
  dorian:         [0, 2, 3, 5, 7, 9, 10],
  mixolydian:     [0, 2, 4, 5, 7, 9, 10],
  phrygian:       [0, 1, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11]
};

// Krumhansl-Schmuckler Key Profiles for key detection
// Weights for pitch classes [0..11] relative to tonic
const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const ROOT_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface DetectedKeyResult {
  rootIndex: number;     // 0 = C, 1 = C#, etc.
  rootName: string;      // e.g. "G"
  mode: MusicalMode;     // e.g. "major" or "minor"
  confidence: number;    // 0.0 to 1.0 (correlation coefficient)
  fullKeyName: string;   // e.g. "G Major" or "E Minor"
}

export class MusicalHarmonyEngine {
  public rootIndex: number = 0;          // 0 = C
  public activeMode: MusicalMode = 'major';
  public activePreset: HarmonyPreset = STANDARD_HARMONY_PRESETS[2]; // Default to Diatonic 3rd
  public customSemitones: number = 0;

  constructor(rootIndex: number = 0, mode: MusicalMode = 'major') {
    this.rootIndex = rootIndex;
    this.activeMode = mode;
  }

  /**
   * Calculates the target pitch (in Hz and MIDI) for a given reference pitch frame,
   * applying either chromatic interval or smart diatonic mode-dependent interval.
   */
  public computeTargetPitch(refMidi: number, refHz: number): { targetMidi: number, targetHz: number, semitoneDiff: number } {
    if (refHz <= 0 || refMidi <= 0) {
      return { targetMidi: 0, targetHz: 0, semitoneDiff: 0 };
    }

    if (this.activePreset.type === 'chromatic') {
      const semitones = this.activePreset.id === 'custom_chromatic' 
        ? this.customSemitones 
        : this.activePreset.semitones;
      const targetMidi = refMidi + semitones;
      const targetHz = PraatPitchEngine.midiToFrequency(targetMidi);
      return { targetMidi, targetHz, semitoneDiff: semitones };
    }

    // Diatonic mode-dependent interval logic
    const scale = MODE_SCALE_STEPS[this.activeMode];
    const pitchClass = ((Math.round(refMidi) - this.rootIndex) % 12 + 12) % 12;

    // Find closest scale degree
    let closestDegree = 0;
    let minDistance = 999;
    for (let i = 0; i < scale.length; i++) {
      const dist = Math.abs(pitchClass - scale[i]);
      if (dist < minDistance) {
        minDistance = dist;
        closestDegree = i;
      }
    }

    // Shift by requested scale degrees (e.g. +2 for a diatonic third)
    const targetDegree = closestDegree + this.activePreset.scaleDegrees;
    const octaveShift = Math.floor(targetDegree / 7);
    const normalizedTargetDegree = ((targetDegree % 7) + 7) % 7;

    const baseSemitones = scale[normalizedTargetDegree] + (octaveShift * 12);
    const currentSemitones = scale[closestDegree];
    const diatonicSemitoneDiff = baseSemitones - currentSemitones;

    // Add cents microtonal fraction from refMidi
    const centFraction = refMidi - Math.round(refMidi);
    const targetMidi = Math.round(refMidi) + diatonicSemitoneDiff + centFraction;
    const targetHz = PraatPitchEngine.midiToFrequency(targetMidi);

    return {
      targetMidi,
      targetHz,
      semitoneDiff: diatonicSemitoneDiff
    };
  }

  /**
   * Krumhansl-Schmuckler Key-Finding Algorithm
   * Detects the root key and mode from a pre-analyzed track's pitch frames.
   */
  public static detectKeyAndMode(frames: PitchFrame[]): DetectedKeyResult {
    // 1. Build Pitch Class Profile (Chroma histogram weighted by duration & voicing strength)
    const chroma = new Float64Array(12);
    let totalVoicedTime = 0;

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.voiced && f.frequency > 0 && f.strength > 0.4) {
        const pitchClass = Math.round(f.exactMidi) % 12;
        const normalizedPitchClass = (pitchClass + 12) % 12;
        chroma[normalizedPitchClass] += f.strength;
        totalVoicedTime++;
      }
    }

    // Fallback if not enough voiced data
    if (totalVoicedTime < 10) {
      return {
        rootIndex: 0,
        rootName: 'C',
        mode: 'major',
        confidence: 0,
        fullKeyName: 'C Major (Default)'
      };
    }

    // Normalize chroma
    let chromaSum = 0;
    for (let i = 0; i < 12; i++) chromaSum += chroma[i];
    if (chromaSum > 0) {
      for (let i = 0; i < 12; i++) chroma[i] /= chromaSum;
    }

    // 2. Correlate with all 12 Major and 12 Minor Krumhansl-Schmuckler templates
    let bestCorrelation = -999;
    let bestRoot = 0;
    let bestMode: MusicalMode = 'major';

    for (let r = 0; r < 12; r++) {
      // Test Major
      const majorCorr = MusicalHarmonyEngine.pearsonCorrelation(chroma, KRUMHANSL_MAJOR, r);
      if (majorCorr > bestCorrelation) {
        bestCorrelation = majorCorr;
        bestRoot = r;
        bestMode = 'major';
      }

      // Test Minor
      const minorCorr = MusicalHarmonyEngine.pearsonCorrelation(chroma, KRUMHANSL_MINOR, r);
      if (minorCorr > bestCorrelation) {
        bestCorrelation = minorCorr;
        bestRoot = r;
        bestMode = 'minor';
      }
    }

    const rootName = ROOT_NOTE_NAMES[bestRoot];
    const modeName = bestMode === 'major' ? 'Major' : 'Minor';
    const confidence = Math.max(0, Math.min(1.0, (bestCorrelation + 1) / 2));

    return {
      rootIndex: bestRoot,
      rootName,
      mode: bestMode,
      confidence: Math.round(confidence * 100) / 100,
      fullKeyName: `${rootName} ${modeName}`
    };
  }

  private static pearsonCorrelation(chroma: Float64Array, template: number[], rotation: number): number {
    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < 12; i++) {
      meanX += chroma[i];
      meanY += template[i];
    }
    meanX /= 12;
    meanY /= 12;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < 12; i++) {
      const templateVal = template[(i - rotation + 12) % 12];
      const diffX = chroma[i] - meanX;
      const diffY = templateVal - meanY;
      numerator += diffX * diffY;
      denomX += diffX * diffX;
      denomY += diffY * diffY;
    }

    const denominator = Math.sqrt(denomX * denomY);
    return denominator === 0 ? 0 : numerator / denominator;
  }
}
