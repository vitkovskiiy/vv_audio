/**
 * Database chores, run as separate steps (never on server start):
 *   npm run db:migrate   — apply pending migrations
 *   npm run db:seed      — load the static prototype data (empty database only)
 */
import { log, runInNewContext } from '../context';
import { createKysely, createPostgresRepositories } from '../repositories/postgres';
import { seed } from '../repositories/seed';
import { migrateToLatest } from './migrate';

try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const command = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

await runInNewContext(async () => {
  const db = createKysely(url);
  try {
    if (command === 'migrate') {
      const applied = await migrateToLatest(db);
      log().info({ applied }, applied.length ? 'migrations applied' : 'database already up to date');
    } else if (command === 'seed') {
      const repos = createPostgresRepositories(db);
      if (await repos.users.findByUsername('admin')) {
        log().info('seed data already present, nothing to do');
      } else {
        await repos.transaction(() => seed(repos));
        log().info('seed data loaded (rooms PARTY5, CHILL2)');
      }
    } else {
      throw new Error(`unknown command "${command}", expected migrate or seed`);
    }
  } finally {
    await db.destroy();
  }
}).catch((err) => {
  log().fatal({ err: err instanceof Error ? err.message : String(err) }, `db ${command} failed`);
  process.exit(1);
});
