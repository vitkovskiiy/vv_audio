import { buildApp } from './app';
import { createDeps, settingsFromEnv } from './bootstrap';
import { setDeps } from './container';
import { log, runInNewContext } from './context';
import { attachRealtime } from './realtime';
import { healthChecks } from './routes/system';
import { version } from './version';

try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const PORT = Number(process.env.PORT) || 3001;

await runInNewContext(async () => {
  const settings = settingsFromEnv();
  const deps = await createDeps(settings);
  const app = buildApp();
  const realtime = attachRealtime(app.server);
  setDeps({ ...deps, events: realtime });
  healthChecks.set(settings.storage, () => deps.repos.ping());

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log().info({ port: PORT, sha: version.sha, ...settings }, 'VV Audio API started');
});
