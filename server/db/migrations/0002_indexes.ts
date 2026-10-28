import { sql, type Kysely } from 'kysely';

/**
 * Indexes for the hot read paths, kept apart from the structure migration:
 * on a large table they are slow to build and will move to CREATE INDEX CONCURRENTLY (lab 4).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- queue in play order for a room
    CREATE INDEX queue_items_room_status_rank ON queue_items (room_id, status, rank);
    -- chat history, newest first
    CREATE INDEX messages_room_created ON messages (room_id, created_at);
    -- "my rooms"
    CREATE INDEX room_members_user ON room_members (user_id);
    -- open requests shown to the owner
    CREATE INDEX requests_room_pending ON requests (room_id) WHERE status = 'pending';
    -- periodic clean-up
    CREATE INDEX sessions_expires ON sessions (expires_at);
    CREATE INDEX idempotency_keys_created ON idempotency_keys (created_at);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX queue_items_room_status_rank, messages_room_created, room_members_user,
               requests_room_pending, sessions_expires, idempotency_keys_created;
  `.execute(db);
}
