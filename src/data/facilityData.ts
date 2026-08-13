import { query, pgErrorCode, PG_UNIQUE_VIOLATION } from './db';
import { conflict } from '../errors';
import type { Facility } from '../types';

interface FacilityRow {
  id: string;
  name: string;
  building: string;
}

const FACILITY_COLUMNS = 'id, name, building';

const toFacility = (row: FacilityRow): Facility => ({
  id: row.id,
  name: row.name,
  building: row.building,
});

export async function insertFacility(
  name: string,
  building: string,
): Promise<Facility> {
  try {
    const { rows } = await query<FacilityRow>(
      `INSERT INTO facilities (name, building)
       VALUES ($1, $2)
       RETURNING ${FACILITY_COLUMNS}`,
      [name, building],
    );
    return toFacility(rows[0]);
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw conflict(
        'FACILITY_EXISTS',
        `"${name}" is already registered in ${building}.`,
      );
    }
    throw err;
  }
}

export async function listFacilities(building?: string): Promise<Facility[]> {
  const { rows } = await query<FacilityRow>(
    `SELECT ${FACILITY_COLUMNS}
       FROM facilities
      WHERE ($1::text IS NULL OR building = $1::text)
      ORDER BY building ASC, name ASC`,
    [building ?? null],
  );
  return rows.map(toFacility);
}

export async function findFacilityById(id: string): Promise<Facility | null> {
  const { rows } = await query<FacilityRow>(
    `SELECT ${FACILITY_COLUMNS} FROM facilities WHERE id = $1`,
    [id],
  );
  return rows.length ? toFacility(rows[0]) : null;
}
