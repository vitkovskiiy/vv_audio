import { sql, type Kysely } from 'kysely';

/** Tables, keys and constraints only. Indexes for read paths live in 0002, seed data outside migrations. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id           uuid PRIMARY KEY DEFAULT uuidv7(),
      username     text NOT NULL,
      -- Unicode-lowercased in the app: "Вика" and "вика" are one login
      username_key text NOT NULL UNIQUE,
      pass_hash    text NOT NULL,
      plan         text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
      is_admin     boolean NOT NULL DEFAULT false,
      created_at   timestamptz NOT NULL DEFAULT now(),
      CHECK (char_length(username) BETWEEN 3 AND 64)
    );

    CREATE TABLE sessions (
      token_hash text PRIMARY KEY,
      user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );

    CREATE TABLE rooms (
      id         uuid PRIMARY KEY DEFAULT uuidv7(),
      code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,12}$'),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE room_members (
      room_id    uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
      user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      role       text NOT NULL CHECK (role IN ('owner', 'member')),
      last_visit timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (room_id, user_id)
    );
    -- exactly one owner per room
    CREATE UNIQUE INDEX room_members_one_owner ON room_members (room_id) WHERE role = 'owner';

    CREATE TABLE tracks (
      id        uuid PRIMARY KEY DEFAULT uuidv7(),
      source    text NOT NULL CHECK (source IN ('file', 'youtube', 'soundcloud', 'spotify')),
      ref       text NOT NULL,
      title     text NOT NULL,
      artist    text,
      thumbnail text,
      UNIQUE (source, ref)
    );

    CREATE TABLE queue_items (
      id         uuid PRIMARY KEY DEFAULT uuidv7(),
      room_id    uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
      track_id   uuid NOT NULL REFERENCES tracks (id),
      added_by   uuid NOT NULL REFERENCES users (id),
      is_premium boolean NOT NULL,
      status     text NOT NULL CHECK (status IN ('queued', 'playing', 'played', 'removed')),
      rank       double precision NOT NULL,
      locked     boolean NOT NULL DEFAULT false,
      added_at   timestamptz NOT NULL DEFAULT now()
    );

    -- 1:1 with rooms, kept apart because it is rewritten on every play/pause/seek
    CREATE TABLE room_playback (
      room_id         uuid PRIMARY KEY REFERENCES rooms (id) ON DELETE CASCADE,
      current_item_id uuid REFERENCES queue_items (id) ON DELETE SET NULL,
      is_playing      boolean NOT NULL DEFAULT false,
      position_sec    double precision NOT NULL DEFAULT 0 CHECK (position_sec >= 0),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE requests (
      id            uuid PRIMARY KEY DEFAULT uuidv7(),
      room_id       uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
      queue_item_id uuid NOT NULL REFERENCES queue_items (id) ON DELETE CASCADE,
      type          text NOT NULL CHECK (type IN ('remove', 'skip')),
      requested_by  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'obsolete')),
      decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
      decided_at    timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    -- one open request per user, track and type: a repeat finds the existing one
    CREATE UNIQUE INDEX requests_one_pending ON requests (queue_item_id, requested_by, type) WHERE status = 'pending';

    CREATE TABLE messages (
      id         uuid PRIMARY KEY DEFAULT uuidv7(),
      room_id    uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
      user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
      kind       text NOT NULL CHECK (kind IN ('user', 'system')),
      text       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((kind = 'system') = (user_id IS NULL)),
      CHECK (kind = 'system' OR char_length(text) BETWEEN 1 AND 500)
    );

    CREATE TABLE favorites (
      user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      track_id   uuid NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, track_id)
    );

    CREATE TABLE idempotency_keys (
      user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      key          text NOT NULL,
      request_hash text NOT NULL,
      status_code  integer NOT NULL,
      response     jsonb NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE idempotency_keys, favorites, messages, requests, room_playback,
               queue_items, tracks, room_members, rooms, sessions, users;
  `.execute(db);
}
