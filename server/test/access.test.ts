import { beforeEach, describe, expect, it } from 'vitest';
import { runInContext } from '../context';
import type { User } from '../domain/types';
import { findRoom, normalizeCode, requireMember, requireOwner, requireUser } from '../services/access';
import { createWorld, type World } from './world';

let w: World;
let owner: User;
let member: User;
let stranger: User;

beforeEach(async () => {
  w = createWorld();
  owner = await w.user('free', 'owner');
  member = await w.user('free', 'member');
  stranger = await w.user('free', 'stranger');
});

describe('access', () => {
  it('requireUser: no user in the context is 401', async () => {
    expect(() => runInContext({ bpId: 'anon' }, () => requireUser())).toThrow(expect.objectContaining({ status: 401 }));
    await expect(w.as(owner, async () => requireUser())).resolves.toEqual(owner);
  });

  it('normalizeCode: case and separators do not matter, length is capped at 12', () => {
    expect(normalizeCode(' ab-c 12 ')).toBe('ABC12');
    expect(normalizeCode('a'.repeat(20))).toBe('A'.repeat(12));
  });

  it('findRoom: an unknown code is 404', async () => {
    await expect(findRoom('NOPE')).rejects.toMatchObject({ status: 404, message: 'Такої кімнати немає' });
  });

  it('requireMember: members pass with their role; strangers get 403', async () => {
    const room = await w.room(owner, member);
    const lower = room.code.toLowerCase();

    expect((await w.as(member, () => requireMember(lower))).member.role).toBe('member');
    await expect(w.as(stranger, () => requireMember(room.code))).rejects.toMatchObject({
      status: 403,
      message: 'Ви не учасник цієї кімнати',
    });
  });

  it('requireOwner: only the owner passes; a member gets 403', async () => {
    const room = await w.room(owner, member);

    expect((await w.as(owner, () => requireOwner(room.code))).member.role).toBe('owner');
    await expect(w.as(member, () => requireOwner(room.code))).rejects.toMatchObject({
      status: 403,
      message: 'Це може робити лише власник кімнати',
    });
  });
});
