import { buildApp } from './app';
import { createDeps, settingsFromEnv } from './bootstrap';
import { setDeps } from './container';
import { log, runInNewContext } from './context';
import { attachRealtime } from './realtime';
import { runBackgroundSteps, migrateStructure } from './db/startup';
import { healthChecks, readiness } from './routes/system';
import { version } from './version';

try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const PORT = Number(process.env.PORT) || 3001;
const MAINTENANCE_MS = 60 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

await runInNewContext(async () => {
  const settings = settingsFromEnv();
  // spec.md (Завдання 4): structure first; a failed migration ends start-up and the old version keeps serving
  if (settings.storage === 'postgres') await migrateStructure(settings.databaseUrl!);
  const deps = await createDeps(settings);
  const app = buildApp();
  const realtime = attachRealtime(app.server);
  setDeps({ ...deps, events: realtime });
  healthChecks.set(settings.storage, () => deps.repos.ping());

  // D12: idempotency keys live 24 h; expired sessions are dropped too
  setInterval(
    () =>
      void runInNewContext(async () => {
        const keys = await deps.repos.idempotency.purgeBefore(new Date(Date.now() - IDEMPOTENCY_TTL_MS));
        const sessions = await deps.repos.sessions.purgeExpired();
        log().info({ keys, sessions }, 'maintenance done');
      }).catch((err) => log().warn({ err: String(err) }, 'maintenance failed')),
    MAINTENANCE_MS,
  ).unref();

  readiness.ready = true;
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log().info({ port: PORT, sha: version.sha, storage: settings.storage, sources: settings.sources }, 'ready');
  // data updates and indexes run after "ready" and never block it
  if (settings.storage === 'postgres') void runBackgroundSteps(settings.databaseUrl!);
}).catch((err) => {
  // K15: refuse to start without the database instead of failing every request later
  log().fatal({ err: err instanceof Error ? err.message : String(err) }, 'startup failed');
  process.exit(1);
});
