import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { deps } from '../container';
import type { User } from '../domain/types';
import { ConflictError, RateLimitedError, UnauthenticatedError, ValidationError } from '../errors';

export const SESSION_DAYS = 30;
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,64}$/u;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, SCRYPT.keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// unknown usernames cost as much time as wrong passwords
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/** only the hash of a session token is stored */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** fixed-window limit on failed logins, per IP and per username */
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

function limited(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => {
    const f = failures.get(k);
    return !!f && f.resetAt > now && f.count >= MAX_FAILURES;
  });
}

function recordFailure(keys: string[]) {
  const now = Date.now();
  for (const k of keys) {
    const f = failures.get(k);
    if (!f || f.resetAt <= now) failures.set(k, { count: 1, resetAt: now + WINDOW_MS });
    else f.count++;
  }
}

async function startSession(userId: string): Promise<{ token: string; maxAgeSec: number }> {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSec = SESSION_DAYS * 24 * 60 * 60;
  await deps().repos.sessions.create(hashToken(token), userId, new Date(Date.now() + maxAgeSec * 1000));
  return { token, maxAgeSec };
}

export async function register(username: string, password: string) {
  const name = username.trim();
  if (!USERNAME_RE.test(name)) {
    throw new ValidationError('Логін: від 3 до 64 символів — літери, цифри, крапка, дефіс або підкреслення');
  }
  if (password.length < 8 || password.length > 128) throw new ValidationError('Пароль має бути від 8 до 128 символів');
  const { repos } = deps();
  if (await repos.users.findByUsername(name)) throw new ConflictError('USERNAME_TAKEN', 'Цей логін уже зайнятий');
  const passHash = await hashPassword(password);
  const user = await repos.transaction(async () => {
    // re-check inside the transaction: a parallel registration may have taken the name during hashing
    if (await repos.users.findByUsername(name)) throw new ConflictError('USERNAME_TAKEN', 'Цей логін уже зайнятий');
    return repos.users.create({ username: name, passHash });
  });
  return { user, session: await startSession(user.id) };
}

export async function login(username: string, password: string, ip: string) {
  const keys = [`ip:${ip}`, `user:${username.trim().toLowerCase()}`];
  if (limited(keys)) throw new RateLimitedError('Забагато невдалих спроб входу. Спробуйте через 15 хвилин');
  const row = await deps().repos.users.findByUsername(username.trim());
  const ok = await verifyPassword(password, row?.passHash ?? (await DUMMY_HASH));
  if (!row || !ok) {
    recordFailure(keys);
    throw new UnauthenticatedError('Невірний логін або пароль');
  }
  const { passHash: _, ...user } = row;
  return { user: user, session: await startSession(row.id) };
}

export async function logout(token: string | undefined) {
  if (token) await deps().repos.sessions.delete(hashToken(token));
}

export async function userForToken(token: string | undefined): Promise<User | undefined> {
  return token ? deps().repos.sessions.findUser(hashToken(token)) : undefined;
}
