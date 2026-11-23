import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app';
import { configureLogger } from '../logger';
import { healthChecks, readiness } from '../routes/system';

/** spec.md (Завдання 4): Render's health check path; traffic moves to a new version only on 200 */

configureLogger(undefined, 'silent');

let app: App;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  readiness.ready = false;
  healthChecks.clear();
  await app.close();
});

describe('/readyz', () => {
  it('is 503 "starting" until start-up (structure migrations) has finished', async () => {
    readiness.ready = false;
    const res = await app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'starting' });
  });

  it('is 200 once ready and the database answers', async () => {
    readiness.ready = true;
    healthChecks.set('db', async () => {});
    const res = await app.inject('/readyz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { db: 'ok' } });
  });

  it('is 503 when ready but the database does not answer', async () => {
    readiness.ready = true;
    healthChecks.set('db', () => Promise.reject(new Error('down')));
    const res = await app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'fail', checks: { db: 'fail' } });
  });
});
