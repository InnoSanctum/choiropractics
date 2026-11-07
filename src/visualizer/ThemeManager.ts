/**
 * Theme & Note Display Configurations
 */

export type ThemeId = 'dark_studio' | 'clean_light' | 'oled_midnight' | 'warm_sunset';
export type NoteLabelMode = 'cs_only' | 'flats_only' | 'all_notes';

export interface ThemeColors {
  id: ThemeId;
  name: string;
  bgMain: string;
  bgPanel: string;
  gridLineSemitone: string;
  gridLineOctave: string;
  gridText: string;
  gridTextOctave: string;
  playhead: string;
  micTrail: string;
  cardBg: string;
  border: string;
}

export const THEMES: Record<ThemeId, ThemeColors> = {
  dark_studio: {
    id: 'dark_studio',
    name: 'Dark Studio',
    bgMain: '#0b111e',        // Deep navy slate
    bgPanel: '#111827',
    gridLineSemitone: 'rgba(255, 255, 255, 0.04)',
    gridLineOctave: 'rgba(255, 255, 255, 0.15)',
    gridText: 'rgba(148, 163, 184, 0.45)',
    gridTextOctave: '#94a3b8',
    playhead: '#38bdf8',       // Bright cyan
    micTrail: '#f43f5e',       // Vivid rose / pink
    cardBg: '#131d31',
    border: '#1e293b'
  },
  clean_light: {
    id: 'clean_light',
    name: 'Clean Light',
    bgMain: '#f8fafc',
    bgPanel: '#ffffff',
    gridLineSemitone: 'rgba(0, 0, 0, 0.05)',
    gridLineOctave: 'rgba(0, 0, 0, 0.18)',
    gridText: 'rgba(100, 116, 139, 0.6)',
    gridTextOctave: '#334155',
    playhead: '#0284c7',
    micTrail: '#e11d48',
    cardBg: '#f1f5f9',
    border: '#cbd5e1'
  },
  oled_midnight: {
    id: 'oled_midnight',
    name: 'OLED Midnight',
    bgMain: '#000000',
    bgPanel: '#0a0a0a',
    gridLineSemitone: 'rgba(255, 255, 255, 0.06)',
    gridLineOctave: 'rgba(255, 255, 255, 0.25)',
    gridText: 'rgba(163, 163, 163, 0.5)',
    gridTextOctave: '#e5e5e5',
    playhead: '#22d3ee',
    micTrail: '#ec4899',
    cardBg: '#121212',
    border: '#262626'
  },
  warm_sunset: {
    id: 'warm_sunset',
    name: 'Warm Sunset',
    bgMain: '#150d1e',
    bgPanel: '#211330',
    gridLineSemitone: 'rgba(255, 255, 255, 0.04)',
    gridLineOctave: 'rgba(244, 114, 182, 0.25)',
    gridText: 'rgba(216, 180, 254, 0.45)',
    gridTextOctave: '#f472b6',
    playhead: '#fbbf24',
    micTrail: '#f87171',
    cardBg: '#271738',
    border: '#3b2154'
  }
};
