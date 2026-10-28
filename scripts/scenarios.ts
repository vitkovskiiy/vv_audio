/**
 * Runs every main scenario through the public HTTP API of a freshly started server.
 * Each check is labelled with the acceptance criterion it proves (K1…K18 from ai/09–ai/11).
 *   npm run scenarios                      — static prototype (in-memory storage)
 */
import { buildApp } from '../server/app';
import { createDeps, settingsFromEnv } from '../server/bootstrap';
import { deps, setDeps } from '../server/container';
import { runInNewContext } from '../server/context';
import { configureLogger } from '../server/logger';
import { hashPassword } from '../server/services/auth.service';

configureLogger(undefined, process.env.LOG_LEVEL ?? 'silent');

let failed = 0;
let passed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `  → ${JSON.stringify(detail)}` : ''}`);
}

/** a crash inside one scenario group counts as a failure of that group; the others still run */
async function block(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    check(`${name}: scenario crashed`, false, err instanceof Error ? err.message : String(err));
  }
}

interface Res {
  status: number;
  body: any;
  headers: Headers;
}

class Client {
  cookie = '';
  constructor(
    readonly base: string,
    readonly name: string,
  ) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await fetch(this.base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}, h?: Record<string, string>) => this.req('POST', p, b, h);
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  del = (p: string) => this.req('DELETE', p);
}

const run = Date.now().toString(36);
let ytCounter = 0;
const nextYt = () => `https://www.youtube.com/watch?v=s${run.slice(-5)}${String(++ytCounter).padStart(5, '0')}`;

await runInNewContext(async () => {
  const settings = { ...settingsFromEnv(), sources: 'static' as const, seed: false };
  setDeps(await createDeps(settings));
  const app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  console.log(`scenarios against ${base} (storage=${settings.storage})\n`);

  const user = async (name: string) => {
    const c = new Client(base, `${name}_${run}`);
    const r = await c.post('/api/auth/register', { username: c.name, password: 'password123' });
    if (r.status !== 201) throw new Error(`register ${c.name}: ${r.status} ${JSON.stringify(r.body)}`);
    return c;
  };
  // admin is provisioned out of band (no public sign-up path for admins)
  const adminName = `admin_${run}`;
  await deps().repos.users.create({ username: adminName, passHash: await hashPassword('password123'), isAdmin: true });
  const admin = new Client(base, adminName);
  await admin.post('/api/auth/login', { username: adminName, password: 'password123' });
  const makePremium = (c: Client) => admin.put(`/api/admin/users/${c.name}/plan`, { plan: 'premium' });
  const newRoom = async (owner: Client, ...members: Client[]) => {
    const { code } = (await owner.post('/api/rooms')).body;
    for (const m of members) await m.post(`/api/rooms/${code}/join`);
    return code as string;
  };
  const add = (c: Client, code: string, url = nextYt()) => c.post(`/api/rooms/${code}/queue`, { url });
  const upcoming = async (c: Client, code: string) => (await c.get(`/api/rooms/${code}/queue`)).body.queue as any[];
  const state = async (c: Client, code: string) => (await c.get(`/api/rooms/${code}`)).body;

  await block('S1 auth', async () => {
    const a = await user('auth');
    check('S1 register returns 201 and a session (me works)', (await a.get('/api/me')).body.user.username === a.name);
    const dup = await new Client(base, '').post('/api/auth/register', { username: a.name.toUpperCase(), password: 'password123' });
    check('S1 same login in another case → 409 USERNAME_TAKEN', dup.status === 409 && dup.body.error.code === 'USERNAME_TAKEN', dup.body);
    const long = await new Client(base, '').post('/api/auth/register', { username: 'x'.repeat(64), password: 'password123' });
    const tooLong = await new Client(base, '').post('/api/auth/register', { username: 'y'.repeat(65), password: 'password123' });
    check('S1 login of 64 chars accepted, 65 → 400 VALIDATION_ERROR', long.status === 201 && tooLong.status === 400 && tooLong.body.error.code === 'VALIDATION_ERROR');
    const wrong = await new Client(base, '').post('/api/auth/login', { username: a.name, password: 'wrong-password' });
    check('S1 wrong password → 401 UNAUTHENTICATED', wrong.status === 401 && wrong.body.error.code === 'UNAUTHENTICATED');
    await a.post('/api/auth/logout');
    check('S1 after logout the session is gone → 401', (await a.get('/api/me')).status === 401);
  });

  await block('K14 bpId in header and error body', async () => {
    const r = await new Client(base, '').get('/api/rooms/mine');
    check('K14 error body carries the same bpId as the x-bp-id header', r.status === 401 && r.body.error.bpId === r.headers.get('x-bp-id'), r.body);
  });

  await block('S2/S3 rooms, K5 limit', async () => {
    const owner = await user('owner5');
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await owner.post('/api/rooms');
      if (r.status === 201) codes.push(r.body.code);
    }
    check('K5 free user creates rooms 1–5 → 201 each', codes.length === 5);
    const sixth = await owner.post('/api/rooms');
    check('K5 sixth room on free plan → 402 ROOM_LIMIT_EXCEEDED', sixth.status === 402 && sixth.body.error.code === 'ROOM_LIMIT_EXCEEDED', sixth.body);
    check('K5 nothing was created by the refused request', (await owner.get('/api/rooms/mine')).body.rooms.length === 5);
    await makePremium(owner);
    check('K5 premium has no room limit → 201', (await owner.post('/api/rooms')).status === 201);

    const stranger = await user('stranger');
    check('S3 non-member reading a room → 403', (await stranger.get(`/api/rooms/${codes[0]}`)).status === 403);
    check('S3 unknown room code → 404', (await stranger.post('/api/rooms/ZZZZZZ/join')).status === 404);
    const joined = await stranger.post(`/api/rooms/${codes[0]}/join`);
    check('S3 join by code → 200 as member', joined.status === 200 && joined.body.me.role === 'member');
  });

  await block('K9 idempotent add', async () => {
    const o = await user('idem');
    const code = await newRoom(o);
    const url = nextYt();
    const h = { 'idempotency-key': `key-${run}-1` };
    const first = await o.post(`/api/rooms/${code}/queue`, { url }, h);
    const again = await o.post(`/api/rooms/${code}/queue`, { url }, h);
    const s = await state(o, code);
    const count = s.queue.length + (s.playback.current ? 1 : 0);
    check('K9 retry with the same Idempotency-Key → same 201 answer', first.status === 201 && again.status === 201 && again.body.item.id === first.body.item.id);
    check('K9 …and still exactly one track in the room', count === 1, { count });
    const other = await o.post(`/api/rooms/${code}/queue`, { url: nextYt() }, h);
    check('K9 same key with a different body → 422 IDEMPOTENCY_KEY_REUSED', other.status === 422 && other.body.error.code === 'IDEMPOTENCY_KEY_REUSED');
    const msgKey = { 'idempotency-key': `key-${run}-msg` };
    await o.post(`/api/rooms/${code}/messages`, { text: 'привіт' }, msgKey);
    await o.post(`/api/rooms/${code}/messages`, { text: 'привіт' }, msgKey);
    const mine = (await o.get(`/api/rooms/${code}/messages`)).body.messages.filter((m: any) => m.kind === 'user');
    check('K9 chat message retried with the same key is stored once', mine.length === 1, mine.length);
  });

  await block('K10 five clients report the same end', async () => {
    const o = await user('k10owner');
    const members = await Promise.all([1, 2, 3, 4].map((i) => user(`k10m${i}`)));
    const code = await newRoom(o, ...members);
    for (let i = 0; i < 4; i++) await add(o, code);
    const before = await state(o, code);
    const playing = before.playback.current.id;
    const expectedNext = before.queue[0].id;
    const reports = await Promise.all([o, ...members].map((c) => c.post(`/api/rooms/${code}/playback/ended`, { itemId: playing })));
    const after = await state(o, code);
    check('K10 five simultaneous "ended" reports all get 200', reports.every((r) => r.status === 200));
    check('K10 …and the queue moved exactly one track', after.playback.current.id === expectedNext && after.queue.length === before.queue.length - 1, {
      expectedNext,
      got: after.playback.current?.id,
    });
    const late = await o.post(`/api/rooms/${code}/playback/next`, { expectedItemId: playing });
    check('Fork 1: a late "next" for an old track → 200 with the current state, nothing skipped', late.status === 200 && late.body.playback.current.id === expectedNext);
  });

  await block('K3 / K4 / K6 / K7 / K8 requests and removal', async () => {
    const o = await user('reqowner');
    const m = await user('reqmember');
    const m2 = await user('reqother');
    const code = await newRoom(o, m, m2);
    await add(o, code); // becomes current
    const mine = (await add(m, code)).body.item.id;
    const owners = (await add(o, code)).body.item.id;
    const others = (await add(m2, code)).body.item.id;

    const skipDirect = await m.post(`/api/rooms/${code}/playback/next`, { expectedItemId: null });
    check('K3 member pressing "next" → 403 (only the owner controls playback)', skipDirect.status === 403);
    const current = (await state(m, code)).playback.current.id;
    const skipReq = await m.post(`/api/rooms/${code}/requests`, { type: 'skip', itemId: current });
    check('K3 member asks the owner to skip instead → 201 pending request', skipReq.status === 201 && skipReq.body.status === 'pending');
    const approvedSkip = await o.post(`/api/rooms/${code}/requests/${skipReq.body.id}/decision`, { decision: 'approve' });
    check('K3 owner approves the skip → track changes', approvedSkip.status === 200 && (await state(o, code)).playback.current.id !== current);

    check('K4 author removes own track at once → 204', (await m.del(`/api/rooms/${code}/queue/${mine}`)).status === 204);
    const foreign = await m.del(`/api/rooms/${code}/queue/${owners}`);
    check("K4 member removing someone else's track directly → 403", foreign.status === 403 && foreign.body.error.code === 'FORBIDDEN');
    check('Fork 2: removing a track that is already gone → 404', (await m.del(`/api/rooms/${code}/queue/${mine}`)).status === 404);

    const r1 = await m.post(`/api/rooms/${code}/requests`, { type: 'remove', itemId: owners });
    const r2 = await m.post(`/api/rooms/${code}/requests`, { type: 'remove', itemId: owners });
    const pending = (await state(o, code)).requests.filter((r: any) => r.itemId === owners);
    check('K6 the same removal request twice → 201 then 200 with the same request', r1.status === 201 && r2.status === 200 && r2.body.id === r1.body.id);
    check('K6 …and only one request exists', pending.length === 1, pending.length);

    const approve1 = await o.post(`/api/rooms/${code}/requests/${r1.body.id}/decision`, { decision: 'approve' });
    const approve2 = await o.post(`/api/rooms/${code}/requests/${r1.body.id}/decision`, { decision: 'approve' });
    const reject = await o.post(`/api/rooms/${code}/requests/${r1.body.id}/decision`, { decision: 'reject' });
    check('K7 approve → 200, the same approve again → 200', approve1.status === 200 && approve2.status === 200);
    check('K7 the opposite decision afterwards → 409 REQUEST_ALREADY_DECIDED', reject.status === 409 && reject.body.error.code === 'REQUEST_ALREADY_DECIDED');
    check('K7 the approved track left the queue', !(await upcoming(o, code)).some((e) => e.id === owners));

    const r3 = await m.post(`/api/rooms/${code}/requests`, { type: 'remove', itemId: others });
    await m2.del(`/api/rooms/${code}/queue/${others}`); // its author removes it meanwhile
    const late = await o.post(`/api/rooms/${code}/requests/${r3.body.id}/decision`, { decision: 'approve' });
    check('K8 approving a request whose track already left → 409 REQUEST_OBSOLETE', late.status === 409 && late.body.error.code === 'REQUEST_OBSOLETE', late.body);
    check('K8 non-owner deciding → 403', (await m.post(`/api/rooms/${code}/requests/${r3.body.id}/decision`, { decision: 'approve' })).status === 403);
  });

  await block('K1 premium moves, K2 play next', async () => {
    const o = await user('k1owner');
    const r = await user('k1free');
    const pa = await user('k1premA');
    const pb = await user('k1premB');
    await Promise.all([makePremium(pa), makePremium(pb)]);
    const code = await newRoom(o, r, pa, pb);
    await add(o, code); // current
    const R1 = (await add(r, code)).body.item.id;
    const R2 = (await add(r, code)).body.item.id;
    const PA = (await add(pa, code)).body.item.id;
    const PB = (await add(pb, code)).body.item.id;
    const ids = async () => (await upcoming(o, code)).map((e) => e.id);

    const blocked = await pb.post(`/api/rooms/${code}/queue/${PB}/move`, { direction: 'up' });
    check("K1 premium can't pass another premium user's earlier track → 409 MOVE_NOT_ALLOWED", blocked.status === 409 && blocked.body.error.code === 'MOVE_NOT_ALLOWED');
    await pa.post(`/api/rooms/${code}/queue/${PA}/move`, { direction: 'up' });
    await pa.post(`/api/rooms/${code}/queue/${PA}/move`, { direction: 'up' });
    check('K1 premium raises own track above regular tracks', JSON.stringify(await ids()) === JSON.stringify([PA, R1, R2, PB]), await ids());
    check('K1 premium can move own track down', (await pa.post(`/api/rooms/${code}/queue/${PA}/move`, { direction: 'down' })).status === 200);
    const freeMove = await r.post(`/api/rooms/${code}/queue/${R2}/move`, { direction: 'up' });
    check('K1 free user cannot move tracks → 403', freeMove.status === 403);
    const notMine = await pa.post(`/api/rooms/${code}/queue/${R2}/move`, { direction: 'up' });
    check("K1 premium cannot move someone else's track → 403", notMine.status === 403);

    // order is now R1, PA, R2, PB; two more premium tracks are appended: R1, PA, R2, PB, PA2, PA3
    await add(pa, code);
    await add(pa, code);
    // moving PA down would make PA, PB, PA2, PA3 four premium tracks in a row
    const runLimit = await pa.post(`/api/rooms/${code}/queue/${PA}/move`, { direction: 'down' });
    check('K1 a move that creates a longer premium run than allowed (> 2) → 409', runLimit.status === 409 && runLimit.body.error.code === 'MOVE_NOT_ALLOWED', runLimit.body);

    // K2: the owner has no premium, so their "play next" can still be overtaken by a premium user
    await o.post(`/api/rooms/${code}/queue/${R2}/play-next`);
    check('K2 owner "play next" puts the track first', (await ids())[0] === R2);
    await pa.post(`/api/rooms/${code}/queue/${PA}/move`, { direction: 'up' });
    const overFreeOwner = await pa.post(`/api/rooms/${code}/queue/${PA}/move`, { direction: 'up' });
    check('K2 owner without premium: a premium user can move above the "play next" track', overFreeOwner.status === 200 && (await ids())[0] === PA, await ids());

    // owner with premium → their "play next" is protected
    const po = await user('k2premOwner');
    await makePremium(po);
    const pc = await user('k2premC');
    await makePremium(pc);
    const code2 = await newRoom(po, pc);
    await add(po, code2); // current
    const X = (await add(po, code2)).body.item.id;
    const PC = (await add(pc, code2)).body.item.id;
    await po.post(`/api/rooms/${code2}/queue/${X}/play-next`);
    const protectedMove = await pc.post(`/api/rooms/${code2}/queue/${PC}/move`, { direction: 'up' });
    check('K2 premium owner\'s "play next" cannot be overtaken → 409', protectedMove.status === 409);
  });

  await block('K11 metadata source outage', async () => {
    const o = await user('k11');
    const code = await newRoom(o);
    const t0 = Date.now();
    const r = await o.post(`/api/rooms/${code}/queue`, { url: 'https://www.youtube.com/watch?v=FAILMETA001' });
    const ms = Date.now() - t0;
    check('K11 provider down → track still added (201) with fallback title', r.status === 201 && r.body.metadataFallback === true && r.body.item.track.title === 'Трек YouTube', r.body);
    check('K11 …after retries (≥ 800 ms of backoff) and within 8 s', ms >= 800 && ms < 8000, { ms });
    const bad = await o.post(`/api/rooms/${code}/queue`, { url: 'https://example.com/song' });
    check('S5 unsupported link → 400 VALIDATION_ERROR', bad.status === 400 && bad.body.error.code === 'VALIDATION_ERROR');
  });

  await block('K12 search provider outage', async () => {
    const c = await user('k12');
    const r = await c.get('/api/search?q=fail%20song');
    const sc = r.body.groups.find((g: any) => g.source === 'soundcloud');
    const ytg = r.body.groups.find((g: any) => g.source === 'youtube');
    check('K12 one search provider fails → 200, its group has error, others have results', r.status === 200 && !!sc.error && ytg.results.length > 0, r.body);
  });

  await block('chat, favorites, my rooms', async () => {
    const o = await user('social');
    const code = await newRoom(o);
    const empty = await o.post(`/api/rooms/${code}/messages`, { text: '   ' });
    check('S11 empty ("ghost") chat message → 400', empty.status === 400);
    const added = await add(o, code);
    const trackId = added.body.item.track.id;
    await o.put(`/api/favorites/${trackId}`);
    await o.put(`/api/favorites/${trackId}`);
    const favs = (await o.get('/api/favorites')).body.favorites;
    check('S12 favourite added twice is stored once', favs.length === 1 && favs[0].id === trackId);
    await o.del(`/api/favorites/${trackId}`);
    check('S12 favourite removed', (await o.get('/api/favorites')).body.favorites.length === 0);
    const mine = (await o.get('/api/rooms/mine')).body.rooms;
    check('S13 my rooms shows the room with its current track', mine.some((r: any) => r.code === code && r.currentTitle));
    const nonAdmin = await o.put(`/api/admin/users/${o.name}/plan`, { plan: 'premium' });
    check('S15 non-admin granting premium → 403', nonAdmin.status === 403);
  });

  await block('K18 delete room', async () => {
    const o = await user('k18owner');
    const m = await user('k18member');
    const code = await newRoom(o, m);
    await add(o, code);
    check('K18 non-owner deleting the room → 403', (await m.del(`/api/rooms/${code}`)).status === 403);
    check('K18 owner deletes the room → 204', (await o.del(`/api/rooms/${code}`)).status === 204);
    check("K18 the room disappears from the other member's list", !(await m.get('/api/rooms/mine')).body.rooms.some((r: any) => r.code === code));
    check('K18 the room no longer exists → 404', (await m.get(`/api/rooms/${code}`)).status === 404);
  });

  await app.close();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
