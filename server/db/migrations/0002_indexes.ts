import type { Kysely } from 'kysely';

/**
 * Lab 4 moved the read-path indexes out of migrations into a background step (server/db/indexes.ts):
 * CREATE INDEX CONCURRENTLY cannot run in a migration's transaction, and a long build must not hold
 * up the start. This entry stays so databases that already ran it are not "missing a migration";
 * their indexes already exist and the background step's IF NOT EXISTS leaves them alone.
 */
export async function up(_db: Kysely<unknown>): Promise<void> {}

export async function down(_db: Kysely<unknown>): Promise<void> {}
