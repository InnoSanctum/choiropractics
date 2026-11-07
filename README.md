# Choiropractics (Хоропрактика) 🎶
> **Real-Time Vocal Intonation Trainer & Multi-Track Studio for Choir Singers**

Choiropractics is a high-precision, cross-platform vocal tuner, multi-part rehearsal tool, and ear-training suite designed specifically for choir singers, solo vocalists, and vocal ensembles.

It visualizes pitch in real time on an interactive piano-roll note grid with **1-cent accuracy**, allows uploading up to 6 polyphonic choir parts simultaneously, offers real-time intonation coaching, and features smart diatonic harmony singing assistance.

---

## 🌟 Key Features

### 1. Real-Time Microphone Pitch Tracking (1-Cent Precision)
- **Sub-Cent Frequency Accuracy**: Implements Paul Boersma’s normalized autocorrelation with parabolic and sinc ($\sin(x)/x$) interpolation, measuring continuous pitch deviation within $\pm 0.05\text{ Hz}$ ($< 0.2\text{ cents}$).
- **Hardware Device Selector**: Seamlessly switch between studio USB audio interfaces, external mics, or built-in inputs.
- **Reference Visualization**:
  - Horizontal rounded pills with endpoint connection nodes (`o`) for sustained notes.
  - Smooth cubic bezier transitions connecting note bends, vibrato, and glissandos.
  - Glowing live microphone trail with real-time playhead tracking.

### 2. Multi-Track Choir Rehearsal Engine (Up to 6 Tracks)
- **Simultaneous Synchronized Playback**: Load up to 6 audio stems (Soprano, Alto, Tenor, Bass, Backing Vocals, Piano accompaniment) in MP3, WAV, AAC, FLAC, or M4A format.
- **Console Mixer Matrix**:
  - Independent **Mute (M)** and **Solo (S)** switches.
  - Smooth volume gain sliders ($0-100\%$).
  - **Customizable Track Colors**: Default color palette (Cream, Orange, Amber, Sand, Royal Blue, Emerald Green) plus an integrated hex color picker for every track.
  - **Click-to-Seek Scrubbing**: Scrub anywhere on the canvas timeline with sample-accurate audio sync.

### 3. Dominant Vocal Tone Extraction (Full-Band / Polyphony Filter)
- When rehearsing with polyphonic audio, chords, or full-band accompaniment, our multi-stage pre-filtering pipeline isolates the lead singer's fundamental pitch:
  - **4th-Order Butterworth Vocal Bandpass Filter** ($80\text{ Hz} - 1100\text{ Hz}$).
  - **Dynamic Range Tanh Compression** to suppress sharp drum transients (kick drum, snare, cymbals).
  - **Vocal Range Presets**: *Full Vocal*, *Male Voice*, *Female Voice*, and *Soprano*.

### 4. Real-Time Pitch Coaching HUD
- Select any uploaded track as the **Main Reference Target** (⭐).
- **Cent Deviation Needle**: Dynamic $-50\text{c}$ to $+50\text{c}$ visual gauge with a centered green target zone ($\pm 10\text{ cents}$).
- **Instant Vocal Guidance**:
  - `✓ Perfect Pitch!` (glowing green aura)
  - `Sing Higher ↑` (amber indicator with exact cents flat)
  - `Sing Lower ↓` (purple indicator with exact cents sharp)
- **Intonation Accuracy Gauge**: Continuous rolling percentage score of voiced singing on pitch.

### 5. Smart Diatonic Harmony & Mode-Dependent Interval Training
- **Dynamic Scale/Mode Harmonies**: In choral singing, harmonies are rarely fixed parallel chromatic intervals. Our engine dynamically selects Major or Minor intervals based on the active scale degree:
  - *Diatonic 3rd Above / Below* (dynamically switches between Major and Minor 3rd).
  - *Diatonic 6th Above*.
  - *Chromatic Presets*: Octave Up (+12 st), Octave Down (-12 st), Perfect 5th Up (+7 st), Perfect 5th Down (-7 st), or custom semitones (-24 to +24 st).
- **AI Key & Mode Detection**:
  - Computes the time-weighted Pitch Class Profile (chromagram) from your audio track.
  - Runs the **Krumhansl-Schmuckler** key-finding algorithm across 24 keys and modes (Major, Minor, Dorian, Mixolydian, Phrygian, Harmonic Minor).
  - Surfaces a smart suggestion banner (e.g., *"Detected: G Major (96% match)"*) with a one-click *"Apply Mode"* button.

### 6. Themes & Note Display Preferences
- **Themes**:
  - **Dark Studio** (classic deep slate reference design)
  - **Clean Light** (crisp paper layout)
  - **OLED Midnight** (pure black high-contrast)
  - **Warm Sunset** (dusk aubergine with gold accents)
- **Note Label Modes**:
  - *Cs Only* (clean octave markers C3, C4, C5)
  - *Flats Only* / *Sharps Only*
  - *All Notes*
  - Enharmonic toggle: $\flat$ (Flats) vs. $\sharp$ (Sharps)

### 7. Offline Persistence & Cross-Platform Architecture
- **Offline Storage**: Uses **IndexedDB** (`Dexie.js`) to locally cache audio files, decoded buffers, user recordings, and precomputed pitch trajectories directly on your device.
- **Zero Native Compiler Dependencies**: Built entirely with modern TypeScript, React, and Web Audio API (`AudioWorklet`).
- **Platform Agnostic**: Runs in any modern browser, as an installable **PWA** on iPhone (iOS) and Android, or packaged natively via Capacitor (mobile) and Tauri/Electron (desktop).

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher; v20/v22 recommended)
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/InnoSanctum/choiropractics.git
cd choiropractics

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open `http://localhost:3000` in your browser.

### Production Build

```bash
npm run build
npm run preview
```

---

## 🙏 Acknowledgments & Praat Licensing Kudos

This project stands on the shoulders of giants. The core pitch extraction algorithms in **Choiropractics** are directly inspired by and adapted from the foundational research and software developed by:

- **Paul Boersma** and **David Weenink**  
  *Institute of Phonetic Sciences, University of Amsterdam*  
  [Praat: doing phonetics by computer](https://praat.org) | [GitHub Repository](https://github.com/praat/praat.github.io)

### Mathematical Reference
- **Boersma, Paul (1993)**. *"Accurate short-term analysis of the fundamental frequency and the harmonics-to-noise ratio of a sampled sound."* Proceedings of the Institute of Phonetic Sciences 17: 97–110.

### Key Praat Principles Used in Choiropractics:
1. **Window Autocorrelation Normalization**: Standard autocorrelation suffers from tapering distortion at larger lags (lower pitches). Boersma's technique divides the signal autocorrelation by the autocorrelation of the window function ($r_x(\tau) / r_w(\tau)$), eliminating the bias towards higher frequencies.
2. **Sinc Peak Refinement**: Rather than crude integer lag quantization, parabolic peak estimation combined with sinc ($\sin(x)/x$) interpolation achieves true sub-sample precision ($< 0.05\text{ Hz}$, well within 1 cent).
3. **Octave Jump Suppression**: Dynamic programming (Viterbi path finder) penalizes octave jumps and spurious voiced/unvoiced transitions across frames.

We express our deepest gratitude to Paul Boersma, David Weenink, and the Praat open-source community for their decades of pioneering work in acoustic phonetics and open-source science.

---

## 📄 License

This project is licensed under the [GNU General Public License v3.0 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.en.html), in accordance with the open-source spirit and heritage of Praat.
