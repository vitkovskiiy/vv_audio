import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runDataMigrations } from '../../db/data-migrations';
import { buildIndexes, INDEXES } from '../../db/indexes';
import { migrateStructure } from '../../db/startup';
import { configureLogger } from '../../logger';
import { createKysely } from '../../repositories/postgres';
import type { Database } from '../../db/schema';

/**
 * spec.md (Завдання 4), zero-downtime migrations on a real PostgreSQL 18:
 * structure is re-runnable, indexes are built CONCURRENTLY and an INVALID one is rebuilt,
 * the data migration fills YouTube covers in batches and a second run changes nothing.
 */

configureLogger(undefined, 'silent');

let db: Kysely<Database>;

beforeAll(() => {
  db = createKysely(inject('databaseUrl'));
});

afterAll(async () => {
  await db.destroy();
});

async function indexState() {
  const { rows } = await sql<{ name: string; valid: boolean }>`
    SELECT c.relname AS name, i.indisvalid AS valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ANY(${INDEXES.map((i) => i.name)})
  `.execute(db);
  return Object.fromEntries(rows.map((r) => [r.name, r.valid]));
}

describe('structure migrations on start', () => {
  it('re-running them on an up-to-date database is a no-op, not an error', async () => {
    await expect(migrateStructure(inject('databaseUrl'))).resolves.toBeUndefined();
  });
});

describe('background index step', () => {
  it('builds every index, valid; a second run builds nothing new and rebuilds nothing', async () => {
    const first = await buildIndexes(db);
    expect(first).toEqual({ rebuilt: [], failed: [] });
    expect(await indexState()).toEqual(Object.fromEntries(INDEXES.map((i) => [i.name, true])));

    expect(await buildIndexes(db)).toEqual({ rebuilt: [], failed: [] });
  });

  it('an INVALID index left by a failed CONCURRENTLY build is dropped and built again', async () => {
    await buildIndexes(db);
    // what a failed/cancelled CREATE INDEX CONCURRENTLY leaves behind (the test user is a superuser)
    await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'messages_room_created'::regclass`.execute(db);
    expect((await indexState()).messages_room_created).toBe(false);

    const report = await buildIndexes(db);

    expect(report.rebuilt).toEqual(['messages_room_created']);
    expect((await indexState()).messages_room_created).toBe(true);
  });

  it('when another instance holds the build lock (blue and green overlap) this one skips', async () => {
    await db.connection().execute(async (other) => {
      await sql`SELECT pg_advisory_lock(4200442)`.execute(other);
      try {
        expect(await buildIndexes(db)).toEqual({ skipped: 'locked', rebuilt: [], failed: [] });
      } finally {
        await sql`SELECT pg_advisory_unlock(4200442)`.execute(other);
      }
    });
  });
});

describe('data migration: YouTube covers', () => {
  it('fills covers of YouTube tracks only, across several batches; a second run changes nothing', async () => {
    const tag = `t${Date.now()}`;
    const youtube = Array.from({ length: 1201 }, (_, i) => ({ source: 'youtube' as const, ref: `${tag}y${i}`, title: 'x' }));
    await db.insertInto('tracks').values(youtube).execute();
    await db
      .insertInto('tracks')
      .values({ source: 'soundcloud', ref: `${tag}sc`, title: 'x' })
      .execute();
    await db
      .insertInto('tracks')
      .values({ source: 'youtube', ref: `${tag}kept`, title: 'x', thumbnail: 'https://own/cover.jpg' })
      .execute();

    const first = await runDataMigrations(db);
    expect(first.youtube_thumbnails).toBeGreaterThanOrEqual(1201); // more than two batches of 500

    const one = await db.selectFrom('tracks').select('thumbnail').where('ref', '=', `${tag}y7`).executeTakeFirstOrThrow();
    expect(one.thumbnail).toBe(`https://i.ytimg.com/vi/${tag}y7/hqdefault.jpg`);
    const sc = await db.selectFrom('tracks').select('thumbnail').where('ref', '=', `${tag}sc`).executeTakeFirstOrThrow();
    expect(sc.thumbnail).toBeNull();
    const kept = await db.selectFrom('tracks').select('thumbnail').where('ref', '=', `${tag}kept`).executeTakeFirstOrThrow();
    expect(kept.thumbnail).toBe('https://own/cover.jpg');

    expect(await runDataMigrations(db)).toEqual({ youtube_thumbnails: 0 });
  });
});
