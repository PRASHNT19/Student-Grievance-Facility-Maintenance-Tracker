import { query, pgErrorCode, PG_UNIQUE_VIOLATION } from './db';
import { conflict } from '../errors';
import type { User, UserRole } from '../types';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

const USER_COLUMNS = 'id, name, email, role';

const toUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
});

/**
 * There is no POST /users endpoint in this project's scope. Students and staff
 * are created by the seed script and by the test helpers, so this function
 * exists for those callers only.
 */
export async function insertUser(
  name: string,
  email: string,
  role: UserRole = 'student',
): Promise<User> {
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (name, email, role)
       VALUES ($1, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [name, email, role],
    );
    return toUser(rows[0]);
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw conflict('USER_EXISTS', `A user with email "${email}" already exists.`);
    }
    throw err;
  }
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows.length ? toUser(rows[0]) : null;
}
