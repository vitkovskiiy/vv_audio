import { setDeps } from '../container';
import { runInContext } from '../context';
import type { Plan, QueueItem, Room, User } from '../domain/types';
import { configureLogger } from '../logger';
import { createMemoryRepositories } from '../repositories/memory';
import type { Repositories } from '../repositories/ports';
import { staticMetadata } from '../services/metadata';
import { createRoom, joinRoom } from '../services/rooms.service';

configureLogger(undefined, 'silent');

/**
 * A fresh in-memory world for unit tests: real services and real business rules,
 * only the storage is the in-memory repository (the same one `npm run scenarios` uses).
 */
export function createWorld() {
  const repos: Repositories = createMemoryRepositories();
  const events: { code: string; reason: string }[] = [];
  setDeps({
    repos,
    metadata: staticMetadata,
    searchProviders: [],
    events: { roomChanged: (code, reason) => events.push({ code, reason }), roomDeleted: () => {} },
  });

  let n = 0;
  const user = (plan: Plan = 'free', name = `user${++n}`) => repos.users.create({ username: name, passHash: 'x', plan });
  const as = <T>(u: User, fn: () => Promise<T>) => runInContext({ bpId: `test-${u.username}`, user: u }, fn);

  /** owner creates a room, the others join it */
  async function room(owner: User, ...members: User[]): Promise<Room> {
    const { body } = await as(owner, () => createRoom(undefined));
    for (const m of members) await as(m, () => joinRoom(body.code));
    return (await repos.rooms.findByCode(body.code))!;
  }

  /** puts a queued item straight into the queue, so a test can lay out an exact order */
  async function put(r: Room, by: User, opts: { premium?: boolean; locked?: boolean } = {}): Promise<QueueItem> {
    const track = await repos.tracks.upsert({ source: 'youtube', ref: `ref${++n}`, title: `t${n}`, artist: null, thumbnail: null });
    return repos.queue.add({
      roomId: r.id,
      trackId: track.id,
      addedBy: by.id,
      isPremium: opts.premium ?? by.plan === 'premium',
      status: 'queued',
      locked: opts.locked ?? false,
    });
  }

  /** ids of the upcoming queue, in play order */
  const order = async (r: Room) => (await repos.queue.upcoming(r.id)).map((e) => e.id);

  return { repos, events, user, as, room, put, order };
}

export type World = ReturnType<typeof createWorld>;
