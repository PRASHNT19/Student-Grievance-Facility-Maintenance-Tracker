import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import { config } from '../config';

/**
 * One shared connection pool. Because there are several pooled connections,
 * two HTTP requests really do reach PostgreSQL at the same time -- which is
 * exactly what the concurrency tests need.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Runs `fn` inside a single transaction on one dedicated connection.
 *
 * Used where a write and its audit-trail row must land together: a ticket that
 * exists without its `reported` event, or a status change without the matching
 * timeline entry, would be a corrupt history.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/** PostgreSQL SQLSTATE codes the data layer cares about. */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';

export function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function pgConstraintName(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'constraint' in err) {
    const name = (err as { constraint?: unknown }).constraint;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}
