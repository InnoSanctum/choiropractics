/**
 * Pitch-preserving time stretching (WSOLA - Waveform Similarity Overlap-Add).
 *
 * Used for slowed-down / sped-up practice playback. Every track is stretched with the same
 * frame grid, so multi-track playback stays sample-accurately in sync (unlike several
 * independently running <audio> elements).
 */

export interface TimeStretchProgress {
  (fraction: number): void;
}

/**
 * Stretches audio by `1 / rate` in time without changing pitch.
 * rate 0.5 => twice as long (half speed), rate 2 => half as long.
 */
export async function timeStretch(
  channels: Float32Array[],
  sampleRate: number,
  rate: number,
  onProgress?: TimeStretchProgress
): Promise<Float32Array<ArrayBuffer>[]> {
  const inLen = channels[0]?.length ?? 0;
  if (Math.abs(rate - 1) < 1e-6 || inLen === 0) {
    return channels.map(c => new Float32Array(c));
  }

  // ~46 ms frames, 50% overlap, ±10 ms similarity search
  const N = 2 * Math.round(0.023 * sampleRate);
  const Hs = N / 2;
  const delta = Math.round(0.010 * sampleRate);
  const outLen = Math.ceil(inLen / rate);

  // Periodic Hann: sums to exactly 1 at 50% overlap
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  // Mono mix for the similarity search
  const mono = new Float32Array(inLen);
  for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i] += ch[i] / channels.length;

  const out = channels.map(() => new Float32Array(outLen + N));
  const maxPos = Math.max(0, inLen - N);

  // Normalized cross-correlation of mono[a..a+Hs) with mono[b..b+Hs), decimated by 2
  const similarity = (a: number, b: number) => {
    let dot = 0;
    let energy = 1e-12;
    for (let i = 0; i < Hs; i += 2) {
      const x = mono[a + i];
      dot += x * mono[b + i];
      energy += x * x;
    }
    return dot / Math.sqrt(energy);
  };

  let prevPos = 0;
  const frameCount = Math.ceil(outLen / Hs);
  for (let k = 0; k < frameCount; k++) {
    const outPos = k * Hs;
    let pos: number;

    if (k === 0) {
      pos = 0;
    } else {
      const nominal = Math.round(outPos * rate);
      const natural = Math.min(maxPos, prevPos + Hs); // what would seamlessly continue the last frame
      const lo = Math.max(0, Math.min(maxPos, nominal - delta));
      const hi = Math.max(0, Math.min(maxPos, nominal + delta));

      // Coarse search, then refine around the best coarse candidate
      let best = lo;
      let bestScore = -Infinity;
      for (let p = lo; p <= hi; p += 8) {
        const s = similarity(p, natural);
        if (s > bestScore) { bestScore = s; best = p; }
      }
      const fineLo = Math.max(lo, best - 8);
      const fineHi = Math.min(hi, best + 8);
      for (let p = fineLo; p <= fineHi; p++) {
        const s = similarity(p, natural);
        if (s > bestScore) { bestScore = s; best = p; }
      }
      pos = best;
    }

    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      const n = Math.min(N, inLen - pos);
      for (let i = 0; i < n; i++) dst[outPos + i] += src[pos + i] * win[i];
    }
    prevPos = pos;

    if (k % 400 === 0) {
      onProgress?.(k / frameCount);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // First half-frame only received a rising window: restore its gain
  for (const ch of out) {
    for (let i = 0; i < Hs && i < outLen; i++) {
      const w = win[i];
      if (w > 0.05) ch[i] /= w;
    }
  }

  onProgress?.(1);
  return out.map(ch => ch.slice(0, outLen));
}
