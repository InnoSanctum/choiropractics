/**
 * Multi-Track Audio Engine & Mixer
 * 
 * Manages up to 6 audio tracks with simultaneous playback, Solo / Mute matrix,
 * volume controls, and real-time microphone input reading.
 */

import { PitchFrame, PraatPitchEngine } from './PraatPitchEngine';

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

export const DEFAULT_TRACK_COLORS = [
  '#fdf4dc', // 0: Cream / Pale Yellow (Track 1)
  '#f97316', // 1: Vibrant Orange (Track 2)
  '#fbbf24', // 2: Amber Gold (Track 3)
  '#e2d9b6', // 3: Warm Sand (Track 4)
  '#3b82f6', // 4: Royal Blue (Track 5)
  '#10b981', // 5: Emerald Green (Track 6)
];

export class MultiTrackMixer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackNodes: Map<number, { gain: GainNode, source: AudioBufferSourceNode | null }> = new Map();

  // Playback state
  public isPlaying: boolean = false;
  private playbackStartTime: number = 0;
  private startOffset: number = 0;
  private maxDuration: number = 0;

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

  constructor() {
    // AudioContext will be initialized on user interaction
  }

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
        gain.connect(this.masterGain);
        this.trackNodes.set(i, { gain, source: null });
      }
    }
  }

  /**
   * Updates solo/mute matrix across all channels
   */
  public updateGainMatrix(tracks: AudioTrackState[]) {
    const anySolo = tracks.some(t => t.solo);

    for (const track of tracks) {
      const node = this.trackNodes.get(track.index);
      if (!node) continue;

      let effectiveGain = track.volume;
      if (track.muted) {
        effectiveGain = 0;
      } else if (anySolo) {
        effectiveGain = track.solo ? track.volume : 0;
      }

      // Smooth ramp to avoid clicks
      const now = this.getAudioContext().currentTime;
      node.gain.gain.setTargetAtTime(effectiveGain, now, 0.02);
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

  /**
   * Starts simultaneous synchronized playback of all loaded tracks
   */
  public playAll(tracks: AudioTrackState[], offset: number = 0) {
    const ctx = this.getAudioContext();
    this.stopAllSources();

    // Determine max duration
    let maxDur = 0;
    for (const t of tracks) {
      if (t.audioBuffer && t.audioBuffer.duration > maxDur) {
        maxDur = t.audioBuffer.duration;
      }
    }
    this.maxDuration = maxDur;

    if (maxDur === 0) return;

    this.startOffset = Math.max(0, Math.min(offset, maxDur));
    this.playbackStartTime = ctx.currentTime;
    this.isPlaying = true;

    // Start each loaded track
    for (const track of tracks) {
      if (!track.audioBuffer) continue;
      const channel = this.trackNodes.get(track.index);
      if (!channel) continue;

      const source = ctx.createBufferSource();
      source.buffer = track.audioBuffer;
      source.connect(channel.gain);
      channel.source = source;

      source.start(0, this.startOffset);
    }

    this.updateGainMatrix(tracks);
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
  }

  public getCurrentTime(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.startOffset;
    }
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    const current = this.startOffset + elapsed;
    if (this.maxDuration > 0 && current >= this.maxDuration) {
      return this.maxDuration;
    }
    return current;
  }

  private startTickLoop() {
    const tick = () => {
      if (!this.isPlaying) return;
      const current = this.getCurrentTime();
      this.onPlaybackTick?.(current);

      if (this.maxDuration > 0 && current >= this.maxDuration) {
        this.stopAll();
        this.onPlaybackEnded?.();
        return;
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Starts reading from the microphone with Praat pitch extraction
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
        pitchFloor: 70,
        pitchCeiling: 950,
        voicingThreshold: 0.35,
        silenceThreshold: 0.012
      });

      // 2048 sample buffer for high-precision autocorrelation
      const bufferSize = 2048;
      this.micProcessor = ctx.createScriptProcessor(bufferSize, 1, 1);

      this.micProcessor.onaudioprocess = (e) => {
        if (!this.isMicActive || !this.micPitchEngine) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const timestamp = this.getCurrentTime();
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
