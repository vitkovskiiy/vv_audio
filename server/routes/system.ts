import type { FastifyPluginAsync } from 'fastify';
import { version } from '../version';

export type HealthCheck = () => Promise<void>;

/** dependencies register here (the database in a later stage); a throwing check makes /healthz return 503 */
export const healthChecks = new Map<string, HealthCheck>();

/**
 * spec.md (Завдання 4): set by main.ts once structure migrations are applied and dependencies are up.
 * Render routes traffic to a new version only after /readyz is 200; until then the old one serves.
 */
export const readiness = { ready: false };

async function runChecks() {
  const results: Record<string, 'ok' | 'fail'> = {};
  for (const [name, check] of healthChecks) {
    try {
      await check();
      results[name] = 'ok';
    } catch {
      results[name] = 'fail';
    }
  }
  return { healthy: Object.values(results).every((r) => r === 'ok'), results };
}

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.get('/version', async () => version);

  app.get('/healthz', async (_request, reply) => {
    const { healthy, results } = await runChecks();
    reply.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'fail', checks: results };
  });

  // readiness = migrations applied + the database answers; background indexes and data updates do not count
  app.get('/readyz', async (_request, reply) => {
    if (!readiness.ready) {
      reply.status(503);
      return { status: 'starting' };
    }
    const { healthy, results } = await runChecks();
    reply.status(healthy ? 200 : 503);
    return { status: healthy ? 'ready' : 'fail', checks: results };
  });
};
