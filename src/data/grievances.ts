import { pool } from "./db";
import {
  CreateGrievanceInput,
  Grievance,
  GrievanceStatus,
} from "../types/grievance";

interface GrievanceRow {
  id: string;
  student_id: string;
  title: string;
  description: string;
  category: string;
  location: string | null;
  status: GrievanceStatus;
  created_at: Date;
  updated_at: Date;
}

function mapGrievance(row: GrievanceRow): Grievance {
  return {
    id: row.id,
    studentId: row.student_id,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createGrievance(
  input: CreateGrievanceInput,
): Promise<Grievance> {
  const result = await pool.query<GrievanceRow>(
    `
      INSERT INTO grievances (
        student_id,
        title,
        description,
        category,
        location
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        student_id,
        title,
        description,
        category,
        location,
        status,
        created_at,
        updated_at
    `,
    [
      input.studentId,
      input.title.trim(),
      input.description.trim(),
      input.category.trim(),
      input.location?.trim() || null,
    ],
  );

  return mapGrievance(result.rows[0]);
}

export async function findGrievanceById(id: string): Promise<Grievance | null> {
  const result = await pool.query<GrievanceRow>(
    `
      SELECT
        id,
        student_id,
        title,
        description,
        category,
        location,
        status,
        created_at,
        updated_at
      FROM grievances
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows.length ? mapGrievance(result.rows[0]) : null;
}

export async function findGrievancesByStudent(
  studentId: string,
): Promise<Grievance[]> {
  const result = await pool.query<GrievanceRow>(
    `
      SELECT
        id,
        student_id,
        title,
        description,
        category,
        location,
        status,
        created_at,
        updated_at
      FROM grievances
      WHERE student_id = $1
      ORDER BY created_at DESC
    `,
    [studentId],
  );

  return result.rows.map(mapGrievance);
}

export async function findAllGrievances(): Promise<Grievance[]> {
  const result = await pool.query<GrievanceRow>(
    `
      SELECT
        id,
        student_id,
        title,
        description,
        category,
        location,
        status,
        created_at,
        updated_at
      FROM grievances
      ORDER BY created_at DESC
    `,
  );

  return result.rows.map(mapGrievance);
}

export async function updateGrievanceStatus(
  id: string,
  status: GrievanceStatus,
): Promise<Grievance | null> {
  const result = await pool.query<GrievanceRow>(
    `
      UPDATE grievances
      SET
        status = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING
        id,
        student_id,
        title,
        description,
        category,
        location,
        status,
        created_at,
        updated_at
    `,
    [status, id],
  );

  return result.rows.length ? mapGrievance(result.rows[0]) : null;
}
