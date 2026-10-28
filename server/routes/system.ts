import type { FastifyPluginAsync } from 'fastify';
import { version } from '../version';

export type HealthCheck = () => Promise<void>;

/** dependencies register here (the database in a later stage); a throwing check makes /healthz return 503 */
export const healthChecks = new Map<string, HealthCheck>();

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.get('/version', async () => version);

  app.get('/healthz', async (_request, reply) => {
    const results: Record<string, 'ok' | 'fail'> = {};
    for (const [name, check] of healthChecks) {
      try {
        await check();
        results[name] = 'ok';
      } catch {
        results[name] = 'fail';
      }
    }
    const healthy = Object.values(results).every((r) => r === 'ok');
    reply.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'fail', checks: results };
  });
};
