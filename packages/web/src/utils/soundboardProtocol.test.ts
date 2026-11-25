import { describe, it, expect } from 'vitest';
import { encodeSoundboardPlay, decodeSoundboardPlay } from './soundboardProtocol';

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

  it('returns null for unrelated or malformed payloads', () => {
    const encoder = new TextEncoder();
    expect(decodeSoundboardPlay(encoder.encode('not-json'))).toBeNull();
    expect(decodeSoundboardPlay(encoder.encode(JSON.stringify({ type: 'deafen', deafened: true })))).toBeNull();
    expect(decodeSoundboardPlay(encoder.encode(JSON.stringify({ type: 'soundboard_play', soundId: '' })))).toBeNull();
  });
});
