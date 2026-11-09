/**
 * Multi-Track Audio Engine & Mixer
 *
 * Manages up to 6 audio tracks with simultaneous playback, Solo / Mute matrix,
 * volume controls, pitch-preserving playback speed, metronome & count-in,
 * and real-time microphone input reading.
 *
 * Time model: "song time" is the position in the original (unstretched) audio. At playback
 * rate r, one second of wall-clock time advances song time by r seconds.
 */

import { PitchFrame, PraatPitchEngine } from './PraatPitchEngine';
import { timeStretch } from './TimeStretch';

export interface AudioTrackState {
  id: string;
  index: number;
  name: string;
  audioBuffer: AudioBuffer | null;
  pitchFrames: PitchFrame[];
  volume: number;       // 0.0 to 1.0
  muted: boolean;
  solo: boolean;
  color: string;        // Hex color for note grid curve
  isMain: boolean;      // Main reference target for pitch comparison
  isAnalyzing: boolean;
  analysisProgress: number; // 0 to 100%
  duration: number;
}

export interface MetronomeSettings {
  enabled: boolean;
  bpm: number;
  firstBeat: number;    // Song time (s) of a downbeat; beats at firstBeat + n * 60 / bpm
  beatsPerBar: number;
  volume: number;       // 0..1
}

export const DEFAULT_TRACK_COLORS = [
  '#fdf4dc', // 0: Cream / Pale Yellow (Track 1)
  '#f97316', // 1: Vibrant Orange (Track 2)
  '#fbbf24', // 2: Amber Gold (Track 3)
  '#e2d9b6', // 3: Warm Sand (Track 4)
  '#3b82f6', // 4: Royal Blue (Track 5)
  '#10b981', // 5: Emerald Green (Track 6)
];

const MIC_BUFFER_SIZE = 2048;
const SCHEDULE_AHEAD = 0.12;   // s of clicks scheduled in advance
const SCHEDULER_INTERVAL = 25; // ms

export class MultiTrackMixer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackNodes: Map<number, { gain: GainNode, source: AudioBufferSourceNode | null }> = new Map();

  // Playback state
  public isPlaying: boolean = false;
  /** Silent reference part in training mode; its solo switch does not gate the backing parts. */
  public trainingTrackIndex: number | null = null;
  private playbackStartTime: number = 0; // AudioContext time at which song time == startOffset
  private startOffset: number = 0;
  private maxDuration: number = 0;
  private activeRate: number = 1;        // Rate of the currently running playback

  // Playback speed (pitch preserved via pre-stretched buffers)
  public playbackRate: number = 1;
  private stretchCache = new WeakMap<AudioBuffer, Map<number, AudioBuffer>>();

  // Metronome & count-in
  public metronome: MetronomeSettings = { enabled: false, bpm: 120, firstBeat: 0, beatsPerBar: 4, volume: 0.7 };
  public countInBeats: number = 0;
  private schedulerId: number | null = null;
  private lastScheduledBeat: number = -Infinity;
  private scheduledClicks = new Set<OscillatorNode>();

  // Microphone state
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  public isMicActive: boolean = false;
  public selectedMicDeviceId: string = 'default';
  private micPitchEngine: PraatPitchEngine | null = null;

  // Callbacks
  public onMicFrame?: (frame: PitchFrame) => void;
  public onPlaybackTick?: (currentTime: number) => void;
  public onPlaybackEnded?: () => void;

  public getAudioContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Initializes gain nodes for all 6 tracks
   */
  public initTrackChannels(trackCount: number = 6) {
    const ctx = this.getAudioContext();
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.connect(ctx.destination);
    }

    for (let i = 0; i < trackCount; i++) {
      if (!this.trackNodes.has(i)) {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.masterGain);
        this.trackNodes.set(i, { gain, source: null });
      }
    }
  }

  /**
   * Updates solo/mute matrix across all channels
   */
  public updateGainMatrix(tracks: AudioTrackState[]) {
    const anySolo = tracks.some(t => t.audioBuffer && t.index !== this.trainingTrackIndex && t.solo);

    for (const track of tracks) {
      const node = this.trackNodes.get(track.index);
      if (!node) continue;

      let effectiveGain = track.volume;
      if (!track.audioBuffer || track.muted || track.index === this.trainingTrackIndex) {
        effectiveGain = 0;
      } else if (anySolo) {
        effectiveGain = track.solo ? track.volume : 0;
      }

      // Smooth ramp to avoid clicks
      const now = this.getAudioContext().currentTime;
      node.gain.gain.cancelScheduledValues(now);
      if (track.index === this.trainingTrackIndex) {
        // Silence immediately, including when the target changes during playback.
        node.gain.gain.setValueAtTime(0, now);
      } else {
        node.gain.gain.setTargetAtTime(effectiveGain, now, 0.02);
      }
    }
  }

  /**
   * Decodes an uploaded audio file into an AudioBuffer
   */
  public async decodeAudioFile(file: File): Promise<AudioBuffer> {
    const ctx = this.getAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  }

  // ---------------------------------------------------------------------------
  // Playback speed
  // ---------------------------------------------------------------------------

  private rateKey(rate: number) {
    return Math.round(rate * 1000) / 1000;
  }

  /** True if every buffer already has a pitch-preserved version for `rate`. */
  public isRatePrepared(buffers: AudioBuffer[], rate: number): boolean {
    if (Math.abs(rate - 1) < 1e-6) return true;
    const key = this.rateKey(rate);
    return buffers.every(b => this.stretchCache.get(b)?.has(key));
  }

  /**
   * Pre-computes pitch-preserving time-stretched copies of the buffers for `rate`.
   * Results are cached per buffer and rate.
   */
  public async prepareRate(buffers: AudioBuffer[], rate: number, onProgress?: (fraction: number) => void) {
    if (Math.abs(rate - 1) < 1e-6) return;
    const ctx = this.getAudioContext();
    const key = this.rateKey(rate);
    const todo = buffers.filter(b => !this.stretchCache.get(b)?.has(key));

    for (let i = 0; i < todo.length; i++) {
      const buf = todo[i];
      const channels: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
      const stretched = await timeStretch(channels, buf.sampleRate, rate, f => onProgress?.((i + f) / todo.length));
      const out = ctx.createBuffer(buf.numberOfChannels, stretched[0].length, buf.sampleRate);
      stretched.forEach((data, c) => out.copyToChannel(data, c));

      let map = this.stretchCache.get(buf);
      if (!map) {
        map = new Map();
        this.stretchCache.set(buf, map);
      }
      map.set(key, out);
    }
    onProgress?.(1);
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  /** Seconds of wall-clock time per beat at the current tempo and playback speed. */
  private beatWallSeconds() {
    return 60 / Math.max(20, this.metronome.bpm) / this.activeRate;
  }

  /**
   * Starts simultaneous synchronized playback of all loaded tracks.
   * With `withCountIn`, `countInBeats` metronome clicks are played first.
   */
  public playAll(tracks: AudioTrackState[], offset: number = 0, withCountIn: boolean = false) {
    const ctx = this.getAudioContext();
    this.stopAllSources();

    let maxDur = 0;
    for (const t of tracks) {
      if (t.audioBuffer && t.audioBuffer.duration > maxDur) {
        maxDur = t.audioBuffer.duration;
      }
    }
    this.maxDuration = maxDur;
    if (maxDur === 0) return;

    this.activeRate = this.playbackRate;
    this.startOffset = Math.max(0, Math.min(offset, maxDur));

    const countIn = withCountIn ? Math.max(0, Math.round(this.countInBeats)) : 0;
    const beat = this.beatWallSeconds();
    const startAt = ctx.currentTime + 0.06 + countIn * beat;
    this.playbackStartTime = startAt;
    this.updateGainMatrix(tracks);

    for (let k = 0; k < countIn; k++) {
      this.scheduleClick(startAt - (countIn - k) * beat, k % this.metronome.beatsPerBar === 0, true);
    }

    const rate = this.activeRate;
    const key = this.rateKey(rate);
    for (const track of tracks) {
      if (!track.audioBuffer || this.startOffset >= track.audioBuffer.duration) continue;
      const channel = this.trackNodes.get(track.index);
      if (!channel) continue;

      const source = ctx.createBufferSource();
      const stretched = Math.abs(rate - 1) < 1e-6 ? null : this.stretchCache.get(track.audioBuffer)?.get(key);
      if (Math.abs(rate - 1) < 1e-6) {
        source.buffer = track.audioBuffer;
        source.connect(channel.gain);
        source.start(startAt, this.startOffset);
      } else if (stretched) {
        source.buffer = stretched;
        source.connect(channel.gain);
        source.start(startAt, this.startOffset / rate);
      } else {
        // Stretched copy not ready yet: fall back to resampling (pitch shifts)
        source.buffer = track.audioBuffer;
        source.playbackRate.value = rate;
        source.connect(channel.gain);
        source.start(startAt, this.startOffset);
      }
      channel.source = source;
    }

    this.isPlaying = true;
    this.updateGainMatrix(tracks);
    this.lastScheduledBeat = -Infinity;
    this.startScheduler();
    this.startTickLoop();
  }

  /**
   * Pauses all tracks
   */
  public pauseAll(): number {
    const pos = this.getCurrentTime();
    this.stopAllSources();
    this.isPlaying = false;
    this.startOffset = pos;
    return pos;
  }

  /**
   * Stops and resets playback position to 0
   */
  public stopAll() {
    this.stopAllSources();
    this.isPlaying = false;
    this.startOffset = 0;
  }

  private stopAllSources() {
    for (const [, channel] of this.trackNodes) {
      if (channel.source) {
        try {
          channel.source.stop();
          channel.source.disconnect();
        } catch {
          // Ignore if already stopped
        }
        channel.source = null;
      }
    }
    this.stopScheduler();
    for (const osc of this.scheduledClicks) {
      try {
        osc.stop();
      } catch {
        // Already stopped
      }
    }
    this.scheduledClicks.clear();
  }

  /** Moves the paused playhead (used for mic timestamps and the next play). */
  public setPosition(time: number) {
    if (!this.isPlaying) this.startOffset = Math.max(0, time);
  }

  /** Song time (seconds in the original audio) of the playhead. */
  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.startOffset;
    }
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    if (elapsed <= 0) return this.startOffset; // Counting in
    const current = this.startOffset + elapsed * this.activeRate;
    if (this.maxDuration > 0 && current >= this.maxDuration) {
      return this.maxDuration;
    }
    return current;
  }

  /** True while the count-in clicks are playing before the audio starts. */
  public isCountingIn(): boolean {
    return this.isPlaying && !!this.ctx && this.ctx.currentTime < this.playbackStartTime;
  }

  /** Beats left in the count-in (0 when not counting in). */
  public getCountInBeatsRemaining(): number {
    if (!this.isCountingIn() || !this.ctx) return 0;
    return Math.ceil((this.playbackStartTime - this.ctx.currentTime) / this.beatWallSeconds() - 1e-6);
  }

  /** True while song time is actually advancing (playing and past the count-in). */
  public isRunning(): boolean {
    return this.isPlaying && !this.isCountingIn();
  }

  private startTickLoop() {
    const tick = () => {
      if (!this.isPlaying) return;
      const current = this.getCurrentTime();
      this.onPlaybackTick?.(current);

      if (this.maxDuration > 0 && current >= this.maxDuration) {
        this.stopAllSources();
        this.isPlaying = false;
        this.startOffset = this.maxDuration;
        this.onPlaybackEnded?.();
        return;
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------------------
  // Metronome
  // ---------------------------------------------------------------------------

  private startScheduler() {
    this.stopScheduler();
    this.schedulerId = window.setInterval(() => this.scheduleBeats(), SCHEDULER_INTERVAL);
    this.scheduleBeats();
  }

  private stopScheduler() {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  /** Schedules metronome clicks for beats falling in the next SCHEDULE_AHEAD seconds. */
  private scheduleBeats() {
    if (!this.ctx || !this.isPlaying || !this.metronome.enabled) return;
    const { bpm, firstBeat, beatsPerBar } = this.metronome;
    const beatSong = 60 / Math.max(20, bpm);
    const now = this.ctx.currentTime;
    const from = Math.max(now, this.playbackStartTime);
    const to = now + SCHEDULE_AHEAD;
    if (to <= this.playbackStartTime) return;

    const songAt = (ctxTime: number) => this.startOffset + (ctxTime - this.playbackStartTime) * this.activeRate;
    const first = Math.ceil((songAt(from) - firstBeat) / beatSong - 1e-6);
    const last = Math.floor((songAt(to) - firstBeat) / beatSong);

    for (let i = Math.max(first, this.lastScheduledBeat + 1); i <= last; i++) {
      const beatSongTime = firstBeat + i * beatSong;
      if (this.maxDuration > 0 && beatSongTime > this.maxDuration) break;
      const ctxTime = this.playbackStartTime + (beatSongTime - this.startOffset) / this.activeRate;
      this.scheduleClick(ctxTime, ((i % beatsPerBar) + beatsPerBar) % beatsPerBar === 0, false);
      this.lastScheduledBeat = i;
    }
  }

  /** Call after changing metronome settings during playback. */
  public resetMetronomeSchedule() {
    this.lastScheduledBeat = -Infinity;
    if (this.isPlaying) this.scheduleBeats();
  }

  private scheduleClick(time: number, accent: boolean, countIn: boolean) {
    const ctx = this.getAudioContext();
    const t = Math.max(ctx.currentTime, time);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = accent ? 1760 : countIn ? 1320 : 1100;
    const peak = this.metronome.volume * (accent ? 0.9 : 0.55);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
    this.scheduledClicks.add(osc);
    osc.onended = () => {
      this.scheduledClicks.delete(osc);
      gain.disconnect();
    };
  }

  /** Plays one click immediately (tap-tempo feedback). */
  public clickNow(accent = false) {
    const ctx = this.getAudioContext();
    this.scheduleClick(ctx.currentTime + 0.005, accent, false);
  }

  // ---------------------------------------------------------------------------
  // Microphone
  // ---------------------------------------------------------------------------

  /**
   * Starts reading from the microphone with Praat pitch extraction.
   * Frame timestamps are song time, compensated for the analysis buffer delay.
   */
  public async startMicrophone(deviceId?: string): Promise<boolean> {
    try {
      this.stopMicrophone();
      const ctx = this.getAudioContext();

      if (deviceId) {
        this.selectedMicDeviceId = deviceId;
      }

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: this.selectedMicDeviceId !== 'default' ? { exact: this.selectedMicDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micSource = ctx.createMediaStreamSource(this.micStream);

      this.micPitchEngine = new PraatPitchEngine({
        sampleRate: ctx.sampleRate,
        pitchFloor: 60,
        pitchCeiling: 1400,
        voicingThreshold: 0.45,
        silenceThreshold: 0.006
      });

      this.micProcessor = ctx.createScriptProcessor(MIC_BUFFER_SIZE, 1, 1);
      const bufferDelay = MIC_BUFFER_SIZE / 2 / ctx.sampleRate;

      this.micProcessor.onaudioprocess = (e) => {
        if (!this.isMicActive || !this.micPitchEngine) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // The analysed window is centred half a buffer in the past
        const timestamp = Math.max(0, this.getCurrentTime() - (this.isRunning() ? bufferDelay * this.activeRate : 0));
        const frame = this.micPitchEngine.analyzeFrame(inputData, timestamp);
        this.onMicFrame?.(frame);
      };

      this.micSource.connect(this.micProcessor);
      // Route through dummy silent gain to prevent audio loopback into speakers
      const dummyGain = ctx.createGain();
      dummyGain.gain.value = 0;
      this.micProcessor.connect(dummyGain);
      dummyGain.connect(ctx.destination);

      this.isMicActive = true;
      return true;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      this.isMicActive = false;
      return false;
    }
  }

  public stopMicrophone() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor = null;
    }
    this.isMicActive = false;
  }

  /**
   * Lists available audio input devices
   */
  public static async getAvailableInputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }
}
