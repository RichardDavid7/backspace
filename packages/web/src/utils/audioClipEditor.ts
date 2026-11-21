/**
 * Client-side Web Audio helpers for the Soundboard mini editor:
 * - Waveform peak extraction for visual trim preview
 * - Precision start/end trimming + optional peak normalization (-1 dBFS)
 * - Dependency-free 16-bit PCM WAV encoding
 */

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
 * Trims `buffer` to `[startSec, endSec]`, optionally peak-normalizing to -1 dBFS (~0.891),
 * and encodes the result as a standard 16-bit PCM WAV Blob.
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

  let gain = 1;
  if (normalize) {
    const peak = findPeakAmplitude(buffer, startSample, endSample);
    if (peak > 0.0001) {
      // Target -1 dBFS (~0.891) to maximize perceived loudness without clipping.
      gain = 0.891 / peak;
    }
  }

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
      const sample = (channels[ch]![idx] ?? 0) * gain;
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return {
    blob: new Blob([arrayBuffer], { type: 'audio/wav' }),
    durationMs: Math.round((frameCount / sampleRate) * 1000),
  };
}
