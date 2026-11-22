import { describe, it, expect } from 'vitest';
import { encodeSoundboardPlay, decodeSoundboardPlay, isSafeSoundboardFileUrl } from './soundboardProtocol';

describe('soundboardProtocol', () => {
  it('round-trips a valid soundboard_play payload', () => {
    const encoded = encodeSoundboardPlay({
      soundId: 'snd-1',
      fileUrl: '/api/soundboard/files/abc.wav',
      emoji: '🦆',
      name: 'Quack',
      senderUserId: 'user-1',
      durationMs: 1200,
    });

    const decoded = decodeSoundboardPlay(encoded);
    expect(decoded).toEqual({
      type: 'soundboard_play',
      soundId: 'snd-1',
      fileUrl: '/api/soundboard/files/abc.wav',
      emoji: '🦆',
      name: 'Quack',
      senderUserId: 'user-1',
      durationMs: 1200,
    });
  });

  it('rejects arbitrary, external, or traversal fileUrl values', () => {
    const badUrls = [
      'https://evil.example/track.wav',
      'http://127.0.0.1:8080/api/soundboard/files/a.wav',
      '//evil.example/api/soundboard/files/a.wav',
      '/api/soundboard/files/../uploads/a.wav',
      '/api/soundboard/files/sub/a.wav',
      '/api/soundboard/files/a.wav?tracker=1',
      '/api/soundboard/files/a.wav#frag',
      '/api/soundboard/files/a.exe',
      '',
    ];
    for (const fileUrl of badUrls) {
      expect(isSafeSoundboardFileUrl(fileUrl)).toBe(false);
      const encoded = encodeSoundboardPlay({
        soundId: 'snd-bad',
        fileUrl,
        emoji: '🦆',
        name: 'Bad',
        senderUserId: 'user-1',
        durationMs: 1000,
      });
      expect(decodeSoundboardPlay(encoded)).toBeNull();
    }
    expect(isSafeSoundboardFileUrl('/api/soundboard/files/abc_123-def.opus')).toBe(true);
    expect(isSafeSoundboardFileUrl('/api/soundboard/files/clip.flac')).toBe(true);
    expect(isSafeSoundboardFileUrl('/api/soundboard/files/clip.aac')).toBe(true);
  });

  it('returns null for unrelated or malformed payloads', () => {
    const encoder = new TextEncoder();
    expect(decodeSoundboardPlay(encoder.encode('not-json'))).toBeNull();
    expect(decodeSoundboardPlay(encoder.encode(JSON.stringify({ type: 'deafen', deafened: true })))).toBeNull();
    expect(decodeSoundboardPlay(encoder.encode(JSON.stringify({ type: 'soundboard_play', soundId: '' })))).toBeNull();
  });
});
