/**
 * Local IndexedDB Storage using Dexie.js
 * 
 * Supports storing multi-track audio blobs, precomputed Praat pitch frames,
 * user recordings, harmony presets, and preferences offline across all devices.
 */

import Dexie, { Table } from 'dexie';
import { PitchFrame } from '../audio/PraatPitchEngine';
import { ScoreNote } from '../score/types';

export interface StoredAudioTrack {
  id?: number;
  trackIndex: number;
  name: string;
  audioBlob: Blob;
  pitchFramesJson: string; // JSON serialized PitchFrame[]
  analysisVersion?: number; // Pitch analysis algorithm version used to produce the frames
  source?: 'audio' | 'score';
  scoreVersion?: number;
  scoreNotes?: ScoreNote[];
  isPolyphonic?: boolean;
  visible?: boolean;
  color: string;
  volume: number;
  updatedAt: Date;
}

export interface UserPreferences {
  key: string;
  value: string;
}

export class VocalTunerDB extends Dexie {
  tracks!: Table<StoredAudioTrack, number>;
  preferences!: Table<UserPreferences, string>;

  constructor() {
    super('VocalTunerDatabase');
    this.version(1).stores({
      tracks: '++id, trackIndex, name, updatedAt',
      preferences: 'key'
    });
  }

  public async saveTrack(index: number, name: string, audioBlob: Blob, frames: PitchFrame[], color: string, volume: number, analysisVersion?: number,
    metadata: Pick<StoredAudioTrack, 'source' | 'scoreVersion' | 'scoreNotes' | 'isPolyphonic' | 'visible'> = {}) {
    const existing = await this.tracks.where('trackIndex').equals(index).first();
    const data: StoredAudioTrack = {
      trackIndex: index,
      name,
      audioBlob,
      pitchFramesJson: JSON.stringify(frames),
      analysisVersion,
      source: 'audio',
      ...metadata,
      color,
      volume,
      updatedAt: new Date()
    };

    if (existing && existing.id) {
      await this.tracks.put({ ...data, id: existing.id });
    } else {
      await this.tracks.add(data);
    }
  }

  public async getTrack(index: number): Promise<{ track: StoredAudioTrack, frames: PitchFrame[] } | null> {
    const track = await this.tracks.where('trackIndex').equals(index).first();
    if (!track) return null;
    try {
      const frames = JSON.parse(track.pitchFramesJson) as PitchFrame[];
      return { track, frames };
    } catch {
      return null;
    }
  }

  public async clearTrack(index: number) {
    await this.tracks.where('trackIndex').equals(index).delete();
  }

  public async setVisibility(index: number, visible: boolean) {
    await this.tracks.where('trackIndex').equals(index).modify({ visible });
  }
}

export const db = new VocalTunerDB();
