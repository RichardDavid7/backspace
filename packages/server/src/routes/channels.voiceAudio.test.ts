import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';

// Per-voice-channel Opus overrides (default/max bitrate, music, stereo) and the
// migration that grants USE_SOUNDBOARD to existing @everyone roles.

setWorkerId(1);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = 'owner';
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    addUserSpace: vi.fn(),
    announceSpaceAccessChange: vi.fn(),
    sendToSpace: vi.fn(),
    sendToChannel: vi.fn(),
    sendToUser: vi.fn(),
    pushSpaceVoiceState: vi.fn(),
    getUserSpaceEntries: () => new Map([['owner', new Set(['space-1'])]]).entries(),
  },
}));

vi.mock('../ws/events.js', () => ({
  checkVoicePermissions: vi.fn(),
}));

const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

function applyMigrations(db: Database.Database, upTo?: string): void {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (upTo && f > upTo) break;
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const SPACE_ID = 'space-1';
const TEXT_ID = 'text-1';
const VOICE_ID = 'voice-1';
const now = 1_700_000_000_000;

let app: FastifyInstance;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });

  testDb.insert(schema.users).values({ id: 'owner', username: 'owner', passwordHash: 'x', createdAt: now }).run();
  testDb.insert(schema.spaces).values({
    id: SPACE_ID, name: 'Space', ownerId: 'owner', inviteCode: 'code', visibility: 'public', createdAt: now,
  }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: SPACE_ID, userId: 'owner', joinedAt: now }).run();
  testDb.insert(schema.roles).values({
    id: SPACE_ID, spaceId: SPACE_ID, name: '@everyone', position: 0,
    permissions: permissionsToString(PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT),
    createdAt: now,
  }).run();
  testDb.insert(schema.channels).values([
    { id: TEXT_ID, spaceId: SPACE_ID, name: 'general', type: 'text', position: 0, createdAt: now },
    { id: VOICE_ID, spaceId: SPACE_ID, name: 'lounge', type: 'voice', position: 1, createdAt: now },
  ]).run();

  const { channelRoutes } = await import('./channels.js');
  app = Fastify();
  await app.register(channelRoutes);
});

function patch(id: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PATCH', url: `/api/channels/${id}`, payload });
}

function voiceRow() {
  return testDb.select().from(schema.channels).where(eq(schema.channels.id, VOICE_ID)).get()!;
}

describe('PATCH /api/channels/:id — voice audio settings', () => {
  it('stores max bitrate and stereo override on a voice channel', async () => {
    const res = await patch(VOICE_ID, { maxAudioBitrateKbps: 128, allowStereoAudio: false });
    expect(res.statusCode).toBe(200);
    expect(voiceRow().maxAudioBitrateKbps).toBe(128);
    expect(voiceRow().allowStereoAudio).toBe(0);
  });

  it('caps the channel max at the instance maximum', async () => {
    testDb.insert(schema.instanceSettings).values({ id: 1, maxAudioBitrateKbps: 96, updatedAt: now }).onConflictDoUpdate({
      target: schema.instanceSettings.id, set: { maxAudioBitrateKbps: 96 },
    }).run();
    const res = await patch(VOICE_ID, { maxAudioBitrateKbps: 400 });
    expect(res.statusCode).toBe(200);
    expect(voiceRow().maxAudioBitrateKbps).toBe(96);
  });

  it('lowers the channel default when it would exceed the new channel max', async () => {
    await patch(VOICE_ID, { audioBitrateKbps: 192 });
    const res = await patch(VOICE_ID, { maxAudioBitrateKbps: 64 });
    expect(res.statusCode).toBe(200);
    expect(voiceRow().audioBitrateKbps).toBe(64);
  });

  it('null resets overrides to inherit', async () => {
    await patch(VOICE_ID, { maxAudioBitrateKbps: 128, allowStereoAudio: true });
    const res = await patch(VOICE_ID, { maxAudioBitrateKbps: null, allowStereoAudio: null });
    expect(res.statusCode).toBe(200);
    expect(voiceRow().maxAudioBitrateKbps).toBeNull();
    expect(voiceRow().allowStereoAudio).toBeNull();
  });

  it('rejects non-boolean stereo / music values', async () => {
    expect((await patch(VOICE_ID, { allowStereoAudio: 'yes' })).statusCode).toBe(400);
    expect((await patch(VOICE_ID, { allowMusicMode: 1 })).statusCode).toBe(400);
  });

  it('rejects out-of-range bitrate', async () => {
    expect((await patch(VOICE_ID, { maxAudioBitrateKbps: 4 })).statusCode).toBe(400);
    expect((await patch(VOICE_ID, { maxAudioBitrateKbps: 9999 })).statusCode).toBe(400);
  });

  it('rejects audio settings on a text channel', async () => {
    const res = await patch(TEXT_ID, { allowStereoAudio: false });
    expect(res.statusCode).toBe(400);
  });
});
