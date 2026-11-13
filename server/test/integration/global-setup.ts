import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { migrateToLatest } from '../../db/migrate';
import { createKysely } from '../../repositories/postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/** one PostgreSQL 18 container for the whole run, migrated with the same migrations production uses */
export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:18').start();
  const url = container.getConnectionUri();
  const db = createKysely(url);
  await migrateToLatest(db);
  await db.destroy();
  project.provide('databaseUrl', url);
}

export async function teardown() {
  await container?.stop();
}
