import { pool } from "./db";

export interface TicketCommentRow {
  id: string;
  ticket_id: string;
  actor_id: string;
  note: string;
  created_at: Date;
}

export async function addTicketComment(
  ticketId: string,
  actorId: string,
  note: string
): Promise<TicketCommentRow> {
  const result = await pool.query<TicketCommentRow>(
    `
      INSERT INTO ticket_events
        (ticket_id, actor_id, event_type, note)
      VALUES
        ($1, $2, 'comment', $3)
      RETURNING
        id,
        ticket_id,
        actor_id,
        note,
        created_at
    `,
    [ticketId, actorId, note]
  );

  return result.rows[0];
}

export async function addAffectedUser(
  ticketId: string,
  actorId: string
) {
  const result = await pool.query(
    `
      INSERT INTO ticket_affected_users
        (ticket_id, user_id)
      VALUES
        ($1, $2)
      ON CONFLICT (ticket_id, user_id)
      DO NOTHING
      RETURNING *
    `,
    [ticketId, actorId]
  );

  return result.rows[0] ?? null;
}

export async function updateStatus(
  ticketId: string,
  actorId: string,
  status: string
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        UPDATE tickets
        SET
          status = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
      [status, ticketId]
    );

    if (result.rowCount === 0) {
      throw new Error("Ticket not found");
    }

    await client.query(
      `
        INSERT INTO ticket_events
          (ticket_id, actor_id, event_type, note)
        VALUES
          ($1, $2, 'status_changed', $3)
      `,
      [
        ticketId,
        actorId,
        `Status changed to ${status}`,
      ]
    );

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}