import type { ColumnType, Generated, JSONColumnType } from 'kysely';

/** Kysely table types; must match the migrations in ./migrations */

type CreatedAt = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  username: string;
  username_key: string;
  pass_hash: string;
  plan: Generated<'free' | 'premium'>;
  is_admin: Generated<boolean>;
  created_at: CreatedAt;
}

export interface SessionsTable {
  token_hash: string;
  user_id: string;
  expires_at: Date;
}

export interface RoomsTable {
  id: Generated<string>;
  code: string;
  created_at: CreatedAt;
}

export interface RoomMembersTable {
  room_id: string;
  user_id: string;
  role: 'owner' | 'member';
  last_visit: CreatedAt;
}

export interface RoomPlaybackTable {
  room_id: string;
  current_item_id: string | null;
  is_playing: Generated<boolean>;
  position_sec: Generated<number>;
  updated_at: CreatedAt;
}

export interface TracksTable {
  id: Generated<string>;
  source: 'file' | 'youtube' | 'soundcloud' | 'spotify';
  ref: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
}

export interface QueueItemsTable {
  id: Generated<string>;
  room_id: string;
  track_id: string;
  added_by: string;
  is_premium: boolean;
  status: 'queued' | 'playing' | 'played' | 'removed';
  rank: number;
  locked: Generated<boolean>;
  added_at: CreatedAt;
}

export interface RequestsTable {
  id: Generated<string>;
  room_id: string;
  queue_item_id: string;
  type: 'remove' | 'skip';
  requested_by: string;
  status: Generated<'pending' | 'approved' | 'rejected' | 'obsolete'>;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: CreatedAt;
}

export interface MessagesTable {
  id: Generated<string>;
  room_id: string;
  user_id: string | null;
  kind: 'user' | 'system';
  text: string;
  created_at: CreatedAt;
}

export interface FavoritesTable {
  user_id: string;
  track_id: string;
  created_at: CreatedAt;
}

export interface IdempotencyKeysTable {
  user_id: string;
  key: string;
  request_hash: string;
  status_code: number;
  response: JSONColumnType<object | null, string, string>;
  created_at: CreatedAt;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  rooms: RoomsTable;
  room_members: RoomMembersTable;
  room_playback: RoomPlaybackTable;
  tracks: TracksTable;
  queue_items: QueueItemsTable;
  requests: RequestsTable;
  messages: MessagesTable;
  favorites: FavoritesTable;
  idempotency_keys: IdempotencyKeysTable;
}
