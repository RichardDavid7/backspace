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

const SAFE_SOUNDBOARD_FILE_URL = /^\/api\/soundboard\/files\/[a-zA-Z0-9_-]+\.(wav|mp3|ogg|webm|m4a|aac|flac|opus)$/;

/**
 * Only instance-relative soundboard file paths matching the server's safe file
 * naming scheme are allowed. Rejects arbitrary external URLs, protocol-relative
 * URLs, path traversal, and query/fragment suffixes from untrusted DataChannel peers.
 */
export function isSafeSoundboardFileUrl(fileUrl: string): boolean {
  return SAFE_SOUNDBOARD_FILE_URL.test(fileUrl);
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
    if (!isSafeSoundboardFileUrl(obj.fileUrl)) {
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
