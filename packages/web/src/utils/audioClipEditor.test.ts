import { describe, it, expect } from 'vitest';
import {
  computeWaveformPeaks,
  findPeakAmplitude,
  trimAndNormalizeToWav,
} from './audioClipEditor';

function makeFakeBuffer(samples: number[], sampleRate = 8000): AudioBuffer {
  const data = new Float32Array(samples);
  return {
    sampleRate,
    length: data.length,
    duration: data.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => data,
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

describe('audioClipEditor', () => {
  it('computes waveform peaks across buckets', () => {
    const buf = makeFakeBuffer([0, 0.2, 0.8, 0.1, 0, -0.5, 0.1, 0.05]);
    const peaks = computeWaveformPeaks(buf, 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.2, 3);
    expect(peaks[1]).toBeCloseTo(0.8, 3);
    expect(peaks[2]).toBeCloseTo(0.5, 3);
    expect(peaks[3]).toBeCloseTo(0.1, 3);
  });

  it('finds peak amplitude within a sub-range', () => {
    const buf = makeFakeBuffer([0.1, 0.2, 0.9, -0.4, 0.1, 0.1, 0.1, 0.1], 8);
    // Samples 4..8 (peak 0.1)
    expect(findPeakAmplitude(buf, 4, 8)).toBeCloseTo(0.1, 3);
    // Samples 0..4 (peak 0.9)
    expect(findPeakAmplitude(buf, 0, 4)).toBeCloseTo(0.9, 3);
  });

  it('trims and normalizes audio into a valid 16-bit PCM WAV blob', async () => {
    // 1 second of 8kHz quiet signal (peak 0.1)
    const samples = new Array(8000).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1));
    const buf = makeFakeBuffer(samples, 8000);

    const { blob, durationMs } = trimAndNormalizeToWav(buf, 0.25, 0.75, true);
    expect(durationMs).toBe(500);
    expect(blob.type).toBe('audio/wav');

    const ab = await blob.arrayBuffer();
    const view = new DataView(ab);
    // RIFF header
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE');
    // 4000 samples * 2 bytes + 44 header bytes
    expect(ab.byteLength).toBe(44 + 4000 * 2);

    // Normalized peak should be close to 0.891 * 32767 (~29195)
    const firstSample = Math.abs(view.getInt16(44, true));
    expect(firstSample).toBeGreaterThan(28000);
    expect(firstSample).toBeLessThanOrEqual(32767);
  });
});
