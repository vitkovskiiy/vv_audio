import { sql, type Kysely } from 'kysely';
import { log } from '../context';

/**
 * spec.md (Завдання 4): data updates are non-blocking and separate from structure migrations.
 * Each one is idempotent (re-running it changes nothing) and works in small batches, so no
 * long-held row locks and no long transaction. Runs in the background after the server is ready.
 */
const BATCH = 500;

export interface DataMigration {
  name: string;
  /** updates at most one batch and returns how many rows it changed; 0 = done */
  batch<DB>(db: Kysely<DB>): Promise<number>;
}

export const DATA_MIGRATIONS: DataMigration[] = [
  {
    // a YouTube track whose metadata lookup failed was stored without a cover; YouTube serves one by video id
    name: 'youtube_thumbnails',
    async batch(db) {
      const result = await sql`
        UPDATE tracks SET thumbnail = 'https://i.ytimg.com/vi/' || ref || '/hqdefault.jpg'
        WHERE id IN (
          SELECT id FROM tracks
          WHERE source = 'youtube' AND thumbnail IS NULL
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
        )
      `.execute(db);
      return Number(result.numAffectedRows ?? 0);
    },
  },
];

/** runs every data migration to completion; returns rows changed per migration */
export async function runDataMigrations<DB>(db: Kysely<DB>, migrations = DATA_MIGRATIONS): Promise<Record<string, number>> {
  const changed: Record<string, number> = {};
  for (const m of migrations) {
    let total = 0;
    for (let n = await m.batch(db); n > 0; n = await m.batch(db)) total += n;
    changed[m.name] = total;
    log().info({ migration: m.name, rows: total }, 'data migration done');
  }
  return changed;
}
