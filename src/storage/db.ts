/**
 * Local IndexedDB Storage using Dexie.js
 * 
 * Supports storing multi-track audio blobs, precomputed Praat pitch frames,
 * user recordings, harmony presets, and preferences offline across all devices.
 */

import Dexie, { Table } from 'dexie';
import { PitchFrame } from '../audio/PraatPitchEngine';

export interface StoredAudioTrack {
  id?: number;
  trackIndex: number;
  name: string;
  audioBlob: Blob;
  pitchFramesJson: string; // JSON serialized PitchFrame[]
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

  public async saveTrack(index: number, name: string, audioBlob: Blob, frames: PitchFrame[], color: string, volume: number) {
    const existing = await this.tracks.where('trackIndex').equals(index).first();
    const data: StoredAudioTrack = {
      trackIndex: index,
      name,
      audioBlob,
      pitchFramesJson: JSON.stringify(frames),
      color,
      volume,
      updatedAt: new Date()
    };

    if (existing && existing.id) {
      await this.tracks.update(existing.id, data);
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
}

export const db = new VocalTunerDB();
