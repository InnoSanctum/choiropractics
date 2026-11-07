/**
 * Real-Time Pitch Comparator & Coaching Feedback Engine
 * 
 * Compares the microphone input pitch with the reference track (or harmonized target)
 * in real time and computes coaching suggestions (Lower, Higher, On Pitch) with 1-cent precision.
 */

import { PitchFrame } from './PraatPitchEngine';

export type PitchAccuracyStatus = 'in_tune' | 'flat' | 'sharp' | 'unvoiced_mic' | 'unvoiced_ref' | 'idle';

export interface CoachingFeedback {
  status: PitchAccuracyStatus;
  centsDiff: number;           // Mic minus Target in cents (e.g. -24 = 24 cents flat)
  suggestion: string;          // Human-readable action: e.g. "Sing Higher ↑ (+24c)"
  targetNote: string;          // e.g. "G4"
  micNote: string;             // e.g. "F#4"
  inTunePercentage: number;    // Rolling accuracy score (0 - 100%)
  targetHz: number;
  micHz: number;
}

export class PitchComparator {
  public toleranceCents: number = 10; // Cents threshold for "in tune" (typically ±10c)
  
  // Rolling accuracy stats
  private inTuneFrames: number = 0;
  private totalVoicedFrames: number = 0;
  private recentScores: boolean[] = [];
  private maxHistory: number = 150; // ~3-5 seconds rolling window

  public resetScore() {
    this.inTuneFrames = 0;
    this.totalVoicedFrames = 0;
    this.recentScores = [];
  }

  /**
   * Compares the current microphone pitch frame with the reference/target pitch.
   */
  public compare(micFrame: PitchFrame, targetMidi: number, targetHz: number, targetNoteName: string = ''): CoachingFeedback {
    // Both or either unvoiced
    if (!micFrame.voiced || micFrame.frequency <= 0) {
      return {
        status: 'unvoiced_mic',
        centsDiff: 0,
        suggestion: 'Sing to match reference note',
        targetNote: targetNoteName,
        micNote: '—',
        inTunePercentage: this.calculateRollingScore(),
        targetHz,
        micHz: 0
      };
    }

    if (targetHz <= 0 || targetMidi <= 0) {
      return {
        status: 'unvoiced_ref',
        centsDiff: 0,
        suggestion: 'Reference is resting / silent',
        targetNote: '—',
        micNote: micFrame.noteName,
        inTunePercentage: this.calculateRollingScore(),
        targetHz: 0,
        micHz: micFrame.frequency
      };
    }

    // Exact cent difference: 1200 * log2(micFreq / targetFreq)
    const exactMidiDiff = micFrame.exactMidi - targetMidi;
    const centsDiff = Math.round(exactMidiDiff * 100 * 10) / 10; // 1-cent rounded

    let status: PitchAccuracyStatus = 'in_tune';
    let suggestion = '✓ Perfect Pitch!';

    // Show small errors in cents, large ones in semitones
    const amount = Math.abs(centsDiff) >= 100
      ? `${Math.round(Math.abs(centsDiff) / 100)} semitone${Math.round(Math.abs(centsDiff) / 100) === 1 ? '' : 's'}`
      : `${Math.abs(centsDiff)}c`;
    if (centsDiff > this.toleranceCents) {
      status = 'sharp';
      suggestion = `Sing Lower ↓ (${amount} sharp)`;
    } else if (centsDiff < -this.toleranceCents) {
      status = 'flat';
      suggestion = `Sing Higher ↑ (${amount} flat)`;
    }

    // Record score
    const isInTune = status === 'in_tune';
    this.totalVoicedFrames++;
    if (isInTune) this.inTuneFrames++;

    this.recentScores.push(isInTune);
    if (this.recentScores.length > this.maxHistory) {
      this.recentScores.shift();
    }

    return {
      status,
      centsDiff,
      suggestion,
      targetNote: targetNoteName,
      micNote: micFrame.noteName,
      inTunePercentage: this.calculateRollingScore(),
      targetHz,
      micHz: micFrame.frequency
    };
  }

  private calculateRollingScore(): number {
    if (this.recentScores.length === 0) return 100;
    const good = this.recentScores.filter(Boolean).length;
    return Math.round((good / this.recentScores.length) * 100);
  }
}
