import { pool } from "../data/db"; // adjust path to your db pool
import { v4 as uuidv4 } from "uuid";

/**
 * NOTE:
 * These are minimal implementations to make the routes compile and to
 * demonstrate concurrency-safe operations where appropriate.
 * Replace with your real DB queries and business logic.
 */

export async function createTicket(
  facilityId: string,
  category: string,
  title: string,
  description: string,
  actorId: string,
) {
  // Attempt to insert; rely on DB unique partial index to prevent duplicates.
  const result = await pool.query(
    `
    INSERT INTO tickets
      (facility_id, reported_by, category, title, description)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `,
    [facilityId, actorId, category, title, description],
  );

  return result.rows[0];
}

export async function claimTicket(ticketId: string, actorId: string) {
  // Try to atomically set assigned_to if not already assigned and status allows claiming.
  // Use a single UPDATE with WHERE to avoid race conditions.
  const result = await pool.query(
    `
    UPDATE tickets
    SET assigned_to = $1, status = 'assigned', updated_at = NOW()
    WHERE id = $2
      AND assigned_to IS NULL
      AND status = 'open'
    RETURNING *
  `,
    [actorId, ticketId],
  );

  if (result.rowCount === 0) {
    // Could be already claimed or not found
    // Check if ticket exists
    const check = await pool.query(`SELECT * FROM tickets WHERE id = $1`, [
      ticketId,
    ]);
    if (check.rowCount === 0) {
      return null;
    }
    // Already claimed -> return 409 style by throwing a custom error or return an object
    // Here we throw to let route handler map to 409
    const err: any = new Error("Ticket already claimed");
    err.code = "TICKET_ALREADY_CLAIMED";
    throw err;
  }

  return result.rows[0];
}

export async function commentOnTicket(
  ticketId: string,
  actorId: string,
  note: string,
) {
  const result = await pool.query(
    `
    INSERT INTO ticket_events
      (ticket_id, actor_id, event_type, note, created_at)
    VALUES ($1, $2, 'comment', $3, NOW())
    RETURNING *
  `,
    [ticketId, actorId, note],
  );

  return result.rows[0];
}

export async function registerAffectedUser(ticketId: string, userId: string) {
  const result = await pool.query(
    `
    INSERT INTO ticket_affected_users (ticket_id, user_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    RETURNING *
  `,
    [ticketId, userId],
  );

  // If nothing returned, it already existed; return a simple object
  if (result.rowCount === 0) {
    return { ticket_id: ticketId, user_id: userId, alreadyExisted: true };
  }

  return result.rows[0];
}
