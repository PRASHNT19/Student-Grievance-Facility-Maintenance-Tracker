import {
  query,
  pgErrorCode,
  pgConstraintName,
  PG_EXCLUSION_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_CHECK_VIOLATION,
} from './db';
import { badRequest, conflict } from '../errors';
import type {
  MaintenanceStatus,
  MaintenanceWindow,
  NewMaintenanceWindow,
} from '../types';

interface MaintenanceRow {
  id: string;
  facility_id: string;
  scheduled_by: string;
  start_time: Date;
  end_time: Date;
  note: string | null;
  status: MaintenanceStatus;
}

const MAINTENANCE_COLUMNS =
  'id, facility_id, scheduled_by, start_time, end_time, note, status';

const toWindow = (row: MaintenanceRow): MaintenanceWindow => ({
  id: row.id,
  facilityId: row.facility_id,
  scheduledBy: row.scheduled_by,
  startTime: row.start_time,
  endTime: row.end_time,
  note: row.note,
  status: row.status,
});

/**
 * Schedules a maintenance window.
 *
 * Note what is NOT here: there is no "SELECT ... WHERE the periods overlap"
 * check before the INSERT. The single INSERT is the whole operation. If another
 * transaction is holding a conflicting scheduled window, PostgreSQL's exclusion
 * constraint raises SQLSTATE 23P01 and we translate that into a 409. That
 * translation is the ONLY way this function can produce a scheduling conflict,
 * which is what the concurrency test asserts on.
 */
export async function insertMaintenanceWindow(
  input: NewMaintenanceWindow,
): Promise<MaintenanceWindow> {
  try {
    const { rows } = await query<MaintenanceRow>(
      `INSERT INTO maintenance_windows
         (facility_id, scheduled_by, start_time, end_time, note, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')
       RETURNING ${MAINTENANCE_COLUMNS}`,
      [
        input.facilityId,
        input.scheduledBy,
        input.startTime.toISOString(),
        input.endTime.toISOString(),
        input.note ?? null,
      ],
    );
    return toWindow(rows[0]);
  } catch (err) {
    const code = pgErrorCode(err);

    if (code === PG_EXCLUSION_VIOLATION) {
      throw conflict(
        'MAINTENANCE_CONFLICT',
        'The facility already has maintenance scheduled for an overlapping period.',
      );
    }

    // Defensive: the service layer already checks that the facility and the
    // scheduling staff member exist, but a row could be deleted between that
    // check and this INSERT.
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      const constraint = pgConstraintName(err) ?? '';
      throw badRequest(
        'INVALID_REFERENCE',
        constraint.includes('scheduled_by')
          ? 'The scheduling user no longer exists.'
          : 'The referenced facility no longer exists.',
      );
    }

    if (code === PG_CHECK_VIOLATION) {
      throw badRequest(
        'INVALID_MAINTENANCE_WINDOW',
        'The maintenance period is not valid.',
      );
    }

    throw err;
  }
}

export async function findMaintenanceWindowById(
  id: string,
): Promise<MaintenanceWindow | null> {
  const { rows } = await query<MaintenanceRow>(
    `SELECT ${MAINTENANCE_COLUMNS} FROM maintenance_windows WHERE id = $1`,
    [id],
  );
  return rows.length ? toWindow(rows[0]) : null;
}

/**
 * Marks a scheduled window as completed or cancelled. Closing a window is a
 * status change rather than a row delete: the row stays for auditing, and
 * because the exclusion constraint has a `WHERE (status = 'scheduled')` clause,
 * a closed row stops blocking the period the moment it is closed.
 *
 * The `AND status = 'scheduled'` guard makes this a single atomic statement --
 * two simultaneous closes cannot both report success.
 */
export async function closeMaintenanceWindow(
  id: string,
  nextStatus: Exclude<MaintenanceStatus, 'scheduled'>,
): Promise<MaintenanceWindow | null> {
  const { rows } = await query<MaintenanceRow>(
    `UPDATE maintenance_windows
        SET status = $2::maintenance_status
      WHERE id = $1 AND status = 'scheduled'
      RETURNING ${MAINTENANCE_COLUMNS}`,
    [id, nextStatus],
  );
  return rows.length ? toWindow(rows[0]) : null;
}

export async function listMaintenanceForFacility(
  facilityId: string,
  status?: MaintenanceStatus,
): Promise<MaintenanceWindow[]> {
  const { rows } = await query<MaintenanceRow>(
    `SELECT ${MAINTENANCE_COLUMNS}
       FROM maintenance_windows
      WHERE facility_id = $1
        AND ($2::maintenance_status IS NULL OR status = $2::maintenance_status)
      ORDER BY start_time ASC`,
    [facilityId, status ?? null],
  );
  return rows.map(toWindow);
}
