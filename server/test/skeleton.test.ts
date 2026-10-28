import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, describe, it } from 'node:test';
import { buildApp, type App, type ErrorBody } from '../app';
import { log } from '../context';
import { ForbiddenError } from '../errors';
import { configureLogger } from '../logger';
import { healthChecks } from '../routes/system';

const lines: Record<string, unknown>[] = [];
configureLogger(
  new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split('\n')) if (l) lines.push(JSON.parse(l));
      cb();
    },
  }),
);

/** stands in for a service or repository: no request or logger is passed in */
async function deepLayer() {
  await sleep(5);
  log().info('deep layer reached');
  await Promise.resolve().then(() => log().info('after another hop'));
}

let app: App;

before(async () => {
  app = buildApp();
  app.get('/test/deep', async () => {
    await deepLayer();
    return { ok: true };
  });
  app.get('/test/forbidden', async () => {
    throw new ForbiddenError('only the owner can do this');
  });
  app.get('/test/crash', async () => {
    throw new Error('secret internal detail');
  });
  app.post('/test/validate', { schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 } } } } }, async () => ({ ok: true }));
  await app.ready();
});

after(() => app.close());

describe('business-process ID', () => {
  it('is returned in x-bp-id and present in every log line of the request, from any layer', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/deep' });
    const bpId = res.headers['x-bp-id'];
    assert.equal(res.statusCode, 200);
    assert.match(String(bpId), /^[0-9a-f-]{36}$/);

    const mine = lines.filter((l) => l.bpId === bpId).map((l) => l.msg);
    assert.ok(mine.includes('incoming request'), 'framework log has bpId');
    assert.ok(mine.includes('deep layer reached'), 'nested async log has bpId');
    assert.ok(mine.includes('after another hop'), 'log after another microtask has bpId');
    assert.ok(mine.includes('request completed'), 'completion log has bpId');
  });

  it('differs between concurrent requests', async () => {
    const [a, b] = await Promise.all([app.inject('/test/deep'), app.inject('/test/deep')]);
    assert.notEqual(a.headers['x-bp-id'], b.headers['x-bp-id']);
    for (const res of [a, b]) {
      const deep = lines.filter((l) => l.msg === 'deep layer reached' && l.bpId === res.headers['x-bp-id']);
      assert.equal(deep.length, 1, 'each request logs its own deep line under its own ID');
    }
  });
});

describe('global error handler', () => {
  it('maps a thrown business error to its status and JSON body', async () => {
    const res = await app.inject('/test/forbidden');
    const body = res.json<ErrorBody>();
    assert.equal(res.statusCode, 403);
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(body.error.message, 'only the owner can do this');
    assert.equal(body.error.bpId, res.headers['x-bp-id']);
  });

  it('hides unexpected errors behind 500 INTERNAL but logs them with the bpId', async () => {
    const res = await app.inject('/test/crash');
    const body = res.json<ErrorBody>();
    assert.equal(res.statusCode, 500);
    assert.equal(body.error.code, 'INTERNAL');
    assert.ok(!res.body.includes('secret internal detail'), 'internal message is not leaked');
    const logged = lines.find((l) => l.bpId === body.error.bpId && l.level === 50);
    assert.ok(logged, 'the failure is logged at error level under the same bpId');
  });

  it('turns schema validation failures into 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/test/validate', payload: { text: '' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json<ErrorBody>().error.code, 'VALIDATION_ERROR');
  });

  it('answers unknown routes with 404 NOT_FOUND in the same format', async () => {
    const res = await app.inject('/api/nope');
    assert.equal(res.statusCode, 404);
    assert.equal(res.json<ErrorBody>().error.code, 'NOT_FOUND');
  });

  it('keeps malformed JSON a client error', async () => {
    const res = await app.inject({ method: 'POST', url: '/test/validate', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json<ErrorBody>().error.code);
  });
});

describe('system routes', () => {
  it('/version returns the commit SHA', async () => {
    const res = await app.inject('/version');
    assert.equal(res.statusCode, 200);
    assert.match(res.json().sha, /^([0-9a-f]{40}|unknown)$/);
  });

  it('/healthz is 200 when all checks pass and 503 when one fails', async () => {
    healthChecks.set('ok-dep', async () => {});
    assert.equal((await app.inject('/healthz')).statusCode, 200);
    healthChecks.set('broken-dep', async () => {
      throw new Error('down');
    });
    const res = await app.inject('/healthz');
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json().checks, { 'ok-dep': 'ok', 'broken-dep': 'fail' });
    healthChecks.clear();
  });
});
