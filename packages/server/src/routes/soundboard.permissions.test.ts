import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';

setWorkerId(1);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');
const TEMP_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backspace-sb-test-'));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'member';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../config.js', () => ({
  config: {
    uploadDir: TEMP_UPLOAD_DIR,
  },
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

function applyMigrations(db: Database.Database): void {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

function buildUploadPayload(spaceId: string): { payload: Buffer; boundary: string } {
  const boundary = '----BackspaceTestBoundary';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAirhorn\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="emoji"\r\n\r\n📯\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="scopeType"\r\n\r\nspace\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="scopeId"\r\n\r\n${spaceId}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="durationMs"\r\n\r\n1200\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="horn.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFFDATA\r\n`,
    `--${boundary}--\r\n`,
  ];
  return { payload: Buffer.from(parts.join('')), boundary };
}

const SPACE_ID = 'space-1';
const DJ_ROLE_ID = 'role-dj';
const now = 1_700_000_000_000;

let app: FastifyInstance;

beforeEach(async () => {
  currentUserId = 'member';
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });

  for (const id of ['owner', 'member', 'dj']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: now }).run();
  }
  testDb.insert(schema.spaces).values({
    id: SPACE_ID, name: 'Space', ownerId: 'owner', inviteCode: 'code', visibility: 'public', createdAt: now,
  }).run();
  for (const userId of ['owner', 'member', 'dj']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE_ID, userId, joinedAt: now }).run();
  }
  testDb.insert(schema.roles).values([
    {
      id: SPACE_ID,
      spaceId: SPACE_ID,
      name: '@everyone',
      position: 0,
      permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS),
      createdAt: now,
    },
    {
      id: DJ_ROLE_ID,
      spaceId: SPACE_ID,
      name: 'DJ',
      position: 1,
      permissions: permissionsToString(PermissionBits.MANAGE_SOUNDBOARD),
      createdAt: now,
    },
  ]).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE_ID, userId: 'dj', roleId: DJ_ROLE_ID }).run();

  const { soundboardRoutes } = await import('./soundboard.js');
  app = Fastify();
  await app.register(soundboardRoutes);
});

describe('soundboard MANAGE_SOUNDBOARD role permission', () => {
  it('denies upload and reports canManageScope=false for a regular member', async () => {
    currentUserId = 'member';
    const listRes = await app.inject({ method: 'GET', url: `/api/soundboard?spaceId=${SPACE_ID}` });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().canManageScope).toBe(false);

    const { payload, boundary } = buildUploadPayload(SPACE_ID);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/soundboard',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(uploadRes.statusCode).toBe(403);
  });

  it('allows upload and reports canManageScope=true for a member whose role grants MANAGE_SOUNDBOARD', async () => {
    currentUserId = 'dj';
    const listRes = await app.inject({ method: 'GET', url: `/api/soundboard?spaceId=${SPACE_ID}` });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().canManageScope).toBe(true);

    const { payload, boundary } = buildUploadPayload(SPACE_ID);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/soundboard',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(uploadRes.statusCode).toBe(201);
  });

  it('always allows the space owner to manage soundboard clips', async () => {
    currentUserId = 'owner';
    const listRes = await app.inject({ method: 'GET', url: `/api/soundboard?spaceId=${SPACE_ID}` });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().canManageScope).toBe(true);
  });
});
