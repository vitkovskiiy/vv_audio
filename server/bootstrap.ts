import { noEvents, type Deps } from './container';
import { log } from './context';
import { createMemoryRepositories } from './repositories/memory';
import type { Repositories } from './repositories/ports';
import { seed } from './repositories/seed';
import { liveMetadata, staticMetadata } from './services/metadata';
import { liveSearchProviders, staticSearchProviders } from './services/search.service';

export interface Settings {
  /** memory = static prototype data; postgres arrives in the next stage */
  storage: 'memory';
  /** static = fixed titles and search results without network; live = oEmbed + provider APIs */
  sources: 'static' | 'live';
  seed: boolean;
}

export function settingsFromEnv(env = process.env): Settings {
  const storage = env.STORAGE ?? 'memory';
  if (storage !== 'memory') throw new Error(`STORAGE=${storage} is not supported yet`);
  const sources = env.SOURCES ?? 'live';
  if (sources !== 'static' && sources !== 'live') throw new Error(`SOURCES must be static or live, got ${sources}`);
  return { storage, sources, seed: env.SEED !== '0' };
}

/** builds every process-wide resource; fails loudly at startup rather than on the first request */
export async function createDeps(settings: Settings): Promise<Deps> {
  const repos: Repositories = createMemoryRepositories();
  await repos.ping();
  if (settings.seed) {
    await seed(repos);
    log().info('static seed data loaded (rooms PARTY5, CHILL2)');
  }
  return {
    repos,
    metadata: settings.sources === 'static' ? staticMetadata : liveMetadata,
    searchProviders: settings.sources === 'static' ? staticSearchProviders() : liveSearchProviders(),
    events: noEvents,
  };
}
