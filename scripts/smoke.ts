/**
 * Minimal smoke test: start the real server on a throwaway database and walk the happy path.
 *   npm run smoke
 * Exits non-zero on the first failure; used by the pre-push hook.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const STARTUP_TIMEOUT_MS = 20000;
const port = 40000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const dir = mkdtempSync(path.join(tmpdir(), 'vv-smoke-'));

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'smoke.db') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (d) => (output += d));
server.stderr.on('data', (d) => (output += d));

async function stop(code: number): Promise<never> {
  // wait for the server to exit: on Windows it still holds the database file until then
  if (server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      await fetch(`${base}/api/auth/me`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.error(output);
  await expect('server starts', false);
}

await waitForServer();
await expect('server starts', true);

const me = await fetch(`${base}/api/auth/me`);
await expect(
  'anonymous /api/auth/me answers 200 with no user',
  me.status === 200 && ((await me.json()) as { user: unknown }).user === null,
);

const reg = await fetch(`${base}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'smoke_user', password: 'smoke-password' }),
});
const cookie = reg.headers.get('set-cookie')?.split(';')[0] ?? '';
await expect('register returns a session cookie', reg.status === 200 && cookie.startsWith('vv_session='), await reg.text());

const room = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { cookie } });
const body = (await room.json()) as { roomId?: string };
await expect('signed-in user creates a room', room.status === 200 && /^[A-Z0-9]{6}$/.test(body.roomId ?? ''), body);

await stop(0);
