/**
 * Minimal smoke test: start the real server (in-memory storage, static sources) and walk the happy path.
 *   npm run smoke
 * Exits non-zero on the first failure; used by the pre-push hook. Needs no database or network.
 */
import { spawn } from 'node:child_process';

const STARTUP_TIMEOUT_MS = 20000;
const port = 40000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
  env: { ...process.env, PORT: String(port), STORAGE: 'memory', SOURCES: 'static', SEED: '0', LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (d) => (output += d));
server.stderr.on('data', (d) => (output += d));

async function stop(code: number): Promise<never> {
  if (server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  process.exit(code);
}

async function expect(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) {
    if (detail !== undefined) console.error(detail);
    await stop(1);
  }
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      await fetch(`${base}/healthz`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.error(output);
  await expect('server starts', false);
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

await waitForServer();
const health = await fetch(`${base}/healthz`);
await expect('server starts and /healthz is ok', health.status === 200);

const anon = await fetch(`${base}/api/me`);
await expect('anonymous /api/me is 401', anon.status === 401);

const reg = await fetch(`${base}/api/auth/register`, json({ username: 'smoke_user', password: 'smoke-password' }));
const cookie = reg.headers.get('set-cookie')?.split(';')[0] ?? '';
await expect('register returns 201 and a session cookie', reg.status === 201 && cookie.startsWith('vv_session='), await reg.text());

const room = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { cookie } });
const { code } = (await room.json()) as { code?: string };
await expect('signed-in user creates a room', room.status === 201 && /^[A-Z0-9]{6}$/.test(code ?? ''), code);

const add = await fetch(`${base}/api/rooms/${code}/queue`, {
  ...json({ url: 'https://www.youtube.com/watch?v=smoke000001' }),
  headers: { 'content-type': 'application/json', cookie },
});
await expect('a track is added to the queue', add.status === 201, await add.text());

const state = await fetch(`${base}/api/rooms/${code}`, { headers: { cookie } });
const s = (await state.json()) as { playback?: { current?: { id: string } | null } };
await expect('the room state shows the track as current', state.status === 200 && !!s.playback?.current, s);

await stop(0);
