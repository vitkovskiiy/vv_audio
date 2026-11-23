import { sql, type Kysely } from 'kysely';
import { log } from '../context';

/**
 * spec.md (Завдання 4): indexes are a separate step, built in the background after the server is
 * already serving. CREATE INDEX CONCURRENTLY does not block writes, but it cannot run inside a
 * transaction, so this is not a Kysely migration (those run in one). On a large table a build can
 * take up to an hour; doing it inside a start-up with a timeout would loop timeout → crash → restart.
 */
export const INDEXES: ReadonlyArray<{ name: string; on: string }> = [
  // queue in play order for a room
  { name: 'queue_items_room_status_rank', on: 'queue_items (room_id, status, rank)' },
  // chat history, newest first
  { name: 'messages_room_created', on: 'messages (room_id, created_at)' },
  // "my rooms"
  { name: 'room_members_user', on: 'room_members (user_id)' },
  // open requests shown to the owner
  { name: 'requests_room_pending', on: "requests (room_id) WHERE status = 'pending'" },
  // periodic clean-up
  { name: 'sessions_expires', on: 'sessions (expires_at)' },
  { name: 'idempotency_keys_created', on: 'idempotency_keys (created_at)' },
];

/** any constant; only one instance builds indexes at a time (blue and green may overlap during a deploy) */
const LOCK_KEY = 4_200_442;

export interface IndexReport {
  skipped?: 'locked';
  rebuilt: string[];
  failed: string[];
}

/**
 * Idempotent: an existing valid index is left alone (IF NOT EXISTS). A failed CONCURRENTLY build
 * leaves an INVALID index behind; it is found through pg_index.indisvalid, dropped and built again.
 * A failure is logged and the service keeps running without that index — slower, not down.
 */
export async function buildIndexes<DB>(db: Kysely<DB>): Promise<IndexReport> {
  // one session: the advisory lock and the builds must share a connection
  return db.connection().execute(async (conn) => {
    const { rows } = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`.execute(conn);
    if (!rows[0].locked) {
      log().info('indexes: another instance is building them, skipped');
      return { skipped: 'locked', rebuilt: [], failed: [] };
    }
    const report: IndexReport = { rebuilt: [], failed: [] };
    try {
      const invalid = await sql<{ name: string }>`
        SELECT c.relname AS name
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE NOT i.indisvalid AND c.relname = ANY(${INDEXES.map((i) => i.name)})
      `.execute(conn);
      const invalidNames = new Set(invalid.rows.map((r) => r.name));

      for (const { name, on } of INDEXES) {
        try {
          if (invalidNames.has(name)) {
            log().warn({ index: name }, 'indexes: invalid index left by a failed build, rebuilding');
            await sql.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`).execute(conn);
            report.rebuilt.push(name);
          }
          const started = Date.now();
          await sql.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON ${on}`).execute(conn);
          log().info({ index: name, ms: Date.now() - started }, 'indexes: ready');
        } catch (err) {
          report.failed.push(name);
          log().error({ index: name, err: err instanceof Error ? err.message : String(err) }, 'indexes: build failed, serving without it');
        }
      }
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`.execute(conn);
    }
    return report;
  });
}
