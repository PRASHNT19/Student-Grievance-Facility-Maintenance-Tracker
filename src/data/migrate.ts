import fs from 'node:fs';
import path from 'node:path';
import { pool, closePool } from './db';

/**
 * Minimal forward-only migration runner: every .sql file in /migrations is
 * applied once, in filename order, inside a transaction, and recorded in
 * schema_migrations. Running it twice is a no-op, so it is safe to call on
 * every application start.
 */

// Resolves to <project>/migrations from both src/data and dist/data.
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

export async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (
      await pool.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations',
      )
    ).rows.map((r) => r.filename),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      newlyApplied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

// Allow `npm run migrate` to execute this file directly.
if (require.main === module) {
  runMigrations()
    .then((files) => {
      console.log(
        files.length
          ? `Applied migrations: ${files.join(', ')}`
          : 'No new migrations to apply.',
      );
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
