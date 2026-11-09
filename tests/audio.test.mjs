import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './load-typescript.mjs';

const { MultiTrackMixer } = loadTypescript('src/audio/MultiTrackMixer.ts');
const { PitchComparator } = loadTypescript('src/audio/PitchComparator.ts');

class AudioContextStub {
  state = 'running';
  currentTime = 0;
  destination = {};
  gains = [];
  sources = [];
  createGain() {
    const gain = { value: 1, cancelScheduledValues() {},
      setTargetAtTime(value) { this.value = value; },
      setValueAtTime(value) { this.value = value; } };
    const node = { gain, connect() {} };
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() {},
      start(...args) { this.startArgs = args; } };
    this.sources.push(source);
    return source;
  }
  createOscillator() {
    return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
}

globalThis.window = { AudioContext: AudioContextStub, setInterval: () => 1, clearInterval() {} };
globalThis.requestAnimationFrame = () => 1;

function track(index, overrides = {}) {
  return { id: `track-${index}`, index, name: `Part ${index + 1}`, audioBuffer: { duration: 12 },
    pitchFrames: [], volume: 0.8, muted: false, solo: false, color: '#fff', isMain: index === 0,
    isAnalyzing: false, analysisProgress: 100, duration: 12, ...overrides };
}
function setup(tracks) {
  const mixer = new MultiTrackMixer();
  mixer.initTrackChannels(tracks.length);
  const ctx = mixer.getAudioContext();
  // First node is the master gain; remaining nodes are the track channels.
  const gains = () => ctx.gains.slice(1).map(n => n.gain.value);
  return { mixer, ctx, gains };
}

test('practice keeps the normal mute, solo, and volume matrix', () => {
  const tracks = [track(0), track(1, { solo: true, volume: 0.35 }), track(2, { muted: true, solo: true })];
  const { mixer, gains } = setup(tracks);
  mixer.updateGainMatrix(tracks);
  assert.deepEqual(gains(), [0, 0.35, 0]);
});

test('training silences its target even when soloed, without blocking the backing voices', () => {
  const tracks = [track(0, { solo: true }), track(1, { volume: 0.4 }), track(2, { muted: true })];
  const { mixer, gains } = setup(tracks);
  mixer.trainingTrackIndex = 0;
  mixer.playAll(tracks);
  assert.deepEqual(gains(), [0, 0.4, 0]);
  assert.equal(tracks[0].muted, false);
  assert.equal(tracks[0].solo, true);
});

test('backing solos and mutes are honored; empty slots do not take over the solo matrix', () => {
  const tracks = [track(0), track(1, { solo: true }), track(2), track(3, { solo: true, audioBuffer: null })];
  const { mixer, gains } = setup(tracks);
  mixer.trainingTrackIndex = 0;
  mixer.updateGainMatrix(tracks);
  assert.deepEqual(gains(), [0, 0.8, 0, 0]);
  tracks[1].muted = true;
  mixer.updateGainMatrix(tracks);
  assert.deepEqual(gains().slice(0, 3), [0, 0, 0]);
});

test('changing the silent part during playback and leaving training restore the saved mix', () => {
  const tracks = [track(0, { volume: 0.25 }), track(1, { volume: 0.6 })];
  const { mixer, gains } = setup(tracks);
  mixer.trainingTrackIndex = 0;
  mixer.playAll(tracks);
  mixer.trainingTrackIndex = 1;
  mixer.updateGainMatrix(tracks);
  assert.deepEqual(gains(), [0.25, 0]);
  assert.equal(mixer.isPlaying, true);
  mixer.trainingTrackIndex = null;
  mixer.updateGainMatrix(tracks);
  assert.deepEqual(gains(), [0.25, 0.6]);
});

test('removing the silent part cannot make its old source audible when a new target is selected', () => {
  const tracks = [track(0), track(1), track(2)];
  const { mixer, gains } = setup(tracks);
  mixer.trainingTrackIndex = 0;
  mixer.playAll(tracks);
  tracks[0].audioBuffer = null;
  mixer.trainingTrackIndex = 1;
  mixer.updateGainMatrix(tracks);
  assert.deepEqual(gains(), [0, 0, 0.8]);
});

test('the silent reference keeps the full timeline, including when all backing parts are muted', () => {
  const tracks = [track(0), track(1, { muted: true, audioBuffer: { duration: 3 }, duration: 3 })];
  const { mixer, ctx, gains } = setup(tracks);
  mixer.trainingTrackIndex = 0;
  mixer.playAll(tracks, 4);
  assert.deepEqual(gains(), [0, 0]);
  assert.equal(ctx.sources.length, 1); // Seeking beyond the end of a short backing part is safe.
  ctx.currentTime = 2.06;
  assert.equal(mixer.getCurrentTime(), 6);
  assert.equal(mixer.pauseAll(), 6);
  mixer.playAll(tracks, 6);
  assert.equal(ctx.sources.at(-1).startArgs[1], 6);
});

test('count-in and half-speed transport retain the silent part and synchronized song time', () => {
  const tracks = [track(0), track(1)];
  const { mixer, ctx, gains } = setup(tracks);
  // Supply the parameter methods needed by the metronome envelopes.
  const createGain = ctx.createGain.bind(ctx);
  ctx.createGain = () => {
    const node = createGain();
    node.gain.exponentialRampToValueAtTime = () => {};
    return node;
  };
  mixer.trainingTrackIndex = 0;
  mixer.playbackRate = 0.5;
  mixer.countInBeats = 2;
  mixer.playAll(tracks, 1, true);
  assert.equal(gains()[0], 0);
  assert.equal(mixer.isCountingIn(), true);
  assert.equal(mixer.getCurrentTime(), 1);
  assert.deepEqual(ctx.sources.map(s => s.startArgs), [[2.06, 1], [2.06, 1]]);
  ctx.currentTime = 4.06;
  assert.equal(mixer.isRunning(), true);
  assert.ok(Math.abs(mixer.getCurrentTime() - 2) < 1e-9);
});

const frame = midi => ({ frequency: 440 * 2 ** ((midi - 69) / 12), exactMidi: midi, voiced: true, noteName: 'A4' });
test('pitch feedback distinguishes in-tune, flat, sharp, and resting reference frames', () => {
  const comparator = new PitchComparator();
  assert.equal(comparator.compare(frame(69), 69, 440, 'A4').status, 'in_tune');
  comparator.resetScore();
  assert.equal(comparator.compare(frame(68.75), 69, 440, 'A4').status, 'flat');
  comparator.resetScore();
  assert.equal(comparator.compare(frame(69.25), 69, 440, 'A4').status, 'sharp');
  assert.equal(comparator.compare(frame(69), 0, 0).status, 'unvoiced_ref');
});

test('paused singing and count-in can update feedback without changing training accuracy', () => {
  const comparator = new PitchComparator();
  assert.equal(comparator.compare(frame(69), 69, 440, 'A4').inTunePercentage, 100);
  for (let i = 0; i < 200; i++) comparator.compare(frame(70), 69, 440, 'A4', false);
  assert.equal(comparator.compare(frame(69), 69, 440, 'A4', false).inTunePercentage, 100);
  comparator.resetScore();
  assert.equal(comparator.compare(frame(70), 69, 440, 'A4').inTunePercentage, 0);
  for (let i = 0; i < 200; i++) comparator.compare(frame(69), 69, 440, 'A4', false);
  assert.equal(comparator.compare(frame(69), 69, 440, 'A4', false).inTunePercentage, 0);
});
