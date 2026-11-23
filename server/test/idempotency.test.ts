import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../domain/types';
import { idempotent } from '../services/idempotency';
import { createWorld, type World } from './world';

let w: World;
let user: User;
let other: User;
let calls: number;
const op = () => {
  calls++;
  return Promise.resolve({ n: calls });
};

beforeEach(async () => {
  w = createWorld();
  user = await w.user('free', 'u');
  other = await w.user('free', 'o');
  calls = 0;
});

describe('idempotent', () => {
  it('without a key the operation simply runs every time', async () => {
    const a = await w.as(user, () => idempotent(undefined, 's', { x: 1 }, 201, op));
    const b = await w.as(user, () => idempotent(undefined, 's', { x: 1 }, 201, op));
    expect(a).toEqual({ status: 201, body: { n: 1 }, replayed: false });
    expect(b).toEqual({ status: 201, body: { n: 2 }, replayed: false });
  });

  it('the same key and request runs once and replays the stored status and body', async () => {
    const a = await w.as(user, () => idempotent('key-00001', 's', { x: 1 }, 201, op));
    const b = await w.as(user, () => idempotent('key-00001', 's', { x: 1 }, 200, op));
    expect(calls).toBe(1);
    expect(a).toEqual({ status: 201, body: { n: 1 }, replayed: false });
    expect(b).toEqual({ status: 201, body: { n: 1 }, replayed: true });
  });

  it('the same key with a different request or scope is 422', async () => {
    await w.as(user, () => idempotent('key-00002', 's', { x: 1 }, 201, op));
    const reused = { status: 422, code: 'IDEMPOTENCY_KEY_REUSED' };
    await expect(w.as(user, () => idempotent('key-00002', 's', { x: 2 }, 201, op))).rejects.toMatchObject(reused);
    await expect(w.as(user, () => idempotent('key-00002', 'other', { x: 1 }, 201, op))).rejects.toMatchObject(reused);
    expect(calls).toBe(1);
  });

  it('keys are per user: the same key from another user runs again', async () => {
    await w.as(user, () => idempotent('key-00003', 's', null, 201, op));
    const b = await w.as(other, () => idempotent('key-00003', 's', null, 201, op));
    expect(b.replayed).toBe(false);
    expect(calls).toBe(2);
  });

  it('a malformed key is 400 and the operation does not run', async () => {
    for (const bad of ['short', 'has space1', 'x'.repeat(129)]) {
      await expect(w.as(user, () => idempotent(bad, 's', null, 201, op))).rejects.toMatchObject({ status: 400 });
    }
    expect(calls).toBe(0);
    await expect(w.as(user, () => idempotent('a'.repeat(8), 's', null, 201, op))).resolves.toMatchObject({ replayed: false });
    await expect(w.as(user, () => idempotent('a_-'.repeat(42) + 'ab', 's', null, 201, op))).resolves.toMatchObject({ replayed: false });
  });

  it('if the operation fails, nothing is stored and a retry runs it again', async () => {
    await expect(w.as(user, () => idempotent('key-00004', 's', null, 201, () => Promise.reject(new Error('boom'))))).rejects.toThrow(
      'boom',
    );
    const b = await w.as(user, () => idempotent('key-00004', 's', null, 201, op));
    expect(b).toEqual({ status: 201, body: { n: 1 }, replayed: false });
  });
});
