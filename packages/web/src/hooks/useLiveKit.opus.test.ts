import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Track } from 'livekit-client';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: () => ({}) },
}));

import { buildAudioPublishOptions } from './useLiveKit';
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
});
