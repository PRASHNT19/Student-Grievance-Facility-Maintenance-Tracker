import { runMigrations } from '../src/data/migrate';
import { closePool } from '../src/data/db';

/**
 * Runs once before the whole suite against the REAL PostgreSQL database given
 * by DATABASE_URL. Nothing about the database is mocked anywhere in these
 * tests -- the constraints created here are the thing under test.
 */
export default async function globalSetup(): Promise<void> {
  await runMigrations();
  await closePool();
}
