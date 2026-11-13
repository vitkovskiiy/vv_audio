import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room, User } from '../domain/types';
import { control, currentPosition, ended, next } from '../services/playback.service';
import { addTrack } from '../services/queue.service';
import { createWorld, type World } from './world';

let w: World;
let owner: User;
let member: User;
let room: Room;

const add = (ref: string) => w.as(owner, () => addTrack(room.code, `https://youtu.be/${ref.padEnd(11, ref)}`, undefined));
const current = async () => (await w.repos.playback.get(room.id)).currentItemId;

beforeEach(async () => {
  w = createWorld();
  owner = await w.user('free', 'owner');
  member = await w.user('free', 'member');
  room = await w.room(owner, member);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('currentPosition', () => {
  it('a paused track stays where it is; a playing one moves with the clock', () => {
    vi.useFakeTimers({ now: new Date('2026-11-13T10:00:10Z') });
    const base = { roomId: 'r', currentItemId: 'i', positionSec: 5, updatedAt: new Date('2026-11-13T10:00:00Z') };
    expect(currentPosition({ ...base, isPlaying: false })).toBe(5);
    expect(currentPosition({ ...base, isPlaying: true })).toBe(15);
  });
});

describe('ended — any member reports the end of the track (spec: зсув рівно на 1)', () => {
  it('advances to the next track and marks the finished one played', async () => {
    const a = await add('a');
    const b = await add('b');

    const state = await w.as(member, () => ended(room.code, a.body.item.id));

    expect(await current()).toBe(b.body.item.id);
    expect((await w.repos.queue.find(a.body.item.id))?.status).toBe('played');
    expect((await w.repos.queue.find(b.body.item.id))?.status).toBe('playing');
    expect(state.playback.current?.id).toBe(b.body.item.id);
    expect(w.events.at(-1)).toEqual({ code: room.code, reason: 'track-ended' });
  });

  it('a late duplicate for the same track changes nothing and does not notify', async () => {
    const a = await add('a');
    const b = await add('b');
    const c = await add('c');
    await w.as(member, () => ended(room.code, a.body.item.id));
    const eventsBefore = w.events.length;

    await w.as(owner, () => ended(room.code, a.body.item.id));

    expect(await current()).toBe(b.body.item.id);
    expect(await w.order(room)).toEqual([c.body.item.id]);
    expect(w.events).toHaveLength(eventsBefore);
  });

  it('the last track ending leaves the room stopped at 0', async () => {
    const a = await add('a');
    await w.as(owner, () => control(room.code, 'play'));

    await w.as(member, () => ended(room.code, a.body.item.id));

    const pb = await w.repos.playback.get(room.id);
    expect(pb).toMatchObject({ currentItemId: null, isPlaying: false, positionSec: 0 });
  });

  it('strangers cannot report: 403', async () => {
    const a = await add('a');
    const stranger = await w.user('free', 'stranger');
    await expect(w.as(stranger, () => ended(room.code, a.body.item.id))).rejects.toMatchObject({ status: 403 });
  });
});

describe('next — the owner skips', () => {
  it('skips the expected current track; a stale expectation is a no-op', async () => {
    const a = await add('a');
    const b = await add('b');

    await w.as(owner, () => next(room.code, a.body.item.id));
    const eventsBefore = w.events.length;
    await w.as(owner, () => next(room.code, a.body.item.id));

    expect(await current()).toBe(b.body.item.id);
    expect(w.events).toHaveLength(eventsBefore);
    expect(w.events.at(-1)).toEqual({ code: room.code, reason: 'next' });
  });

  it('members cannot: 403', async () => {
    const a = await add('a');
    await expect(w.as(member, () => next(room.code, a.body.item.id))).rejects.toMatchObject({ status: 403 });
  });
});

describe('control — play, pause, seek (owner only)', () => {
  it('play starts from the given or current position, pause keeps it', async () => {
    await add('a');

    await w.as(owner, () => control(room.code, 'play', 12));
    expect(await w.repos.playback.get(room.id)).toMatchObject({ isPlaying: true, positionSec: 12 });

    await w.as(owner, () => control(room.code, 'pause', 30));
    expect(await w.repos.playback.get(room.id)).toMatchObject({ isPlaying: false, positionSec: 30 });

    await w.as(owner, () => control(room.code, 'play'));
    expect(await w.repos.playback.get(room.id)).toMatchObject({ isPlaying: true, positionSec: 30 });
    expect(w.events.at(-1)).toEqual({ code: room.code, reason: 'playback-play' });
  });

  it('pause without a position freezes the current one', async () => {
    await add('a');
    await w.as(owner, () => control(room.code, 'pause'));
    expect(await w.repos.playback.get(room.id)).toMatchObject({ isPlaying: false, positionSec: 0 });
  });

  it('seek moves the position without changing play/pause; negative or missing is 0', async () => {
    await add('a');
    await w.as(owner, () => control(room.code, 'play', 3));

    await w.as(owner, () => control(room.code, 'seek', 42));
    expect(await w.repos.playback.get(room.id)).toMatchObject({ isPlaying: true, positionSec: 42 });

    await w.as(owner, () => control(room.code, 'seek', -5));
    expect((await w.repos.playback.get(room.id)).positionSec).toBe(0);

    await w.as(owner, () => control(room.code, 'seek', 10));
    await w.as(owner, () => control(room.code, 'seek'));
    expect((await w.repos.playback.get(room.id)).positionSec).toBe(0);
  });

  it('an empty room has nothing to play: 409; members cannot control: 403', async () => {
    await expect(w.as(owner, () => control(room.code, 'play'))).rejects.toMatchObject({ status: 409, code: 'NOTHING_TO_PLAY' });
    await add('a');
    await expect(w.as(member, () => control(room.code, 'play'))).rejects.toMatchObject({ status: 403 });
  });
});
