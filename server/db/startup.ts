import { log } from '../context';
import { createKysely } from '../repositories/postgres';
import { runDataMigrations } from './data-migrations';
import { buildIndexes } from './indexes';
import { migrateToLatest } from './migrate';

/**
 * spec.md (Завдання 4): the container migrates its own database on start — the same image and the
 * same mechanism on staging and prod, so CI never needs database access.
 *
 * Structure migrations run BEFORE the server listens. If one fails this throws, the process exits
 * with an error, /readyz never answers, and Render keeps the previous version serving traffic.
 * They must stay backward compatible (expand/contract): the old version still runs on the new schema.
 */
export async function migrateStructure(databaseUrl: string): Promise<void> {
  const db = createKysely(databaseUrl);
  try {
    const applied = await migrateToLatest(db);
    log().info({ applied }, applied.length ? 'structure migrations applied' : 'structure is up to date');
  } finally {
    await db.destroy();
  }
}

/**
 * Data migrations, then indexes — AFTER the server is ready; readiness does not wait for them.
 * Never throws: a failure is logged and the service keeps serving.
 */
export async function runBackgroundSteps(databaseUrl: string): Promise<void> {
  const db = createKysely(databaseUrl);
  try {
    await runDataMigrations(db).catch((err) => log().error({ err: String(err) }, 'data migrations failed'));
    const report = await buildIndexes(db);
    log().info(report, 'indexes done');
  } catch (err) {
    log().error({ err: String(err) }, 'background steps failed');
  } finally {
    await db.destroy().catch(() => {});
  }
}
