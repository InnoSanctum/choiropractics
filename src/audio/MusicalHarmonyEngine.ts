/**
 * Musical Harmony Engine & Key/Mode Detector
 *
 * Provides:
 * 1. Fixed (chromatic) intervals: always the same number of semitones (octave, P5, M3, ...).
 * 2. Smart (diatonic) intervals: a number of scale steps inside the selected key & mode, so a
 *    "3rd above" is major or minor depending on where the note sits in the scale.
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

export type PresetGroup = 'unison' | 'fixed' | 'smart';

export interface HarmonyPreset {
  id: string;
  name: string;
  group: PresetGroup;
  type: IntervalType;
  semitones: number;       // For chromatic (e.g. +12, -12, +7)
  scaleDegrees: number;    // For diatonic: scale steps (+2 = 3rd above, -2 = 3rd below)
  description: string;
}

const fixed = (id: string, name: string, semitones: number, description: string): HarmonyPreset =>
  ({ id, name, group: 'fixed', type: 'chromatic', semitones, scaleDegrees: 0, description });
const smart = (id: string, name: string, scaleDegrees: number, description: string): HarmonyPreset =>
  ({ id, name, group: 'smart', type: 'diatonic', semitones: 0, scaleDegrees, description });

export const STANDARD_HARMONY_PRESETS: HarmonyPreset[] = [
  { id: 'unison', name: 'Unison (sing the melody)', group: 'unison', type: 'chromatic', semitones: 0, scaleDegrees: 0, description: 'Match the reference track exactly' },

  // Smart, key- and mode-dependent
  smart('diatonic_3rd_up', '3rd above', 2, 'Major or minor 3rd above, whichever fits the key'),
  smart('diatonic_3rd_down', '3rd below', -2, 'Major or minor 3rd below, whichever fits the key'),
  smart('diatonic_4th_up', '4th above', 3, 'Perfect (or augmented on the 4th degree) 4th above, in key'),
  smart('diatonic_4th_down', '4th below', -3, '4th below, in key'),
  smart('diatonic_5th_up', '5th above', 4, 'Perfect (or diminished on the 7th degree) 5th above, in key'),
  smart('diatonic_5th_down', '5th below', -4, '5th below, in key'),
  smart('diatonic_6th_up', '6th above', 5, 'Major or minor 6th above, in key'),
  smart('diatonic_6th_down', '6th below', -5, 'Major or minor 6th below, in key'),

  // Fixed, chromatic
  fixed('octave_up', 'Octave above (+12)', 12, 'One octave higher'),
  fixed('octave_down', 'Octave below (−12)', -12, 'One octave lower'),
  fixed('perfect_5th_up', 'Perfect 5th above (+7)', 7, 'Always 7 semitones higher'),
  fixed('perfect_5th_down', 'Perfect 5th below (−7)', -7, 'Always 7 semitones lower'),
  fixed('perfect_4th_up', 'Perfect 4th above (+5)', 5, 'Always 5 semitones higher'),
  fixed('perfect_4th_down', 'Perfect 4th below (−5)', -5, 'Always 5 semitones lower'),
  fixed('major_3rd_up', 'Major 3rd above (+4)', 4, 'Always 4 semitones higher'),
  fixed('major_3rd_down', 'Major 3rd below (−4)', -4, 'Always 4 semitones lower'),
  fixed('minor_3rd_up', 'Minor 3rd above (+3)', 3, 'Always 3 semitones higher'),
  fixed('minor_3rd_down', 'Minor 3rd below (−3)', -3, 'Always 3 semitones lower'),
  fixed('major_6th_up', 'Major 6th above (+9)', 9, 'Always 9 semitones higher'),
  fixed('minor_6th_up', 'Minor 6th above (+8)', 8, 'Always 8 semitones higher'),
  fixed('custom_chromatic', 'Custom (± semitones)', 0, 'Any fixed number of semitones')
];

// Scale degree intervals relative to root
export const MODE_SCALE_STEPS: Record<MusicalMode, number[]> = {
  major:          [0, 2, 4, 5, 7, 9, 11],
  minor:          [0, 2, 3, 5, 7, 8, 10],
  dorian:         [0, 2, 3, 5, 7, 9, 10],
  mixolydian:     [0, 2, 4, 5, 7, 9, 10],
  phrygian:       [0, 1, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11]
};

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Transposes a MIDI pitch by `steps` scale degrees within the key (root pitch class + mode).
 * Notes outside the scale keep their chromatic alteration relative to the nearest scale note
 * (e.g. F# in C major, 3rd above -> A#). Microtonal deviation (cents) is preserved.
 */
export function transposeDiatonic(midi: number, rootIndex: number, mode: MusicalMode, steps: number): number {
  const scale = MODE_SCALE_STEPS[mode];
  const n = Math.round(midi);
  const cents = midi - n;
  const pc = mod(n - rootIndex, 12);

  // Nearest scale degree using circular (octave-wrapping) distance.
  // Ties resolve to the lower note, i.e. the out-of-scale note is read as a raised degree.
  let degree = 0;
  let alteration = 0;
  let bestDist = Infinity;
  for (let d = 0; d < scale.length; d++) {
    let diff = mod(pc - scale[d], 12);   // 0..11
    if (diff > 6) diff -= 12;              // -5..6
    const dist = Math.abs(diff);
    if (dist < bestDist || (dist === bestDist && diff > 0)) {
      bestDist = dist;
      degree = d;
      alteration = diff;
    }
  }

  const tonic = n - alteration - scale[degree]; // MIDI of the tonic below/at this scale note
  const target = degree + steps;
  const octave = Math.floor(target / 7);
  const targetDegree = mod(target, 7);
  return tonic + scale[targetDegree] + 12 * octave + alteration + cents;
}

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
  public activePreset: HarmonyPreset = STANDARD_HARMONY_PRESETS[0]; // Unison
  public customSemitones: number = 0;

  constructor(rootIndex: number = 0, mode: MusicalMode = 'major') {
    this.rootIndex = rootIndex;
    this.activeMode = mode;
  }

  /** Transposes a MIDI pitch by the active interval. */
  public transposeMidi(refMidi: number): number {
    const preset = this.activePreset;
    if (preset.type === 'chromatic') {
      const semitones = preset.id === 'custom_chromatic' ? this.customSemitones : preset.semitones;
      return refMidi + semitones;
    }
    return transposeDiatonic(refMidi, this.rootIndex, this.activeMode, preset.scaleDegrees);
  }

  /**
   * Calculates the target pitch (in Hz and MIDI) for a given reference pitch,
   * applying either the fixed chromatic interval or the smart in-key interval.
   */
  public computeTargetPitch(refMidi: number, refHz: number): { targetMidi: number, targetHz: number, semitoneDiff: number } {
    if (refHz <= 0 || refMidi <= 0) {
      return { targetMidi: 0, targetHz: 0, semitoneDiff: 0 };
    }
    const targetMidi = this.transposeMidi(refMidi);
    return {
      targetMidi,
      targetHz: PraatPitchEngine.midiToFrequency(targetMidi),
      semitoneDiff: Math.round(targetMidi - refMidi)
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
