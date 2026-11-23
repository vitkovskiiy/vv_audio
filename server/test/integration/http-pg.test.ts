import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { buildApp, type App } from '../../app';
import { createDeps } from '../../bootstrap';
import { deps, setDeps } from '../../container';
import { configureLogger } from '../../logger';

/**
 * spec.md (Завдання 3), integration criteria: roles, concurrent "track ended", Idempotency-Key.
 * Real HTTP (fetch against a listening Fastify) + real PostgreSQL 18, so the SQL locks and
 * conditional updates are what is being tested, not their in-memory stand-ins.
 */

configureLogger(undefined, 'silent');

let app: App;
let base: string;

/** a browser-like client: keeps the session cookie between calls */
class Client {
  private cookie = '';
  constructor(readonly name: string) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

async function user(prefix: string) {
  const c = new Client(`${prefix}_${randomUUID().slice(0, 8)}`);
  const r = await c.call('POST', '/api/auth/register', { username: c.name, password: 'password123' });
  expect(r.status).toBe(201);
  return c;
}

let owner: Client;
let member: Client;
let stranger: Client;
let code: string;

const track = (n: number) => `https://youtu.be/${String(n).padStart(11, 'x')}`;

beforeAll(async () => {
  setDeps(await createDeps({ storage: 'postgres', databaseUrl: inject('databaseUrl'), sources: 'static', seed: false }));
  app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await app.close();
  await deps().repos.close();
});

beforeEach(async () => {
  owner = await user('owner');
  member = await user('member');
  stranger = await user('stranger');
  const created = await owner.call('POST', '/api/rooms');
  expect(created.status).toBe(201);
  code = created.body.code;
  expect((await member.call('POST', `/api/rooms/${code}/join`)).status).toBe(200);
});

describe('roles over HTTP (spec: 3 випадки → 403)', () => {
  it('a non-member cannot open the room or add a track: 403', async () => {
    const open = await stranger.call('GET', `/api/rooms/${code}`);
    const add = await stranger.call('POST', `/api/rooms/${code}/queue`, { url: track(1) });

    expect(open.status).toBe(403);
    expect(add.status).toBe(403);
    expect(add.body.error.code).toBe('FORBIDDEN');
    expect((await owner.call('GET', `/api/rooms/${code}`)).body.playback.current).toBeNull();
  });

  it('a regular member presses "play next": 403, the queue order stays', async () => {
    await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(1) });
    const a = await member.call('POST', `/api/rooms/${code}/queue`, { url: track(2) });
    const b = await member.call('POST', `/api/rooms/${code}/queue`, { url: track(3) });

    const res = await member.call('POST', `/api/rooms/${code}/queue/${b.body.item.id}/play-next`);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Це може робити лише власник кімнати');
    const queue = (await member.call('GET', `/api/rooms/${code}/queue`)).body.queue;
    expect(queue.map((q: { id: string }) => q.id)).toEqual([a.body.item.id, b.body.item.id]);
  });

  it("a member deletes someone else's track directly: 403, the track stays", async () => {
    await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(1) });
    const theirs = await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(2) });

    const res = await member.call('DELETE', `/api/rooms/${code}/queue/${theirs.body.item.id}`);

    expect(res.status).toBe(403);
    const queue = (await member.call('GET', `/api/rooms/${code}/queue`)).body.queue;
    expect(queue.map((q: { id: string }) => q.id)).toEqual([theirs.body.item.id]);
  });
});

describe('concurrent playback/ended (spec: 10 одночасних → усі 200, зсув рівно на 1)', () => {
  it('10 simultaneous reports for the current track move the queue exactly one step', async () => {
    const a = await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(1) });
    const b = await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(2) });
    const c = await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(3) });
    const current = a.body.item.id;
    expect((await owner.call('GET', `/api/rooms/${code}`)).body.playback.current.id).toBe(current);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? owner : member).call('POST', `/api/rooms/${code}/playback/ended`, { itemId: current })),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    const state = (await owner.call('GET', `/api/rooms/${code}`)).body;
    expect(state.playback.current.id).toBe(b.body.item.id);
    expect(state.queue.map((q: { id: string }) => q.id)).toEqual([c.body.item.id]);

    // straight from PostgreSQL: the finished track is played once, nothing was skipped
    const { repos } = deps();
    expect((await repos.queue.find(current))?.status).toBe('played');
    expect((await repos.queue.find(b.body.item.id))?.status).toBe('playing');
    expect((await repos.queue.find(c.body.item.id))?.status).toBe('queued');
  });
});

describe('Idempotency-Key (spec: 2 однакові запити → обидва 201, однакове тіло, 1 трек)', () => {
  it('a retry after a lost response: both 201, the same body, one track', async () => {
    const headers = { 'idempotency-key': `retry-${randomUUID()}` };

    const first = await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(1) }, headers);
    const retry = await owner.call('POST', `/api/rooms/${code}/queue`, { url: track(1) }, headers);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    const state = (await owner.call('GET', `/api/rooms/${code}`)).body;
    expect(state.playback.current.id).toBe(first.body.item.id);
    expect(state.queue).toEqual([]);
  });

  it('two identical requests at the same moment: both 201, the same body, one track', async () => {
    const headers = { 'idempotency-key': `parallel-${randomUUID()}` };

    const [x, y] = await Promise.all([
      owner.call('POST', `/api/rooms/${code}/queue`, { url: track(1) }, headers),
      owner.call('POST', `/api/rooms/${code}/queue`, { url: track(1) }, headers),
    ]);

    expect([x.status, y.status]).toEqual([201, 201]);
    expect(y.body).toEqual(x.body);
    const state = (await owner.call('GET', `/api/rooms/${code}`)).body;
    expect(state.playback.current.id).toBe(x.body.item.id);
    expect(state.queue).toEqual([]);
  });
});
