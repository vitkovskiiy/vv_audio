import { AsyncLocalStorage } from 'node:async_hooks';
import { Kysely, PostgresDialect, sql, type Selectable, type Transaction } from 'kysely';
import pg from 'pg';
import { log } from '../context';
import type { Database, QueueItemsTable, RequestsTable, TracksTable } from '../db/schema';
import type { QueueEntry, QueueItem, RoomRequest, RoomSummary, Track, User } from '../domain/types';
import { ConflictError, DbUnavailableError } from '../errors';
import type { Repositories } from './ports';

const usernameKey = (u: string) => u.normalize('NFC').toLowerCase();

const toTrack = (t: Selectable<TracksTable>): Track => ({
  id: t.id,
  source: t.source,
  ref: t.ref,
  title: t.title,
  artist: t.artist,
  thumbnail: t.thumbnail,
});

const toItem = (r: Selectable<QueueItemsTable>): QueueItem => ({
  id: r.id,
  roomId: r.room_id,
  trackId: r.track_id,
  addedBy: r.added_by,
  isPremium: r.is_premium,
  status: r.status,
  rank: r.rank,
  locked: r.locked,
  addedAt: r.added_at,
});

const toRequest = (r: Selectable<RequestsTable>): RoomRequest => ({
  id: r.id,
  roomId: r.room_id,
  queueItemId: r.queue_item_id,
  type: r.type,
  requestedBy: r.requested_by,
  status: r.status,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

/** connection-level failures: the database is down or unreachable, not a bug in the query */
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006']);

export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.code && CONNECTION_CODES.has(e.code)) return true;
  return /Connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED/i.test(e.message ?? '');
}

/** wraps every repository method so an unreachable database surfaces as 503, from one place */
function translateConnectionErrors<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value === 'function') {
        return async (...args: unknown[]) => {
          try {
            return await value.apply(obj, args);
          } catch (err) {
            if (isConnectionError(err)) throw new DbUnavailableError();
            throw err;
          }
        };
      }
      if (value && typeof value === 'object') return translateConnectionErrors(value);
      return value;
    },
  });
}

export function createKysely(connectionString: string): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  // a dropped connection must not crash the process: pool.on('error') covers idle clients only,
  // a client that is checked out emits 'error' on itself, so every client gets a listener at birth
  pool.on('error', (err) => log().warn({ err: String(err) }, 'idle database connection lost'));
  pool.on('connect', (client) => client.on('error', (err) => log().warn({ err: String(err) }, 'database connection lost')));
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    // every statement is logged under the bpId of the operation that ran it (used to count queries, K16)
    log(event) {
      if (event.level === 'query') log().debug({ sql: event.query.sql, ms: Math.round(event.queryDurationMillis) }, 'sql');
      else log().warn({ sql: event.query.sql, err: String(event.error) }, 'sql failed');
    },
  });
}

export function createPostgresRepositories(db: Kysely<Database>): Repositories {
  const txStore = new AsyncLocalStorage<Transaction<Database>>();
  /** the open transaction of this async flow, or the pool */
  const q = (): Kysely<Database> => txStore.getStore() ?? db;

  const entryQuery = () =>
    q()
      .selectFrom('queue_items as qi')
      .innerJoin('tracks as t', 't.id', 'qi.track_id')
      .innerJoin('users as u', 'u.id', 'qi.added_by')
      .selectAll('qi')
      .select(['t.source', 't.ref', 't.title', 't.artist', 't.thumbnail', 'u.username as added_by_name']);

  type EntryRow = Awaited<ReturnType<ReturnType<typeof entryQuery>['executeTakeFirstOrThrow']>>;
  const toEntry = (r: EntryRow): QueueEntry => ({
    ...toItem(r),
    track: { id: r.track_id, source: r.source, ref: r.ref, title: r.title, artist: r.artist, thumbnail: r.thumbnail },
    addedByName: r.added_by_name,
  });

  const repos: Repositories = {
    users: {
      async create({ username, passHash, plan = 'free', isAdmin = false }) {
        try {
          const r = await q()
            .insertInto('users')
            .values({ username, username_key: usernameKey(username), pass_hash: passHash, plan, is_admin: isAdmin })
            .returning(['id', 'username', 'plan', 'is_admin'])
            .executeTakeFirstOrThrow();
          return { id: r.id, username: r.username, plan: r.plan, isAdmin: r.is_admin };
        } catch (err) {
          // the unique index decides races between parallel sign-ups
          if ((err as { code?: string }).code === '23505') throw new ConflictError('USERNAME_TAKEN', 'Цей логін уже зайнятий');
          throw err;
        }
      },
      async findByUsername(username) {
        const r = await q().selectFrom('users').selectAll().where('username_key', '=', usernameKey(username)).executeTakeFirst();
        return r && { id: r.id, username: r.username, plan: r.plan, isAdmin: r.is_admin, passHash: r.pass_hash };
      },
      async findById(id) {
        const r = await q().selectFrom('users').select(['id', 'username', 'plan', 'is_admin']).where('id', '=', id).executeTakeFirst();
        return r && { id: r.id, username: r.username, plan: r.plan, isAdmin: r.is_admin };
      },
      async setPlan(id, plan) {
        await q().updateTable('users').set({ plan }).where('id', '=', id).execute();
      },
      async lock(id) {
        await q().selectFrom('users').select('id').where('id', '=', id).forUpdate().execute();
      },
    },

    sessions: {
      async create(tokenHash, userId, expiresAt) {
        await q().insertInto('sessions').values({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt }).execute();
      },
      async findUser(tokenHash) {
        const r = await q()
          .selectFrom('sessions as s')
          .innerJoin('users as u', 'u.id', 's.user_id')
          .select(['u.id', 'u.username', 'u.plan', 'u.is_admin'])
          .where('s.token_hash', '=', tokenHash)
          .where('s.expires_at', '>', sql<Date>`now()`)
          .executeTakeFirst();
        return r && ({ id: r.id, username: r.username, plan: r.plan, isAdmin: r.is_admin } satisfies User);
      },
      async delete(tokenHash) {
        await q().deleteFrom('sessions').where('token_hash', '=', tokenHash).execute();
      },
      async purgeExpired() {
        const r = await q().deleteFrom('sessions').where('expires_at', '<=', sql<Date>`now()`).executeTakeFirst();
        return Number(r.numDeletedRows);
      },
    },

    rooms: {
      async create(code) {
        const r = await q().insertInto('rooms').values({ code }).returningAll().executeTakeFirstOrThrow();
        return { id: r.id, code: r.code, createdAt: r.created_at };
      },
      async findByCode(code) {
        const r = await q().selectFrom('rooms').selectAll().where('code', '=', code).executeTakeFirst();
        return r && { id: r.id, code: r.code, createdAt: r.created_at };
      },
      async codeExists(code) {
        return !!(await q().selectFrom('rooms').select('id').where('code', '=', code).executeTakeFirst());
      },
      async delete(id) {
        await q().deleteFrom('rooms').where('id', '=', id).execute();
      },
      async countOwnedBy(userId) {
        const r = await q()
          .selectFrom('room_members')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('user_id', '=', userId)
          .where('role', '=', 'owner')
          .executeTakeFirstOrThrow();
        return Number(r.n);
      },
      // one statement whatever the number of rooms (was 1 + 3 per room, see K16)
      async summariesFor(userId) {
        const rows = await q()
          .selectFrom('room_members as m')
          .innerJoin('rooms as r', 'r.id', 'm.room_id')
          .leftJoin('room_members as om', (j) => j.onRef('om.room_id', '=', 'r.id').on('om.role', '=', 'owner'))
          .leftJoin('users as ou', 'ou.id', 'om.user_id')
          .leftJoin('room_playback as p', 'p.room_id', 'r.id')
          .leftJoin('queue_items as ci', 'ci.id', 'p.current_item_id')
          .leftJoin('tracks as ct', 'ct.id', 'ci.track_id')
          .leftJoinLateral(
            (eb) =>
              eb
                .selectFrom('queue_items as qi')
                .select((e) => e.fn.countAll<string>().as('n'))
                .whereRef('qi.room_id', '=', 'r.id')
                .where('qi.status', '=', 'queued')
                .as('qc'),
            (j) => j.onTrue(),
          )
          .select(['r.code', 'm.role', 'm.last_visit', 'ou.username as owner_name', 'ct.title', 'ct.thumbnail', 'qc.n'])
          .where('m.user_id', '=', userId)
          .orderBy('m.last_visit', 'desc')
          .execute();
        return rows.map(
          (r): RoomSummary => ({
            code: r.code,
            ownerName: r.owner_name,
            role: r.role,
            trackCount: Number(r.n ?? 0),
            currentTitle: r.title,
            thumbnail: r.thumbnail,
            lastVisit: r.last_visit,
          }),
        );
      },
    },

    members: {
      async add(m) {
        await q().insertInto('room_members').values({ room_id: m.roomId, user_id: m.userId, role: m.role }).execute();
      },
      async find(roomId, userId) {
        const r = await q().selectFrom('room_members').selectAll().where('room_id', '=', roomId).where('user_id', '=', userId).executeTakeFirst();
        return r && { roomId: r.room_id, userId: r.user_id, role: r.role, lastVisit: r.last_visit };
      },
      async touch(roomId, userId) {
        await q().updateTable('room_members').set({ last_visit: sql`now()` }).where('room_id', '=', roomId).where('user_id', '=', userId).execute();
      },
      async list(roomId) {
        const rows = await q()
          .selectFrom('room_members as m')
          .innerJoin('users as u', 'u.id', 'm.user_id')
          .select(['m.room_id', 'm.user_id', 'm.role', 'm.last_visit', 'u.username', 'u.plan'])
          .where('m.room_id', '=', roomId)
          .orderBy('m.last_visit', 'asc')
          .execute();
        return rows.map((r) => ({ roomId: r.room_id, userId: r.user_id, role: r.role, lastVisit: r.last_visit, username: r.username, plan: r.plan }));
      },
      async findOwner(roomId) {
        return (await repos.members.list(roomId)).find((m) => m.role === 'owner');
      },
    },

    playback: {
      async create(roomId) {
        const r = await q().insertInto('room_playback').values({ room_id: roomId, current_item_id: null }).returningAll().executeTakeFirstOrThrow();
        return { roomId: r.room_id, currentItemId: r.current_item_id, isPlaying: r.is_playing, positionSec: r.position_sec, updatedAt: r.updated_at };
      },
      async get(roomId) {
        const r = await q().selectFrom('room_playback').selectAll().where('room_id', '=', roomId).executeTakeFirstOrThrow();
        return { roomId: r.room_id, currentItemId: r.current_item_id, isPlaying: r.is_playing, positionSec: r.position_sec, updatedAt: r.updated_at };
      },
      async update(roomId, patch) {
        const r = await q()
          .updateTable('room_playback')
          .set({
            ...(patch.currentItemId !== undefined ? { current_item_id: patch.currentItemId } : {}),
            ...(patch.isPlaying !== undefined ? { is_playing: patch.isPlaying } : {}),
            ...(patch.positionSec !== undefined ? { position_sec: patch.positionSec } : {}),
            updated_at: sql`now()`,
          })
          .where('room_id', '=', roomId)
          .returningAll()
          .executeTakeFirstOrThrow();
        return { roomId: r.room_id, currentItemId: r.current_item_id, isPlaying: r.is_playing, positionSec: r.position_sec, updatedAt: r.updated_at };
      },
      async advanceIfCurrent(roomId, expected, next) {
        // the row lock makes concurrent callers queue up; the WHERE lets only the first one through
        const r = await q()
          .updateTable('room_playback')
          .set({ current_item_id: next, position_sec: 0, updated_at: sql`now()` })
          .where('room_id', '=', roomId)
          .where(sql<boolean>`current_item_id IS NOT DISTINCT FROM ${expected}::uuid`)
          .returningAll()
          .executeTakeFirst();
        return r && { roomId: r.room_id, currentItemId: r.current_item_id, isPlaying: r.is_playing, positionSec: r.position_sec, updatedAt: r.updated_at };
      },
    },

    tracks: {
      async upsert(t, overwrite = true) {
        const r = await q()
          .insertInto('tracks')
          .values({ source: t.source, ref: t.ref, title: t.title, artist: t.artist, thumbnail: t.thumbnail })
          .onConflict((oc) =>
            oc.columns(['source', 'ref']).doUpdateSet((eb) =>
              overwrite
                ? { title: eb.ref('excluded.title'), artist: eb.ref('excluded.artist'), thumbnail: eb.ref('excluded.thumbnail') }
                : { source: eb.ref('excluded.source') },
            ),
          )
          .returningAll()
          .executeTakeFirstOrThrow();
        return toTrack(r);
      },
      async findById(id) {
        const r = await q().selectFrom('tracks').selectAll().where('id', '=', id).executeTakeFirst();
        return r && toTrack(r);
      },
    },

    queue: {
      async add(i) {
        const r = await q()
          .insertInto('queue_items')
          .values({
            room_id: i.roomId,
            track_id: i.trackId,
            added_by: i.addedBy,
            is_premium: i.isPremium,
            status: i.status,
            locked: i.locked,
            rank: i.rank ?? sql<number>`COALESCE((SELECT max(rank) FROM queue_items WHERE room_id = ${i.roomId}), 0) + 1`,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return toItem(r);
      },
      async find(id) {
        const r = await q().selectFrom('queue_items').selectAll().where('id', '=', id).executeTakeFirst();
        return r && toItem(r);
      },
      async upcoming(roomId) {
        const rows = await entryQuery().where('qi.room_id', '=', roomId).where('qi.status', '=', 'queued').orderBy('qi.rank').execute();
        return rows.map(toEntry);
      },
      async entry(id) {
        const r = await entryQuery().where('qi.id', '=', id).executeTakeFirst();
        return r && toEntry(r);
      },
      async maxRank(roomId) {
        const r = await q().selectFrom('queue_items').select((eb) => eb.fn.max('rank').as('m')).where('room_id', '=', roomId).executeTakeFirst();
        return Number(r?.m ?? 0);
      },
      async minRank(roomId) {
        const r = await q()
          .selectFrom('queue_items')
          .select((eb) => eb.fn.min('rank').as('m'))
          .where('room_id', '=', roomId)
          .where('status', '=', 'queued')
          .executeTakeFirst();
        return r?.m == null ? 1 : Number(r.m);
      },
      async setRank(id, rank, locked) {
        await q()
          .updateTable('queue_items')
          .set({ rank, ...(locked !== undefined ? { locked } : {}) })
          .where('id', '=', id)
          .execute();
      },
      async setStatus(id, status) {
        await q().updateTable('queue_items').set({ status }).where('id', '=', id).execute();
      },
      async lockRoom(roomId) {
        await q().selectFrom('room_playback').select('room_id').where('room_id', '=', roomId).forUpdate().execute();
      },
    },

    requests: {
      async createOrGetPending(r) {
        const inserted = await q()
          .insertInto('requests')
          .values({ room_id: r.roomId, queue_item_id: r.queueItemId, type: r.type, requested_by: r.requestedBy })
          .onConflict((oc) => oc.columns(['queue_item_id', 'requested_by', 'type']).where('status', '=', 'pending').doNothing())
          .returningAll()
          .executeTakeFirst();
        if (inserted) return { request: toRequest(inserted), created: true };
        const existing = await q()
          .selectFrom('requests')
          .selectAll()
          .where('queue_item_id', '=', r.queueItemId)
          .where('requested_by', '=', r.requestedBy)
          .where('type', '=', r.type)
          .where('status', '=', 'pending')
          .executeTakeFirstOrThrow();
        return { request: toRequest(existing), created: false };
      },
      async find(id) {
        const r = await q().selectFrom('requests').selectAll().where('id', '=', id).executeTakeFirst();
        return r && toRequest(r);
      },
      async decide(id, status, decidedBy) {
        const r = await q()
          .updateTable('requests')
          .set({ status, decided_by: decidedBy, decided_at: sql`now()` })
          .where('id', '=', id)
          .where('status', '=', 'pending')
          .returningAll()
          .executeTakeFirst();
        return r && toRequest(r);
      },
      async obsoletePendingFor(queueItemId) {
        await q()
          .updateTable('requests')
          .set({ status: 'obsolete', decided_at: sql`now()` })
          .where('queue_item_id', '=', queueItemId)
          .where('status', '=', 'pending')
          .execute();
      },
      async pending(roomId) {
        const rows = await q().selectFrom('requests').selectAll().where('room_id', '=', roomId).where('status', '=', 'pending').orderBy('created_at').execute();
        return rows.map(toRequest);
      },
    },

    messages: {
      async add(m) {
        const r = await q().insertInto('messages').values({ room_id: m.roomId, user_id: m.userId, kind: m.kind, text: m.text }).returningAll().executeTakeFirstOrThrow();
        return { id: r.id, roomId: r.room_id, userId: r.user_id, kind: r.kind, text: r.text, createdAt: r.created_at };
      },
      async recent(roomId, limit) {
        const rows = await q()
          .selectFrom('messages as m')
          .leftJoin('users as u', 'u.id', 'm.user_id')
          .selectAll('m')
          .select('u.username')
          .where('m.room_id', '=', roomId)
          .orderBy('m.created_at', 'desc')
          .orderBy('m.id', 'desc')
          .limit(limit)
          .execute();
        return rows
          .reverse()
          .map((r) => ({ id: r.id, roomId: r.room_id, userId: r.user_id, kind: r.kind, text: r.text, createdAt: r.created_at, username: r.username }));
      },
    },

    favorites: {
      async list(userId) {
        const rows = await q()
          .selectFrom('favorites as f')
          .innerJoin('tracks as t', 't.id', 'f.track_id')
          .selectAll('t')
          .where('f.user_id', '=', userId)
          .orderBy('f.created_at', 'desc')
          .execute();
        return rows.map(toTrack);
      },
      async add(userId, trackId) {
        await q().insertInto('favorites').values({ user_id: userId, track_id: trackId }).onConflict((oc) => oc.doNothing()).execute();
      },
      async remove(userId, trackId) {
        await q().deleteFrom('favorites').where('user_id', '=', userId).where('track_id', '=', trackId).execute();
      },
    },

    idempotency: {
      async find(userId, key) {
        const r = await q().selectFrom('idempotency_keys').selectAll().where('user_id', '=', userId).where('key', '=', key).executeTakeFirst();
        return (
          r && {
            userId: r.user_id,
            key: r.key,
            requestHash: r.request_hash,
            statusCode: r.status_code,
            response: r.response,
            createdAt: r.created_at,
          }
        );
      },
      async save(rec) {
        await q()
          .insertInto('idempotency_keys')
          .values({ user_id: rec.userId, key: rec.key, request_hash: rec.requestHash, status_code: rec.statusCode, response: JSON.stringify(rec.response) })
          .execute();
      },
      async lock(userId, key) {
        // held until the transaction ends: a parallel request with the same key waits, then sees the stored answer
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${key}`}, 0))`.execute(q());
      },
      async purgeBefore(date) {
        const r = await q().deleteFrom('idempotency_keys').where('created_at', '<', date).executeTakeFirst();
        return Number(r.numDeletedRows);
      },
    },

    async transaction(fn) {
      if (txStore.getStore()) return fn(); // nested: join the outer transaction
      return db.transaction().execute((trx) => txStore.run(trx, fn));
    },

    async ping() {
      await sql`SELECT 1`.execute(db);
    },

    async close() {
      await db.destroy();
    },
  };

  return translateConnectionErrors(repos);
}
