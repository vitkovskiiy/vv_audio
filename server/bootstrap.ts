import { sql } from 'kysely';
import { noEvents, type Deps } from './container';
import { log } from './context';
import { createMemoryRepositories } from './repositories/memory';
import type { Repositories } from './repositories/ports';
import { createKysely, createPostgresRepositories } from './repositories/postgres';
import { seed } from './repositories/seed';
import { liveMetadata, staticMetadata } from './services/metadata';
import { liveSearchProviders, staticSearchProviders } from './services/search.service';

export interface Settings {
  /** memory = static prototype data in process; postgres = the real database */
  storage: 'memory' | 'postgres';
  databaseUrl?: string;
  /** static = fixed titles and search results without network; live = oEmbed + provider APIs */
  sources: 'static' | 'live';
  /** seed the in-memory store on start; PostgreSQL is seeded by `npm run db:seed` */
  seed: boolean;
}

export function settingsFromEnv(env = process.env): Settings {
  const storage = env.STORAGE ?? 'memory';
  if (storage !== 'memory' && storage !== 'postgres') throw new Error(`STORAGE must be memory or postgres, got ${storage}`);
  if (storage === 'postgres' && !env.DATABASE_URL) throw new Error('STORAGE=postgres needs DATABASE_URL');
  const sources = env.SOURCES ?? 'live';
  if (sources !== 'static' && sources !== 'live') throw new Error(`SOURCES must be static or live, got ${sources}`);
  return { storage, databaseUrl: env.DATABASE_URL, sources, seed: env.SEED !== '0' };
}

const STARTUP_CHECK_MS = 5000;

/** opens the pool and proves the database answers; throws at startup instead of failing the first request */
export async function connectPostgres(databaseUrl: string): Promise<Repositories> {
  const db = createKysely(databaseUrl);
  try {
    const { rows } = await Promise.race([
      sql<{ now: Date }>`SELECT now()`.execute(db),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${STARTUP_CHECK_MS} ms`)), STARTUP_CHECK_MS)),
    ]);
    log().info({ dbTime: rows[0].now }, 'database reachable');
  } catch (err) {
    await db.destroy().catch(() => {});
    throw new Error(`База даних недоступна (${databaseUrl.replace(/:[^:@/]*@/, ':***@')}): ${err instanceof Error ? err.message : String(err)}`);
  }
  return createPostgresRepositories(db);
}

/** builds every process-wide resource; fails loudly at startup rather than on the first request */
export async function createDeps(settings: Settings): Promise<Deps> {
  let repos: Repositories;
  if (settings.storage === 'postgres') {
    repos = await connectPostgres(settings.databaseUrl!);
  } else {
    repos = createMemoryRepositories();
    if (settings.seed) {
      await seed(repos);
      log().info('static seed data loaded (rooms PARTY5, CHILL2)');
    }
  }
  return {
    repos,
    metadata: settings.sources === 'static' ? staticMetadata : liveMetadata,
    searchProviders: settings.sources === 'static' ? staticSearchProviders() : liveSearchProviders(),
    events: noEvents,
  };
}
