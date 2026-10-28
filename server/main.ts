import { buildApp } from './app';
import { log, runInNewContext } from './context';
import { version } from './version';

const PORT = Number(process.env.PORT) || 3001;

await runInNewContext(async () => {
  const app = buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log().info({ port: PORT, sha: version.sha }, 'VV Audio API started');
});
