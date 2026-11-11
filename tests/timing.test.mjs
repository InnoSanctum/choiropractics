import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './load-typescript.mjs';

const { normalizeTrackOffset, sourcePlacement, songDuration, trackEnd, referenceFrameAt, shiftNoteTimes, barStartSeconds, dragTrackOffset } = loadTypescript('src/audio/TrackTiming.ts');
const { visibleDiagramTracks, emptyTrack } = loadTypescript('src/audio/TrackState.ts');
const clip = (offset = 0, duration = 12) => ({ ...emptyTrack(0), startOffset: offset, duration, audioBuffer: { duration } });

test('a late part waits until its entry, including seeks before, inside, and after it', () => {
  const part = clip(8);
  assert.deepEqual(sourcePlacement(part, 0, 1), { delay: 8, sourceOffset: 0 });
  assert.deepEqual(sourcePlacement(part, 5, 1), { delay: 3, sourceOffset: 0 });
  assert.deepEqual(sourcePlacement(part, 10, 1), { delay: 0, sourceOffset: 2 });
  assert.equal(sourcePlacement(part, 20, 1), null);
});

test('negative offsets trim the recording and delayed entries scale with playback speed', () => {
  assert.deepEqual(sourcePlacement(clip(-3), 0, 1), { delay: 0, sourceOffset: 3 });
  assert.deepEqual(sourcePlacement(clip(-3), 2, 0.5), { delay: 0, sourceOffset: 5 });
  assert.deepEqual(sourcePlacement(clip(8), 2, 0.5), { delay: 12, sourceOffset: 0 });
  assert.deepEqual(sourcePlacement(clip(8), 2, 2), { delay: 3, sourceOffset: 0 });
});

test('the song duration includes delayed endings and excludes trimmed/empty clips', () => {
  assert.equal(songDuration([clip(8), clip(-3)]), 20);
  assert.equal(trackEnd(clip(-3)), 9);
  assert.equal(songDuration([clip(-13)]), 0);
  assert.equal(songDuration([{ ...clip(100), audioBuffer: null }]), 0);
});

test('reference pitch uses source time and is silent before the entrance and after the shifted end', () => {
  const part = { ...clip(8), pitchFrames: [{ timestamp: 0.02, voiced: true, frequency: 440 }, { timestamp: 1.02, voiced: true, frequency: 493.88 }] };
  assert.equal(referenceFrameAt(part, 7.99), null);
  assert.equal(referenceFrameAt(part, 8.02).frequency, 440);
  assert.equal(referenceFrameAt(part, 9.02).frequency, 493.88);
  assert.equal(referenceFrameAt(part, 20), null);
  assert.equal(referenceFrameAt({ ...part, startOffset: -1 }, 0.02).frequency, 493.88);
  assert.equal(part.pitchFrames[0].timestamp, 0.02);
});

test('harmonies, mistake targets and overview notes can shift without modifying source data', () => {
  const original = [{ startTime: 0, endTime: 1, midi: 69 }, { startTime: 2, endTime: 3, midi: 72 }];
  assert.deepEqual(shiftNoteTimes(original, 8), [{ startTime: 8, endTime: 9, midi: 69 }, { startTime: 10, endTime: 11, midi: 72 }]);
  assert.deepEqual(original[0], { startTime: 0, endTime: 1, midi: 69 });
});

test('bar 8 and bar 16 use the current tempo and beats per bar from timeline zero', () => {
  assert.equal(barStartSeconds(1, 120, 4), 0);
  assert.equal(barStartSeconds(8, 120, 4), 14);
  assert.equal(barStartSeconds(16, 120, 4), 30);
  assert.equal(barStartSeconds(8, 60, 3), 21);
  assert.throws(() => barStartSeconds(0, 120, 4));
  assert.throws(() => barStartSeconds(8, 0, 4));
});

test('mouse/touch dragging is independent of zoom and can snap to a beat', () => {
  assert.equal(dragTrackOffset(2, 50, 8 / 400), 3);
  assert.equal(dragTrackOffset(2, 100, 4 / 400), 3);
  assert.equal(dragTrackOffset(0, -50, 0.02), -1);
  assert.equal(dragTrackOffset(2, 37, 0.02, 0.5), 2.5);
  assert.equal(normalizeTrackOffset(NaN), 0);
  assert.equal(normalizeTrackOffset(999999), 3600);
});

test('an alignment preview reveals a hidden practice part without changing visibility preferences', () => {
  const hidden = { ...clip(), visible: false };
  assert.equal(visibleDiagramTracks([hidden], false, null).length, 0);
  assert.equal(visibleDiagramTracks([hidden], false, null, 0)[0].visible, true);
  assert.equal(hidden.visible, false);
  assert.equal(visibleDiagramTracks([hidden], true, 1, 0).length, 0);
});
