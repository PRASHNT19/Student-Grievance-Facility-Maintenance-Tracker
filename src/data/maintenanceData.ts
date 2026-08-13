import { pool } from "./db";

export async function createMaintenanceWindow(
  facilityId: string,
  startTime: string,
  endTime: string,
  note: string,
  scheduledBy: string,
) {
  const result = await pool.query(
    `
      INSERT INTO maintenance_windows
        (
          facility_id,
          start_time,
          end_time,
          note,
          scheduled_by
        )
      VALUES
        ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [facilityId, startTime, endTime, note, scheduledBy],
  );

  return result.rows[0];
}

export async function getMaintenanceWindows(facilityId: string) {
  const result = await pool.query(
    `
      SELECT *
      FROM maintenance_windows
      WHERE facility_id = $1
      ORDER BY start_time ASC
    `,
    [facilityId],
  );

  return result.rows;
}

export async function updateMaintenanceWindow(
  id: string,
  startTime: string,
  endTime: string,
  note: string,
) {
  const result = await pool.query(
    `
      UPDATE maintenance_windows
      SET
        start_time = $1,
        end_time = $2,
        note = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `,
    [startTime, endTime, note, id],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}
