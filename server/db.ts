import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, Favorite, RoomState, RoomSummary, Track, User } from '../shared/types';

const DATA_DIR = path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

// wait for the lock instead of failing when a restarting dev server still holds the file
const db = new DatabaseSync(process.env.DB_PATH ?? path.join(DATA_DIR, 'vv.db'), { timeout: 5000 });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL,
    -- lower-cased in JS: SQLite's NOCASE only folds ASCII, so "Вика" and "вика" would differ
    username_key TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id         TEXT PRIMARY KEY,
    owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    state      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_visits (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    last_visit INTEGER NOT NULL,
    PRIMARY KEY (user_id, room_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id      TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    text    TEXT NOT NULL,
    ts      INTEGER NOT NULL,
    system  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS messages_room_ts ON messages(room_id, ts);

  CREATE TABLE IF NOT EXISTS favorites (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    ref        TEXT NOT NULL,
    title      TEXT NOT NULL,
    artist     TEXT,
    thumbnail  TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, source, ref)
  );
`);

// databases created before username_key existed
const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
if (!userCols.includes('username_key')) {
  db.exec("ALTER TABLE users ADD COLUMN username_key TEXT NOT NULL DEFAULT ''");
  const rows = db.prepare('SELECT id, username FROM users').all() as { id: number; username: string }[];
  const set = db.prepare('UPDATE users SET username_key = ? WHERE id = ?');
  for (const r of rows) set.run(usernameKey(r.username), r.id);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(username_key)');

export function usernameKey(username: string): string {
  return username.normalize('NFC').toLowerCase();
}

/** what is persisted of a room; playback always resumes paused after a restart */
type StoredState = Pick<RoomState, 'queue' | 'currentIndex' | 'positionSec'>;

const q = {
  insertUser: db.prepare('INSERT INTO users (username, username_key, pass_hash, created_at) VALUES (?, ?, ?, ?)'),
  userByName: db.prepare('SELECT id, username, pass_hash FROM users WHERE username_key = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  userBySession: db.prepare(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  insertRoom: db.prepare('INSERT INTO rooms (id, owner_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
  roomExists: db.prepare('SELECT 1 FROM rooms WHERE id = ?'),
  roomState: db.prepare('SELECT state FROM rooms WHERE id = ?'),
  saveRoom: db.prepare('UPDATE rooms SET state = ?, updated_at = ? WHERE id = ?'),
  touchVisit: db.prepare(
    'INSERT INTO room_visits (user_id, room_id, last_visit) VALUES (?, ?, ?) ON CONFLICT(user_id, room_id) DO UPDATE SET last_visit = excluded.last_visit',
  ),
  myRooms: db.prepare(`
    SELECT r.id, r.state, v.last_visit, owner.username AS owner
    FROM room_visits v
    JOIN rooms r ON r.id = v.room_id
    LEFT JOIN users owner ON owner.id = r.owner_id
    WHERE v.user_id = ?
    ORDER BY v.last_visit DESC
    LIMIT 30`),
  forgetRoom: db.prepare('DELETE FROM room_visits WHERE user_id = ? AND room_id = ?'),

  insertMessage: db.prepare('INSERT INTO messages (id, room_id, name, text, ts, system) VALUES (?, ?, ?, ?, ?, ?)'),
  recentMessages: db.prepare(
    'SELECT id, name, text, ts, system FROM (SELECT * FROM messages WHERE room_id = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC',
  ),

  listFavorites: db.prepare(
    'SELECT source, ref, title, artist, thumbnail FROM favorites WHERE user_id = ? ORDER BY created_at DESC',
  ),
  addFavorite: db.prepare(
    'INSERT OR REPLACE INTO favorites (user_id, source, ref, title, artist, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),
  removeFavorite: db.prepare('DELETE FROM favorites WHERE user_id = ? AND source = ? AND ref = ?'),
};

export const users = {
  create(username: string, passHash: string): User {
    const r = q.insertUser.run(username, usernameKey(username), passHash, Date.now());
    return { id: Number(r.lastInsertRowid), username };
  },
  byName(username: string) {
    return q.userByName.get(usernameKey(username)) as { id: number; username: string; pass_hash: string } | undefined;
  },
};

export const sessions = {
  create(tokenHash: string, userId: number, expiresAt: number) {
    q.insertSession.run(tokenHash, userId, expiresAt);
  },
  user(tokenHash: string): User | undefined {
    const row = q.userBySession.get(tokenHash, Date.now()) as { id: number; username: string } | undefined;
    return row && { id: row.id, username: row.username };
  },
  delete(tokenHash: string) {
    q.deleteSession.run(tokenHash);
  },
  purgeExpired() {
    q.deleteExpiredSessions.run(Date.now());
  },
};

export const roomsDb = {
  create(id: string, ownerId: number, state: StoredState) {
    const now = Date.now();
    q.insertRoom.run(id, ownerId, JSON.stringify(state), now, now);
  },
  exists(id: string): boolean {
    return !!q.roomExists.get(id);
  },
  load(id: string): StoredState | undefined {
    const row = q.roomState.get(id) as { state: string } | undefined;
    return row && (JSON.parse(row.state) as StoredState);
  },
  save(id: string, state: StoredState) {
    q.saveRoom.run(JSON.stringify(state), Date.now(), id);
  },
  visit(userId: number, roomId: string) {
    q.touchVisit.run(userId, roomId, Date.now());
  },
  forget(userId: number, roomId: string) {
    q.forgetRoom.run(userId, roomId);
  },
  mine(userId: number): RoomSummary[] {
    const rows = q.myRooms.all(userId) as { id: string; state: string; last_visit: number; owner: string | null }[];
    return rows.map((r) => {
      const s = JSON.parse(r.state) as StoredState;
      const current: Track | undefined = s.queue[s.currentIndex];
      return {
        id: r.id,
        owner: r.owner ?? undefined,
        trackCount: s.queue.length,
        currentTitle: current?.title,
        thumbnail: current?.thumbnail ?? s.queue.find((t) => t.thumbnail)?.thumbnail,
        lastVisit: r.last_visit,
      };
    });
  },
};

export const messagesDb = {
  add(roomId: string, m: ChatMessage) {
    q.insertMessage.run(m.id, roomId, m.name, m.text, m.ts, m.system ? 1 : 0);
  },
  recent(roomId: string, limit = 200): ChatMessage[] {
    const rows = q.recentMessages.all(roomId, limit) as { id: string; name: string; text: string; ts: number; system: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, text: r.text, ts: r.ts, system: !!r.system }));
  },
};

export const favoritesDb = {
  list(userId: number): Favorite[] {
    const rows = q.listFavorites.all(userId) as {
      source: Favorite['source'];
      ref: string;
      title: string;
      artist: string | null;
      thumbnail: string | null;
    }[];
    return rows.map((r) => ({ source: r.source, ref: r.ref, title: r.title, artist: r.artist ?? undefined, thumbnail: r.thumbnail ?? undefined }));
  },
  add(userId: number, f: Favorite) {
    q.addFavorite.run(userId, f.source, f.ref, f.title, f.artist ?? null, f.thumbnail ?? null, Date.now());
  },
  remove(userId: number, source: string, ref: string) {
    q.removeFavorite.run(userId, source, ref);
  },
};
