/**
 * Client-side Web Audio helpers for the Soundboard mini editor:
 * - Waveform peak extraction for visual trim preview
 * - Precision start/end trimming + loudness (active RMS) normalization with soft peak ceiling (-1 dBFS)
 * - Dependency-free 16-bit PCM WAV encoding
 */

/** Target active RMS loudness (~ -14 dBFS), matching typical voice/soundboard levels. */
export const TARGET_NORMALIZE_RMS = 0.2;
/** Peak ceiling (-1 dBFS) enforced by the soft limiter to prevent clipping. */
export const NORMALIZE_PEAK_CEILING = 0.891;
const SOFT_KNEE_START = 0.8;

export function computeWaveformPeaks(buffer: AudioBuffer, barCount: number): number[] {
  const safeBars = Math.max(1, Math.min(200, Math.floor(barCount)));
  const channelData = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channelData.length / safeBars));
  const peaks: number[] = [];

  for (let i = 0; i < safeBars; i++) {
    const start = i * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
}

/**
 * Computes the peak amplitude across all channels within [startSample, endSample).
 */
export function findPeakAmplitude(buffer: AudioBuffer, startSample: number, endSample: number): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = startSample; i < endSample; i++) {
      const v = Math.abs(data[i] ?? 0);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Computes active RMS loudness across all channels in [startSample, endSample),
 * ignoring near-silent 20 ms windows (< -46 dBFS) so leading/trailing silence
 * doesn't skew perceived loudness.
 */
export function computeActiveRms(buffer: AudioBuffer, startSample: number, endSample: number): number {
  const numChannels = Math.max(1, buffer.numberOfChannels);
  const totalFrames = Math.max(0, endSample - startSample);
  if (totalFrames === 0) return 0;

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  const windowSize = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const silenceGateSq = 0.005 * 0.005; // ~ -46 dBFS
  let activeSumSq = 0;
  let activeCount = 0;
  let globalSumSq = 0;
  let globalCount = 0;

  for (let wStart = startSample; wStart < endSample; wStart += windowSize) {
    const wEnd = Math.min(endSample, wStart + windowSize);
    let wSumSq = 0;
    let wSamples = 0;
    for (let i = wStart; i < wEnd; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const s = channels[ch]![i] ?? 0;
        wSumSq += s * s;
        wSamples++;
      }
    }
    if (wSamples === 0) continue;
    globalSumSq += wSumSq;
    globalCount += wSamples;
    if (wSumSq / wSamples >= silenceGateSq) {
      activeSumSq += wSumSq;
      activeCount += wSamples;
    }
  }

  if (activeCount > 0) {
    return Math.sqrt(activeSumSq / activeCount);
  }
  return globalCount > 0 ? Math.sqrt(globalSumSq / globalCount) : 0;
}

/**
 * Computes the linear gain needed to normalize [startSample, endSample) to
 * TARGET_NORMALIZE_RMS (-14 dBFS), clamped to [0.15, 8.0] (~ -16 dB to +18 dB).
 */
export function computeNormalizeGain(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
): number {
  const rms = computeActiveRms(buffer, startSample, endSample);
  if (rms <= 1e-4) return 1;
  const rawGain = TARGET_NORMALIZE_RMS / rms;
  return Math.max(0.15, Math.min(8, rawGain));
}

/**
 * Soft-limits samples above SOFT_KNEE_START (0.80) smoothly toward NORMALIZE_PEAK_CEILING (-1 dBFS).
 * Linear (zero distortion) below 0.80.
 */
export function softLimitSample(sample: number): number {
  const abs = Math.abs(sample);
  if (abs <= SOFT_KNEE_START) return sample;
  const headroom = NORMALIZE_PEAK_CEILING - SOFT_KNEE_START;
  const limited = SOFT_KNEE_START + headroom * Math.tanh((abs - SOFT_KNEE_START) / headroom);
  return sample < 0 ? -limited : limited;
}

/**
 * Trims `buffer` to `[startSec, endSec]`, optionally applying loudness normalization
 * (-14 dBFS active RMS + soft peak ceiling at -1 dBFS), and encodes the result as a 16-bit PCM WAV Blob.
 */
export function trimAndNormalizeToWav(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  normalize: boolean,
): { blob: Blob; durationMs: number } {
  const sampleRate = buffer.sampleRate;
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const totalSamples = buffer.length;
  const startSample = Math.max(0, Math.min(totalSamples - 1, Math.floor(startSec * sampleRate)));
  const endSample = Math.max(startSample + 1, Math.min(totalSamples, Math.ceil(endSec * sampleRate)));
  const frameCount = endSample - startSample;

  const gain = normalize ? computeNormalizeGain(buffer, startSample, endSample) : 1;

  const bytesPerSample = 2;
  const dataByteLength = frameCount * numChannels * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(arrayBuffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true); // 16-bit
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    const idx = startSample + i;
    for (let ch = 0; ch < numChannels; ch++) {
      const scaled = (channels[ch]![idx] ?? 0) * gain;
      const sample = normalize ? softLimitSample(scaled) : Math.max(-1, Math.min(1, scaled));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return {
    blob: new Blob([arrayBuffer], { type: 'audio/wav' }),
    durationMs: Math.round((frameCount / sampleRate) * 1000),
  };
}
