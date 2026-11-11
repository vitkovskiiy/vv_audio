import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import * as m0001 from './migrations/0001_schema';
import * as m0002 from './migrations/0002_indexes';

/** explicit list: the order is reviewable in one place and no files are discovered at runtime */
const migrations: Record<string, Migration> = {
  '0001_schema': m0001,
  '0002_indexes': m0002,
};

export async function migrateToLatest<DB>(db: Kysely<DB>): Promise<string[]> {
  const migrator = new Migrator({ db, provider: { getMigrations: () => Promise.resolve(migrations) } });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error('migration failed', { cause: error });
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
