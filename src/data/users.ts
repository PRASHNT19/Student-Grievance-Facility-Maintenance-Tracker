import { pool } from "./db";
import { CreateUserInput, PublicUser, User, UserRole } from "../types/user";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `
      SELECT
        id,
        name,
        email,
        password_hash,
        role,
        created_at,
        updated_at
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email.toLowerCase()],
  );

  return result.rows.length > 0 ? mapUser(result.rows[0]) : null;
}

export async function findUserById(id: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `
      SELECT
        id,
        name,
        email,
        password_hash,
        role,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows.length > 0 ? mapUser(result.rows[0]) : null;
}

export async function createUser(
  input: CreateUserInput,
  passwordHash: string,
): Promise<User> {
  const role = input.role ?? "student";

  const result = await pool.query<UserRow>(
    `
      INSERT INTO users (
        name,
        email,
        password_hash,
        role
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        name,
        email,
        password_hash,
        role,
        created_at,
        updated_at
    `,
    [input.name.trim(), input.email.toLowerCase().trim(), passwordHash, role],
  );

  return mapUser(result.rows[0]);
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
