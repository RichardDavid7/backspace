import type { FastifyInstance } from 'fastify';
import '@fastify/multipart';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SoundboardScopeType, SoundboardSound } from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { generateSnowflake } from '../utils/snowflake.js';

const MAX_SOUNDBOARD_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_SOUNDBOARD_NAME = 40;
const MAX_SOUNDBOARD_EMOJI = 16;
const SAFE_FILE_NAME = /^[a-zA-Z0-9_-]+\.(wav|mp3|ogg|webm|m4a)$/;

const MIME_TO_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
};

const EXT_TO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  m4a: 'audio/mp4',
};

function soundboardDir(): string {
  return path.join(config.uploadDir, 'soundboard');
}

function rowToSound(row: typeof schema.soundboardSounds.$inferSelect): SoundboardSound {
  return {
    id: row.id,
    scopeType: row.scopeType as SoundboardScopeType,
    scopeId: row.scopeId,
    name: row.name,
    emoji: row.emoji,
    fileUrl: `/api/soundboard/files/${row.fileName}`,
    durationMs: row.durationMs,
    position: row.position,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
}

function isInstanceAdmin(userId: string): boolean {
  const db = getDb();
  const u = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return u?.isAdmin === 1;
}

function canManageScope(userId: string, scopeType: SoundboardScopeType, scopeId: string): boolean {
  if (scopeType === 'instance') {
    return isInstanceAdmin(userId);
  }
  const db = getDb();
  if (scopeType === 'space') {
    if (isInstanceAdmin(userId)) return true;
    const member = db.select({ userId: schema.spaceMembers.userId })
      .from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, scopeId), eq(schema.spaceMembers.userId, userId)))
      .get();
    return Boolean(member);
  }
  if (scopeType === 'dm') {
    const dmMember = db.select({ userId: schema.dmMembers.userId })
      .from(schema.dmMembers)
      .where(and(eq(schema.dmMembers.dmChannelId, scopeId), eq(schema.dmMembers.userId, userId)))
      .get();
    return Boolean(dmMember);
  }
  return false;
}

function resolveExtension(mimeType: string, originalFileName: string): string | null {
  const normalizedMime = mimeType.toLowerCase().split(';')[0]!.trim();
  if (MIME_TO_EXT[normalizedMime]) return MIME_TO_EXT[normalizedMime]!;
  const ext = path.extname(originalFileName).toLowerCase().replace(/^\./, '');
  if (EXT_TO_MIME[ext]) return ext;
  return null;
}

export async function soundboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/soundboard?spaceId=...&dmChannelId=...
  app.get<{ Querystring: { spaceId?: string; dmChannelId?: string } }>('/api/soundboard', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const { spaceId, dmChannelId } = request.query;

    const instanceRows = db.select()
      .from(schema.soundboardSounds)
      .where(and(
        eq(schema.soundboardSounds.scopeType, 'instance'),
        eq(schema.soundboardSounds.scopeId, 'instance'),
      ))
      .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
      .all();

    let scopedRows: (typeof schema.soundboardSounds.$inferSelect)[] = [];
    let scopeManageable = false;

    if (spaceId) {
      const member = db.select({ userId: schema.spaceMembers.userId })
        .from(schema.spaceMembers)
        .where(and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.spaceMembers.userId, request.userId)))
        .get();
      if (member) {
        scopedRows = db.select()
          .from(schema.soundboardSounds)
          .where(and(
            eq(schema.soundboardSounds.scopeType, 'space'),
            eq(schema.soundboardSounds.scopeId, spaceId),
          ))
          .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
          .all();
        scopeManageable = canManageScope(request.userId, 'space', spaceId);
      }
    } else if (dmChannelId) {
      const dmMember = db.select({ userId: schema.dmMembers.userId })
        .from(schema.dmMembers)
        .where(and(eq(schema.dmMembers.dmChannelId, dmChannelId), eq(schema.dmMembers.userId, request.userId)))
        .get();
      if (dmMember) {
        scopedRows = db.select()
          .from(schema.soundboardSounds)
          .where(and(
            eq(schema.soundboardSounds.scopeType, 'dm'),
            eq(schema.soundboardSounds.scopeId, dmChannelId),
          ))
          .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
          .all();
        scopeManageable = true;
      }
    }

    return reply.code(200).send({
      instanceSounds: instanceRows.map(rowToSound),
      scopedSounds: scopedRows.map(rowToSound),
      canManageInstance: isInstanceAdmin(request.userId),
      canManageScope: scopeManageable,
    });
  });

  // POST /api/soundboard — multipart upload (file + name + emoji + scopeType + scopeId + durationMs)
  app.post('/api/soundboard', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const parts = request.parts({ limits: { fileSize: MAX_SOUNDBOARD_BYTES, files: 1 } });
    let fileBuffer: Buffer | null = null;
    let fileMime = '';
    let originalName = '';
    let name = '';
    let emoji = '🔊';
    let scopeType: SoundboardScopeType = 'instance';
    let scopeId = 'instance';
    let durationMs = 0;

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of part.file) {
          total += chunk.length;
          if (total > MAX_SOUNDBOARD_BYTES) {
            return sendError(reply, 413, 'validation_failed');
          }
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
        fileMime = part.mimetype;
        originalName = part.filename;
      } else {
        const val = typeof part.value === 'string' ? part.value : '';
        if (part.fieldname === 'name') name = val.trim();
        else if (part.fieldname === 'emoji' && val.trim()) emoji = val.trim().slice(0, MAX_SOUNDBOARD_EMOJI);
        else if (part.fieldname === 'scopeType' && (val === 'instance' || val === 'space' || val === 'dm')) scopeType = val;
        else if (part.fieldname === 'scopeId' && val.trim()) scopeId = val.trim();
        else if (part.fieldname === 'durationMs') {
          const parsed = Number(val);
          if (Number.isFinite(parsed) && parsed >= 0) durationMs = Math.round(parsed);
        }
      }
    }

    if (scopeType === 'instance') scopeId = 'instance';
    if (!canManageScope(request.userId, scopeType, scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }
    if (!fileBuffer || fileBuffer.length === 0) {
      return sendError(reply, 400, 'validation_failed');
    }
    if (!name || name.length > MAX_SOUNDBOARD_NAME) {
      return sendError(reply, 400, 'validation_failed');
    }

    const ext = resolveExtension(fileMime, originalName);
    if (!ext) {
      return sendError(reply, 400, 'validation_failed');
    }

    const id = generateSnowflake();
    const fileName = `${randomUUID()}.${ext}`;
    const dir = soundboardDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), fileBuffer);

    const db = getDb();
    const existing = db.select({ position: schema.soundboardSounds.position })
      .from(schema.soundboardSounds)
      .where(and(
        eq(schema.soundboardSounds.scopeType, scopeType),
        eq(schema.soundboardSounds.scopeId, scopeId),
      ))
      .all();
    const nextPos = existing.length > 0 ? Math.max(...existing.map((r) => r.position)) + 1 : 0;

    const row: typeof schema.soundboardSounds.$inferInsert = {
      id,
      scopeType,
      scopeId,
      name,
      emoji,
      fileName,
      mimeType: EXT_TO_MIME[ext] ?? 'audio/wav',
      durationMs,
      position: nextPos,
      uploadedBy: request.userId,
      createdAt: Date.now(),
    };
    db.insert(schema.soundboardSounds).values(row).run();

    const created = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, id)).get();
    if (!created) return sendError(reply, 500, 'internal_error');
    return reply.code(201).send(rowToSound(created));
  });

  // PATCH /api/soundboard/:id — edit name, emoji, and/or replace audio file (JSON or multipart)
  app.patch<{ Params: { id: string } }>('/api/soundboard/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const existing = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, request.params.id)).get();
    if (!existing) return sendError(reply, 404, 'not_found');

    const scopeType = existing.scopeType as SoundboardScopeType;
    const isOwner = existing.uploadedBy === request.userId;
    if (!isOwner && !canManageScope(request.userId, scopeType, existing.scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }

    const updates: Partial<typeof schema.soundboardSounds.$inferInsert> = {};
    let oldFileToRemove: string | null = null;

    if (request.isMultipart()) {
      const parts = request.parts({ limits: { fileSize: MAX_SOUNDBOARD_BYTES, files: 1 } });
      let fileBuffer: Buffer | null = null;
      let fileMime = '';
      let originalName = '';
      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of part.file) {
            total += chunk.length;
            if (total > MAX_SOUNDBOARD_BYTES) return sendError(reply, 413, 'validation_failed');
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
          fileMime = part.mimetype;
          originalName = part.filename;
        } else {
          const val = typeof part.value === 'string' ? part.value : '';
          if (part.fieldname === 'name' && val.trim()) {
            updates.name = val.trim().slice(0, MAX_SOUNDBOARD_NAME);
          } else if (part.fieldname === 'emoji' && val.trim()) {
            updates.emoji = val.trim().slice(0, MAX_SOUNDBOARD_EMOJI);
          } else if (part.fieldname === 'durationMs') {
            const parsed = Number(val);
            if (Number.isFinite(parsed) && parsed >= 0) updates.durationMs = Math.round(parsed);
          }
        }
      }
      if (fileBuffer && fileBuffer.length > 0) {
        const ext = resolveExtension(fileMime, originalName);
        if (!ext) return sendError(reply, 400, 'validation_failed');
        const newFileName = `${randomUUID()}.${ext}`;
        const dir = soundboardDir();
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, newFileName), fileBuffer);
        oldFileToRemove = existing.fileName;
        updates.fileName = newFileName;
        updates.mimeType = EXT_TO_MIME[ext] ?? 'audio/wav';
      }
    } else {
      const body = request.body as { name?: string; emoji?: string } | null;
      if (body?.name !== undefined) {
        const trimmed = body.name.trim();
        if (!trimmed || trimmed.length > MAX_SOUNDBOARD_NAME) return sendError(reply, 400, 'validation_failed');
        updates.name = trimmed;
      }
      if (body?.emoji !== undefined && body.emoji.trim()) {
        updates.emoji = body.emoji.trim().slice(0, MAX_SOUNDBOARD_EMOJI);
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(200).send(rowToSound(existing));
    }

    db.update(schema.soundboardSounds).set(updates).where(eq(schema.soundboardSounds.id, existing.id)).run();
    if (oldFileToRemove) {
      await unlink(path.join(soundboardDir(), oldFileToRemove)).catch(() => {});
    }
    const updated = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, existing.id)).get();
    if (!updated) return sendError(reply, 500, 'internal_error');
    return reply.code(200).send(rowToSound(updated));
  });

  // PUT /api/soundboard/reorder — reorder sounds within a scope
  app.put<{ Body: { scopeType: SoundboardScopeType; scopeId: string; orderedIds: string[] } }>('/api/soundboard/reorder', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { scopeType, orderedIds } = request.body;
    const scopeId = scopeType === 'instance' ? 'instance' : request.body.scopeId;
    if (!Array.isArray(orderedIds) || !canManageScope(request.userId, scopeType, scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }

    const db = getDb();
    orderedIds.forEach((soundId, idx) => {
      db.update(schema.soundboardSounds)
        .set({ position: idx })
        .where(and(
          eq(schema.soundboardSounds.id, soundId),
          eq(schema.soundboardSounds.scopeType, scopeType),
          eq(schema.soundboardSounds.scopeId, scopeId),
        ))
        .run();
    });

    const rows = db.select()
      .from(schema.soundboardSounds)
      .where(and(
        eq(schema.soundboardSounds.scopeType, scopeType),
        eq(schema.soundboardSounds.scopeId, scopeId),
      ))
      .orderBy(asc(schema.soundboardSounds.position), asc(schema.soundboardSounds.createdAt))
      .all();
    return reply.code(200).send({ sounds: rows.map(rowToSound) });
  });

  // DELETE /api/soundboard/:id
  app.delete<{ Params: { id: string } }>('/api/soundboard/:id', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const existing = db.select().from(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, request.params.id)).get();
    if (!existing) return sendError(reply, 404, 'not_found');

    const scopeType = existing.scopeType as SoundboardScopeType;
    const isOwner = existing.uploadedBy === request.userId;
    if (!isOwner && !canManageScope(request.userId, scopeType, existing.scopeId)) {
      return sendError(reply, 403, 'forbidden');
    }

    db.delete(schema.soundboardSounds).where(eq(schema.soundboardSounds.id, existing.id)).run();
    await unlink(path.join(soundboardDir(), existing.fileName)).catch(() => {});
    return reply.code(200).send({ ok: true });
  });

  // GET /api/soundboard/files/:fileName — serve audio clip
  app.get<{ Params: { fileName: string } }>('/api/soundboard/files/:fileName', async (request, reply) => {
    const { fileName } = request.params;
    if (!SAFE_FILE_NAME.test(fileName)) {
      return sendError(reply, 400, 'validation_failed');
    }
    const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
    try {
      const data = await readFile(path.join(soundboardDir(), fileName));
      return reply
        .header('Content-Type', EXT_TO_MIME[ext] ?? 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(data);
    } catch {
      return sendError(reply, 404, 'not_found');
    }
  });
}
