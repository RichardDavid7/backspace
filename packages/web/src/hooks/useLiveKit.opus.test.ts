import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Track } from 'livekit-client';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: () => ({}) },
}));

import { buildAudioPublishOptions, resolveEffectiveAudioConfig } from './useLiveKit';
import {
  useVoiceStore,
  DEFAULT_AUDIO_BITRATE_KBPS,
  MIN_AUDIO_BITRATE_KBPS,
  MAX_AUDIO_BITRATE_KBPS,
} from '../stores/voiceStore';

describe('Opus audio publish options & store clamping', () => {
  beforeEach(() => {
    useVoiceStore.setState({
      audioMode: 'voice',
      audioStereo: false,
      audioBitrate: DEFAULT_AUDIO_BITRATE_KBPS,
    });
  });

  it('builds mono voice options with DTX + RED enabled and bitrate in bps', () => {
    const opts = buildAudioPublishOptions({
      audioMode: 'voice',
      audioStereo: false,
      audioBitrate: 64,
    });
    expect(opts).toEqual({
      name: 'microphone',
      source: Track.Source.Microphone,
      audioPreset: { maxBitrate: 64_000 },
      dtx: true,
      red: true,
      forceStereo: false,
    });
  });

  it('disables RED when stereo is enabled in voice mode and sets forceStereo', () => {
    const opts = buildAudioPublishOptions({
      audioMode: 'voice',
      audioStereo: true,
      audioBitrate: 128,
    });
    expect(opts).toEqual({
      name: 'microphone',
      source: Track.Source.Microphone,
      audioPreset: { maxBitrate: 128_000 },
      dtx: true,
      red: false,
      forceStereo: true,
    });
  });

  it('disables DTX and RED in music mode for full-range continuous audio', () => {
    const opts = buildAudioPublishOptions({
      audioMode: 'music',
      audioStereo: true,
      audioBitrate: 320,
    });
    expect(opts).toEqual({
      name: 'microphone',
      source: Track.Source.Microphone,
      audioPreset: { maxBitrate: 320_000 },
      dtx: false,
      red: false,
      forceStereo: true,
    });
  });

  it('clamps audioBitrate to [MIN_AUDIO_BITRATE_KBPS, MAX_AUDIO_BITRATE_KBPS]', () => {
    useVoiceStore.getState().setAudioBitrate(2);
    expect(useVoiceStore.getState().audioBitrate).toBe(MIN_AUDIO_BITRATE_KBPS);

    useVoiceStore.getState().setAudioBitrate(999);
    expect(useVoiceStore.getState().audioBitrate).toBe(MAX_AUDIO_BITRATE_KBPS);

    useVoiceStore.getState().setAudioBitrate(96.4);
    expect(useVoiceStore.getState().audioBitrate).toBe(96);
  });

  it('resolves Automatic bitrate from channel bitrate or instance default, and caps manual to instance max', () => {
    // Auto with channel override follows channel bitrate
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'voice',
        audioStereo: false,
        audioBitrateAuto: true,
        audioBitrate: 32,
        channelAudioBitrateKbps: 192,
        instanceDefaultAudioBitrateKbps: 64,
        instanceMaxAudioBitrateKbps: 256,
      }).audioBitrate,
    ).toBe(192);

    // Auto without channel override follows instance default
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'voice',
        audioStereo: false,
        audioBitrateAuto: true,
        audioBitrate: 32,
        channelAudioBitrateKbps: null,
        instanceDefaultAudioBitrateKbps: 96,
        instanceMaxAudioBitrateKbps: 256,
      }).audioBitrate,
    ).toBe(96);

    // Manual override is capped only at instance max
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'music',
        audioStereo: true,
        audioBitrateAuto: false,
        audioBitrate: 384,
        channelAudioBitrateKbps: 64,
        instanceDefaultAudioBitrateKbps: 64,
        instanceMaxAudioBitrateKbps: 256,
      }).audioBitrate,
    ).toBe(256);
  });

  it('enforces instance and channel Music/Stereo policies', () => {
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'music',
        audioStereo: true,
        audioBitrateAuto: true,
        audioBitrate: 128,
        channelAllowMusicMode: false,
        instanceAllowMusicMode: true,
        instanceAllowStereoAudio: false,
      }),
    ).toEqual({
      audioMode: 'voice',
      audioStereo: false,
      audioBitrate: 64,
    });
  });

  it('enforces full 5-level precedence: Instance → Space → Category → Channel → User', () => {
    // 1. Default bitrate priority: Channel > Category > Space > Instance
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'voice',
        audioStereo: false,
        audioBitrateAuto: true,
        audioBitrate: 32,
        instanceDefaultAudioBitrateKbps: 64,
        spaceAudioBitrateKbps: 96,
        categoryAudioBitrateKbps: 128,
        channelAudioBitrateKbps: 192,
        instanceMaxAudioBitrateKbps: 512,
      }).audioBitrate,
    ).toBe(192);

    // Channel null → falls back to Category
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'voice',
        audioStereo: false,
        audioBitrateAuto: true,
        audioBitrate: 32,
        instanceDefaultAudioBitrateKbps: 64,
        spaceAudioBitrateKbps: 96,
        categoryAudioBitrateKbps: 128,
        channelAudioBitrateKbps: null,
        instanceMaxAudioBitrateKbps: 512,
      }).audioBitrate,
    ).toBe(128);

    // Channel & Category null → falls back to Space
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'voice',
        audioStereo: false,
        audioBitrateAuto: true,
        audioBitrate: 32,
        instanceDefaultAudioBitrateKbps: 64,
        spaceAudioBitrateKbps: 96,
        categoryAudioBitrateKbps: null,
        channelAudioBitrateKbps: null,
        instanceMaxAudioBitrateKbps: 512,
      }).audioBitrate,
    ).toBe(96);

    // 2. Max cap is strict intersection (child cannot exceed parent cap)
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'music',
        audioStereo: true,
        audioBitrateAuto: false,
        audioBitrate: 320,
        instanceMaxAudioBitrateKbps: 256,
        spaceMaxAudioBitrateKbps: 192,
        categoryMaxAudioBitrateKbps: 128,
        channelMaxAudioBitrateKbps: 256, // tries to exceed category's 128 → clamped to 128
      }).audioBitrate,
    ).toBe(128);

    // Space cap clamps category default
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'voice',
        audioStereo: false,
        audioBitrateAuto: true,
        audioBitrate: 64,
        instanceMaxAudioBitrateKbps: 512,
        spaceMaxAudioBitrateKbps: 96,
        categoryAudioBitrateKbps: 160,
      }).audioBitrate,
    ).toBe(96);

    // 3. Music/Stereo disabled at Space or Category cannot be re-enabled by Channel
    expect(
      resolveEffectiveAudioConfig({
        audioMode: 'music',
        audioStereo: true,
        audioBitrateAuto: true,
        audioBitrate: 128,
        instanceAllowMusicMode: true,
        spaceAllowMusicMode: false,
        categoryAllowMusicMode: true,
        channelAllowMusicMode: true,
        instanceAllowStereoAudio: true,
        spaceAllowStereoAudio: true,
        categoryAllowStereoAudio: false,
        channelAllowStereoAudio: true,
      }),
    ).toEqual({
      audioMode: 'voice',
      audioStereo: false,
      audioBitrate: 64,
    });
  });
});
