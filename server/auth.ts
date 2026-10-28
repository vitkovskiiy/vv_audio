import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import type { User } from '../shared/types';
import { sessions, usernameKey, users } from './db';

const COOKIE = 'vv_session';
const SESSION_DAYS = 30;
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, SCRYPT.keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

async function hashPassword(password: string): Promise<string> {
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

// a fixed hash so unknown usernames cost as much time as wrong passwords
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

/** only the hash of a session token is stored, so a leaked database can't be used to log in */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function userFromCookie(header: string | undefined): User | undefined {
  const token = parseCookies(header)[COOKIE];
  return token ? sessions.user(hashToken(token)) : undefined;
}

function startSession(req: Request, res: Response, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  sessions.create(hashToken(token), userId, Date.now() + maxAge);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge, path: '/' });
}

/** fixed-window limit on failed logins, per IP and per username */
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isLimited(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => {
    const f = failures.get(k);
    return f && f.resetAt > now && f.count >= MAX_FAILURES;
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

setInterval(() => {
  const now = Date.now();
  for (const [k, f] of failures) if (f.resetAt <= now) failures.delete(k);
  sessions.purgeExpired();
}, 60 * 60 * 1000).unref();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = userFromCookie(req.headers.cookie);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Войдите в аккаунт' });
    return;
  }
  next();
}

function readCredentials(body: unknown): { username: string; password: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  return { username: String(b.username ?? '').trim(), password: String(b.password ?? '') };
}

export const authRouter = Router();

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post('/register', async (req, res) => {
  const { username, password } = readCredentials(req.body);
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: 'Логин: от 3 до 24 символов, буквы, цифры, точка, дефис или подчёркивание' });
    return;
  }
  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Пароль должен быть от 8 до 128 символов' });
    return;
  }
  if (users.byName(username)) {
    res.status(409).json({ error: 'Этот логин уже занят' });
    return;
  }
  const passHash = await hashPassword(password);
  // re-check after the slow hash: a parallel request may have taken the name meanwhile
  if (users.byName(username)) {
    res.status(409).json({ error: 'Этот логин уже занят' });
    return;
  }
  const user = users.create(username, passHash);
  startSession(req, res, user.id);
  res.json({ user });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = readCredentials(req.body);
  const keys = [`ip:${req.ip}`, `user:${usernameKey(username)}`];
  if (isLimited(keys)) {
    res.status(429).json({ error: 'Слишком много неудачных попыток. Попробуйте через 15 минут' });
    return;
  }
  const row = users.byName(username);
  const ok = await verifyPassword(password, row?.pass_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    recordFailure(keys);
    res.status(401).json({ error: 'Неверный логин или пароль' });
    return;
  }
  startSession(req, res, row.id);
  res.json({ user: { id: row.id, username: row.username } });
});

authRouter.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) sessions.delete(hashToken(token));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});
