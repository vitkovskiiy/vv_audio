import type {
  IdempotencyRecord,
  Member,
  MemberEntry,
  Message,
  MessageEntry,
  Playback,
  QueueEntry,
  QueueItem,
  QueueStatus,
  RequestStatus,
  Room,
  RoomRequest,
  RoomSummary,
  Track,
  User,
  UserWithPassword,
} from '../domain/types';

/**
 * Storage contracts. Services depend only on these; the in-memory and PostgreSQL
 * implementations are interchangeable. SQL and transactions live only behind them.
 */

export interface UsersRepo {
  create(u: { username: string; passHash: string; plan?: User['plan']; isAdmin?: boolean }): Promise<User>;
  findByUsername(username: string): Promise<UserWithPassword | undefined>;
  findById(id: string): Promise<User | undefined>;
  setPlan(id: string, plan: User['plan']): Promise<void>;
  /** serialises concurrent operations of one user inside a transaction (e.g. the room limit check) */
  lock(id: string): Promise<void>;
}

export interface SessionsRepo {
  create(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  findUser(tokenHash: string): Promise<User | undefined>;
  delete(tokenHash: string): Promise<void>;
  purgeExpired(): Promise<number>;
}

export interface RoomsRepo {
  create(code: string): Promise<Room>;
  findByCode(code: string): Promise<Room | undefined>;
  codeExists(code: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  countOwnedBy(userId: string): Promise<number>;
  /** rooms the user belongs to, with current track and queue size, in a constant number of queries */
  summariesFor(userId: string): Promise<RoomSummary[]>;
}

export interface MembersRepo {
  add(m: Omit<Member, 'lastVisit'>): Promise<void>;
  find(roomId: string, userId: string): Promise<Member | undefined>;
  touch(roomId: string, userId: string): Promise<void>;
  list(roomId: string): Promise<MemberEntry[]>;
  findOwner(roomId: string): Promise<MemberEntry | undefined>;
}

export interface PlaybackRepo {
  create(roomId: string): Promise<Playback>;
  get(roomId: string): Promise<Playback>;
  update(roomId: string, patch: Partial<Omit<Playback, 'roomId'>>): Promise<Playback>;
  /** sets a new current item only if the current one is still `expected`; undefined when someone else moved first */
  advanceIfCurrent(roomId: string, expected: string | null, next: string | null): Promise<Playback | undefined>;
}

export interface TracksRepo {
  /** one row per (source, ref); `overwrite: false` keeps the stored title (a fallback must not replace a real one) */
  upsert(t: Omit<Track, 'id'>, overwrite?: boolean): Promise<Track>;
  findById(id: string): Promise<Track | undefined>;
}

export interface QueueRepo {
  add(i: Omit<QueueItem, 'id' | 'addedAt' | 'rank'> & { rank?: number }): Promise<QueueItem>;
  find(id: string): Promise<QueueItem | undefined>;
  /** queued items in play order, joined with track and author */
  upcoming(roomId: string): Promise<QueueEntry[]>;
  entry(id: string): Promise<QueueEntry | undefined>;
  maxRank(roomId: string): Promise<number>;
  minRank(roomId: string): Promise<number>;
  setRank(id: string, rank: number, locked?: boolean): Promise<void>;
  setStatus(id: string, status: QueueStatus): Promise<void>;
  /** serialises queue reordering in one room inside a transaction */
  lockRoom(roomId: string): Promise<void>;
}

export interface RequestsRepo {
  /** returns the existing pending request instead of creating a duplicate */
  createOrGetPending(
    r: Pick<RoomRequest, 'roomId' | 'queueItemId' | 'type' | 'requestedBy'>,
  ): Promise<{ request: RoomRequest; created: boolean }>;
  find(id: string): Promise<RoomRequest | undefined>;
  /** pending → decided, only once; undefined when it was no longer pending */
  decide(id: string, status: Exclude<RequestStatus, 'pending'>, decidedBy: string | null): Promise<RoomRequest | undefined>;
  obsoletePendingFor(queueItemId: string): Promise<void>;
  pending(roomId: string): Promise<RoomRequest[]>;
}

export interface MessagesRepo {
  add(m: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  recent(roomId: string, limit: number): Promise<MessageEntry[]>;
}

export interface FavoritesRepo {
  list(userId: string): Promise<Track[]>;
  add(userId: string, trackId: string): Promise<void>;
  remove(userId: string, trackId: string): Promise<void>;
}

export interface IdempotencyRepo {
  find(userId: string, key: string): Promise<IdempotencyRecord | undefined>;
  save(r: Omit<IdempotencyRecord, 'createdAt'>): Promise<void>;
  /** makes a second request with the same key wait until the first one commits */
  lock(userId: string, key: string): Promise<void>;
  purgeBefore(date: Date): Promise<number>;
}

export interface Repositories {
  users: UsersRepo;
  sessions: SessionsRepo;
  rooms: RoomsRepo;
  members: MembersRepo;
  playback: PlaybackRepo;
  tracks: TracksRepo;
  queue: QueueRepo;
  requests: RequestsRepo;
  messages: MessagesRepo;
  favorites: FavoritesRepo;
  idempotency: IdempotencyRepo;
  /** runs fn atomically: all of its writes land or none do */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** cheap liveness probe for /healthz */
  ping(): Promise<void>;
  close(): Promise<void>;
}
