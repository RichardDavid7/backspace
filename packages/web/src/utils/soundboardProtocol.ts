/**
 * LiveKit DataChannel protocol for room-scoped Soundboard playback.
 * Mirrors `streamWatchProtocol.ts`: compact JSON encoded as UTF-8 bytes.
 */

export interface SoundboardPlayMessage {
  type: 'soundboard_play';
  soundId: string;
  fileUrl: string;
  name: string;
  emoji: string;
  senderUserId: string;
  durationMs: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeSoundboardPlay(msg: Omit<SoundboardPlayMessage, 'type'>): Uint8Array {
  return encoder.encode(JSON.stringify({ type: 'soundboard_play', ...msg }));
}

export function decodeSoundboardPlay(payload: Uint8Array): SoundboardPlayMessage | null {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(payload));
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.type !== 'soundboard_play') return null;
    if (
      typeof obj.soundId !== 'string' ||
      typeof obj.fileUrl !== 'string' ||
      typeof obj.name !== 'string' ||
      typeof obj.emoji !== 'string' ||
      typeof obj.senderUserId !== 'string'
    ) {
      return null;
    }
    const durationMs = typeof obj.durationMs === 'number' && Number.isFinite(obj.durationMs)
      ? Math.max(0, obj.durationMs)
      : 1500;
    return {
      type: 'soundboard_play',
      soundId: obj.soundId,
      fileUrl: obj.fileUrl,
      name: obj.name,
      emoji: obj.emoji,
      senderUserId: obj.senderUserId,
      durationMs,
    };
  } catch {
    return null;
  }
}
