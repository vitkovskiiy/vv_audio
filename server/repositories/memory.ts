import { AsyncLocalStorage } from 'node:async_hooks';
import { uuidv7 } from '../domain/ids';
import type {
  IdempotencyRecord,
  Member,
  Message,
  Playback,
  QueueEntry,
  QueueItem,
  Room,
  RoomRequest,
  RoomSummary,
  Track,
  UserWithPassword,
} from '../domain/types';
import type { Repositories } from './ports';

/**
 * Static-data prototype storage: plain maps in process memory.
 * Transactions are real enough to test against: they run one at a time and roll back on error.
 */
interface Store {
  users: Map<string, UserWithPassword>;
  sessions: Map<string, { userId: string; expiresAt: Date }>;
  rooms: Map<string, Room>;
  members: Map<string, Member>;
  playback: Map<string, Playback>;
  tracks: Map<string, Track>;
  queue: Map<string, QueueItem>;
  requests: Map<string, RoomRequest>;
  messages: Message[];
  favorites: Map<string, { userId: string; trackId: string; createdAt: Date }>;
  idempotency: Map<string, IdempotencyRecord>;
}

function emptyStore(): Store {
  return {
    users: new Map(),
    sessions: new Map(),
    rooms: new Map(),
    members: new Map(),
    playback: new Map(),
    tracks: new Map(),
    queue: new Map(),
    requests: new Map(),
    messages: [],
    favorites: new Map(),
    idempotency: new Map(),
  };
}

const memberKey = (roomId: string, userId: string) => `${roomId}:${userId}`;
const copy = <T>(v: T): T => structuredClone(v);

export function createMemoryRepositories(): Repositories {
  let s = emptyStore();
  const inTx = new AsyncLocalStorage<true>();
  let queueTail: Promise<unknown> = Promise.resolve();

  const userName = (id: string) => s.users.get(id)?.username ?? '?';
  const toEntry = (i: QueueItem): QueueEntry => ({
    ...copy(i),
    track: copy(s.tracks.get(i.trackId)!),
    addedByName: userName(i.addedBy),
  });

  const repos: Repositories = {
    users: {
      async create({ username, passHash, plan = 'free', isAdmin = false }) {
        const u: UserWithPassword = { id: uuidv7(), username, passHash, plan, isAdmin };
        s.users.set(u.id, u);
        const { passHash: _, ...user } = u;
        return copy(user);
      },
      async findByUsername(username) {
        const key = username.normalize('NFC').toLowerCase();
        const u = [...s.users.values()].find((x) => x.username.normalize('NFC').toLowerCase() === key);
        return u && copy(u);
      },
      async findById(id) {
        const u = s.users.get(id);
        if (!u) return undefined;
        const { passHash: _, ...user } = u;
        return copy(user);
      },
      async setPlan(id, plan) {
        const u = s.users.get(id);
        if (u) u.plan = plan;
      },
      async lock() {
        // transactions already run one at a time
      },
    },

    sessions: {
      async create(tokenHash, userId, expiresAt) {
        s.sessions.set(tokenHash, { userId, expiresAt });
      },
      async findUser(tokenHash) {
        const sess = s.sessions.get(tokenHash);
        if (!sess || sess.expiresAt <= new Date()) return undefined;
        return repos.users.findById(sess.userId);
      },
      async delete(tokenHash) {
        s.sessions.delete(tokenHash);
      },
      async purgeExpired() {
        let n = 0;
        for (const [k, v] of s.sessions) if (v.expiresAt <= new Date() && s.sessions.delete(k)) n++;
        return n;
      },
    },

    rooms: {
      async create(code) {
        const r: Room = { id: uuidv7(), code, createdAt: new Date() };
        s.rooms.set(r.id, r);
        return copy(r);
      },
      async findByCode(code) {
        const r = [...s.rooms.values()].find((x) => x.code === code);
        return r && copy(r);
      },
      async codeExists(code) {
        return [...s.rooms.values()].some((x) => x.code === code);
      },
      async delete(id) {
        s.rooms.delete(id);
        s.playback.delete(id);
        for (const [k, m] of s.members) if (m.roomId === id) s.members.delete(k);
        for (const [k, q] of s.queue) if (q.roomId === id) s.queue.delete(k);
        for (const [k, r] of s.requests) if (r.roomId === id) s.requests.delete(k);
        s.messages = s.messages.filter((m) => m.roomId !== id);
      },
      async countOwnedBy(userId) {
        return [...s.members.values()].filter((m) => m.userId === userId && m.role === 'owner').length;
      },
      async summariesFor(userId) {
        const out: RoomSummary[] = [];
        for (const m of s.members.values()) {
          if (m.userId !== userId) continue;
          const room = s.rooms.get(m.roomId)!;
          const owner = [...s.members.values()].find((x) => x.roomId === m.roomId && x.role === 'owner');
          const pb = s.playback.get(m.roomId);
          const current = pb?.currentItemId ? s.queue.get(pb.currentItemId) : undefined;
          const track = current && s.tracks.get(current.trackId);
          out.push({
            code: room.code,
            ownerName: owner ? userName(owner.userId) : null,
            role: m.role,
            trackCount: [...s.queue.values()].filter((q) => q.roomId === m.roomId && q.status === 'queued').length,
            currentTitle: track?.title ?? null,
            thumbnail: track?.thumbnail ?? null,
            lastVisit: m.lastVisit,
          });
        }
        return copy(out.sort((a, b) => b.lastVisit.getTime() - a.lastVisit.getTime()));
      },
    },

    members: {
      async add(m) {
        s.members.set(memberKey(m.roomId, m.userId), { ...m, lastVisit: new Date() });
      },
      async find(roomId, userId) {
        const m = s.members.get(memberKey(roomId, userId));
        return m && copy(m);
      },
      async touch(roomId, userId) {
        const m = s.members.get(memberKey(roomId, userId));
        if (m) m.lastVisit = new Date();
      },
      async list(roomId) {
        return [...s.members.values()]
          .filter((m) => m.roomId === roomId)
          .map((m) => ({ ...copy(m), username: userName(m.userId), plan: s.users.get(m.userId)!.plan }));
      },
      async findOwner(roomId) {
        return (await repos.members.list(roomId)).find((m) => m.role === 'owner');
      },
    },

    playback: {
      async create(roomId) {
        const p: Playback = { roomId, currentItemId: null, isPlaying: false, positionSec: 0, updatedAt: new Date() };
        s.playback.set(roomId, p);
        return copy(p);
      },
      async get(roomId) {
        return copy(s.playback.get(roomId)!);
      },
      async update(roomId, patch) {
        const p = s.playback.get(roomId)!;
        Object.assign(p, patch, { updatedAt: new Date() });
        return copy(p);
      },
      async advanceIfCurrent(roomId, expected, next) {
        const p = s.playback.get(roomId)!;
        if (p.currentItemId !== expected) return undefined;
        Object.assign(p, { currentItemId: next, positionSec: 0, updatedAt: new Date() });
        return copy(p);
      },
    },

    tracks: {
      async upsert(t, overwrite = true) {
        const existing = [...s.tracks.values()].find((x) => x.source === t.source && x.ref === t.ref);
        if (existing) {
          if (overwrite) Object.assign(existing, t);
          return copy(existing);
        }
        const track: Track = { id: uuidv7(), ...t };
        s.tracks.set(track.id, track);
        return copy(track);
      },
      async findById(id) {
        const t = s.tracks.get(id);
        return t && copy(t);
      },
    },

    queue: {
      async add(i) {
        const rank = i.rank ?? (await repos.queue.maxRank(i.roomId)) + 1;
        const item: QueueItem = { ...i, id: uuidv7(), rank, addedAt: new Date() };
        s.queue.set(item.id, item);
        return copy(item);
      },
      async find(id) {
        const q = s.queue.get(id);
        return q && copy(q);
      },
      async upcoming(roomId) {
        return [...s.queue.values()]
          .filter((q) => q.roomId === roomId && q.status === 'queued')
          .sort((a, b) => a.rank - b.rank)
          .map(toEntry);
      },
      async entry(id) {
        const q = s.queue.get(id);
        return q && toEntry(q);
      },
      async maxRank(roomId) {
        return Math.max(0, ...[...s.queue.values()].filter((q) => q.roomId === roomId).map((q) => q.rank));
      },
      async minRank(roomId) {
        const ranks = [...s.queue.values()].filter((q) => q.roomId === roomId && q.status === 'queued').map((q) => q.rank);
        return ranks.length ? Math.min(...ranks) : 1;
      },
      async setRank(id, rank, locked) {
        const q = s.queue.get(id)!;
        q.rank = rank;
        if (locked !== undefined) q.locked = locked;
      },
      async setStatus(id, status) {
        s.queue.get(id)!.status = status;
      },
      async lockRoom() {},
    },

    requests: {
      async createOrGetPending(r) {
        const existing = [...s.requests.values()].find(
          (x) => x.status === 'pending' && x.queueItemId === r.queueItemId && x.requestedBy === r.requestedBy && x.type === r.type,
        );
        if (existing) return { request: copy(existing), created: false };
        const req: RoomRequest = { ...r, id: uuidv7(), status: 'pending', decidedBy: null, decidedAt: null, createdAt: new Date() };
        s.requests.set(req.id, req);
        return { request: copy(req), created: true };
      },
      async find(id) {
        const r = s.requests.get(id);
        return r && copy(r);
      },
      async decide(id, status, decidedBy) {
        const r = s.requests.get(id);
        if (!r || r.status !== 'pending') return undefined;
        Object.assign(r, { status, decidedBy, decidedAt: new Date() });
        return copy(r);
      },
      async obsoletePendingFor(queueItemId) {
        for (const r of s.requests.values()) {
          if (r.queueItemId === queueItemId && r.status === 'pending') Object.assign(r, { status: 'obsolete', decidedAt: new Date() });
        }
      },
      async pending(roomId) {
        return [...s.requests.values()].filter((r) => r.roomId === roomId && r.status === 'pending').map(copy);
      },
    },

    messages: {
      async add(m) {
        const msg: Message = { ...m, id: uuidv7(), createdAt: new Date() };
        s.messages.push(msg);
        return copy(msg);
      },
      async recent(roomId, limit) {
        return s.messages
          .filter((m) => m.roomId === roomId)
          .slice(-limit)
          .map((m) => ({ ...copy(m), username: m.userId ? userName(m.userId) : null }));
      },
    },

    favorites: {
      async list(userId) {
        return [...s.favorites.values()]
          .filter((f) => f.userId === userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((f) => copy(s.tracks.get(f.trackId)!));
      },
      async add(userId, trackId) {
        const key = `${userId}:${trackId}`;
        if (!s.favorites.has(key)) s.favorites.set(key, { userId, trackId, createdAt: new Date() });
      },
      async remove(userId, trackId) {
        s.favorites.delete(`${userId}:${trackId}`);
      },
    },

    idempotency: {
      async find(userId, key) {
        const r = s.idempotency.get(`${userId}:${key}`);
        return r && copy(r);
      },
      async save(r) {
        s.idempotency.set(`${r.userId}:${r.key}`, { ...r, createdAt: new Date() });
      },
      async lock() {},
      async purgeBefore(date) {
        let n = 0;
        for (const [k, v] of s.idempotency) if (v.createdAt < date && s.idempotency.delete(k)) n++;
        return n;
      },
    },

    async transaction(fn) {
      if (inTx.getStore()) return fn(); // nested: join the outer transaction
      const run = queueTail.then(() =>
        inTx.run(true, async () => {
          const snapshot = structuredClone(s);
          try {
            return await fn();
          } catch (err) {
            s = snapshot;
            throw err;
          }
        }),
      );
      queueTail = run.catch(() => {});
      return run;
    },

    async ping() {},
    async close() {},
  };

  return repos;
}
