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
  centsDiff: number;           // Mic minus Target in cents (smoothed; held while changes stay within the precision)
  needleCents?: number;        // Smoothed (unrounded) cents for the gauge needle
  suggestion: string;          // Human-readable action: e.g. "Sing Higher ↑ (+24c)"
  targetNote: string;          // e.g. "G4"
  micNote: string;             // e.g. "F#4"
  inTunePercentage: number;    // Rolling accuracy score (0 - 100%)
  targetHz: number;
  micHz: number;
}

const SMOOTHING = 0.35;      // EMA weight of a new frame (~120 ms time constant at ~46 ms frames)
const RESET_JUMP_CENTS = 60; // A jump this large (new note) restarts the smoothing

export class PitchComparator {
  /**
   * Precision in cents (1-10): changes smaller than this are not registered (the reading is held),
   * and it is the in-tune window (±). 10 = relaxed and calm, 1 = strict and fine-grained.
   */
  public toleranceCents: number = 10;

  // Smoothing state
  private smoothed: number | null = null;
  private smoothedTarget: number | null = null;
  private held: number | null = null; // reading shown to the singer (dead band of ±precision)
  
  // Rolling accuracy stats
  private inTuneFrames: number = 0;
  private totalVoicedFrames: number = 0;
  private recentScores: boolean[] = [];
  private maxHistory: number = 150; // ~3-5 seconds rolling window

  public resetScore() {
    this.smoothed = null;
    this.held = null;
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
      this.smoothed = null;
      this.held = null;
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
      this.smoothed = null;
      this.held = null;
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

    // Cent difference, smoothed over ~0.12 s so natural voice wobble does not make it jump.
    // Restart the smoothing when the target note changes or the voice jumps to another note.
    const rawCents = (micFrame.exactMidi - targetMidi) * 100;
    const targetKey = Math.round(targetMidi);
    if (this.smoothed === null || this.smoothedTarget !== targetKey || Math.abs(rawCents - this.smoothed) > RESET_JUMP_CENTS) {
      this.smoothed = rawCents;
      this.held = null; // new note: register it immediately
    } else {
      this.smoothed += SMOOTHING * (rawCents - this.smoothed);
    }
    this.smoothedTarget = targetKey;

    // Dead band: the reading only moves when the pitch has changed by more than the precision.
    // Wobble inside the band is not registered at all.
    const step = Math.max(1, Math.min(10, this.toleranceCents));
    if (this.held === null || Math.abs(this.smoothed - this.held) > step) {
      this.held = this.smoothed;
    }
    const reading = this.held;
    const centsDiff = Math.round(reading) || 0;

    let status: PitchAccuracyStatus = 'in_tune';
    let suggestion = '✓ In tune';

    // Show small errors in cents, large ones in semitones
    const amount = Math.abs(centsDiff) >= 100
      ? `${Math.round(Math.abs(centsDiff) / 100)} semitone${Math.round(Math.abs(centsDiff) / 100) === 1 ? '' : 's'}`
      : `${Math.abs(centsDiff)}c`;
    if (reading > step) {
      status = 'sharp';
      suggestion = `Sing Lower ↓ (${amount} sharp)`;
    } else if (reading < -step) {
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
      needleCents: reading,
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
