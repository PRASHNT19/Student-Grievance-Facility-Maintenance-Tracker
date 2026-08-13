import type { PoolClient } from 'pg';
import {
  query,
  withTransaction,
  pgErrorCode,
  pgConstraintName,
  PG_UNIQUE_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_CHECK_VIOLATION,
} from './db';
import { badRequest, conflict } from '../errors';
import type {
  IssueCategory,
  NewTicket,
  Ticket,
  TicketEvent,
  TicketEventType,
  TicketFilters,
  TicketPriority,
  TicketStatus,
} from '../types';

interface TicketRow {
  id: string;
  facility_id: string;
  reported_by: string;
  assigned_to: string | null;
  category: IssueCategory;
  priority: TicketPriority;
  title: string;
  description: string;
  status: TicketStatus;
  affected_count: number;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

interface TicketEventRow {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  event_type: TicketEventType;
  from_status: TicketStatus | null;
  to_status: TicketStatus | null;
  note: string | null;
  created_at: Date;
}

/**
 * The column list, parameterised by table alias so the same projection can be
 * used in a `SELECT ... FROM tickets t` and in a `RETURNING` clause (where the
 * only usable name is the table's own). The alias values are literals in this
 * file, never user input.
 */
const ticketColumns = (t: string): string => `
  ${t}.id, ${t}.facility_id, ${t}.reported_by, ${t}.assigned_to,
  ${t}.category, ${t}.priority, ${t}.title, ${t}.description, ${t}.status,
  ${t}.created_at, ${t}.updated_at, ${t}.resolved_at,
  (SELECT count(*)::int
     FROM ticket_affected_users a
    WHERE a.ticket_id = ${t}.id) AS affected_count`;

const SELECT_COLUMNS = ticketColumns('t');
const RETURNING_COLUMNS = ticketColumns('tickets');

const EVENT_COLUMNS =
  'id, ticket_id, actor_id, event_type, from_status, to_status, note, created_at';

const toTicket = (row: TicketRow): Ticket => ({
  id: row.id,
  facilityId: row.facility_id,
  reportedBy: row.reported_by,
  assignedTo: row.assigned_to,
  category: row.category,
  priority: row.priority,
  title: row.title,
  description: row.description,
  status: row.status,
  affectedCount: row.affected_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
});

const toTicketEvent = (row: TicketEventRow): TicketEvent => ({
  id: row.id,
  ticketId: row.ticket_id,
  actorId: row.actor_id,
  eventType: row.event_type,
  fromStatus: row.from_status,
  toStatus: row.to_status,
  note: row.note,
  createdAt: row.created_at,
});

interface NewEvent {
  ticketId: string;
  actorId: string | null;
  eventType: TicketEventType;
  fromStatus?: TicketStatus | null;
  toStatus?: TicketStatus | null;
  note?: string | null;
}

/** Appends one row to a ticket's audit trail. Always called inside a transaction. */
async function insertEvent(
  client: PoolClient,
  event: NewEvent,
): Promise<TicketEvent> {
  const { rows } = await client.query<TicketEventRow>(
    `INSERT INTO ticket_events
       (ticket_id, actor_id, event_type, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${EVENT_COLUMNS}`,
    [
      event.ticketId,
      event.actorId,
      event.eventType,
      event.fromStatus ?? null,
      event.toStatus ?? null,
      event.note ?? null,
    ],
  );
  return toTicketEvent(rows[0]);
}

/**
 * Reports an issue.
 *
 * Note what is NOT here: there is no "SELECT ... WHERE an active ticket already
 * exists" check before the INSERT. Duplicate suppression is decided by the
 * partial unique index `tickets_one_active_per_issue` during this INSERT, so no
 * gap exists between "check" and "insert" for a competing report to slip
 * through. Two students pressing report at the same instant produce exactly one
 * ticket and one 409.
 *
 * The ticket row, its `reported` event and the reporter's own affected-user row
 * are written in one transaction: a ticket with no history would be a corrupt
 * audit trail.
 */
export async function insertTicket(input: NewTicket): Promise<Ticket> {
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query<TicketRow>(
        `INSERT INTO tickets
           (facility_id, reported_by, category, priority, title, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${RETURNING_COLUMNS}`,
        [
          input.facilityId,
          input.reportedBy,
          input.category,
          input.priority,
          input.title,
          input.description,
        ],
      );
      const ticket = toTicket(rows[0]);

      await insertEvent(client, {
        ticketId: ticket.id,
        actorId: input.reportedBy,
        eventType: 'reported',
        toStatus: 'open',
      });

      // Whoever reports an issue is affected by it, so the count starts at one
      // and "me too" from the reporter is correctly rejected as a duplicate.
      await client.query(
        'INSERT INTO ticket_affected_users (ticket_id, user_id) VALUES ($1, $2)',
        [ticket.id, input.reportedBy],
      );

      return { ...ticket, affectedCount: 1 };
    });
  } catch (err) {
    const code = pgErrorCode(err);

    if (
      code === PG_UNIQUE_VIOLATION &&
      pgConstraintName(err) === 'tickets_one_active_per_issue'
    ) {
      // The transaction above has already rolled back, so this runs on a clean
      // connection. Unlike a booking clash, naming the existing ticket is the
      // point: the reporter should be sent to it rather than filing a second.
      const existing = await findActiveTicketForIssue(
        input.facilityId,
        input.category,
      );
      throw conflict(
        'DUPLICATE_TICKET',
        'An unresolved ticket for this facility and category already exists.',
        existing
          ? {
              ticketId: existing.id,
              title: existing.title,
              status: existing.status,
              affectedCount: existing.affectedCount,
            }
          : undefined,
      );
    }

    // Defensive: the service already checks that the facility and reporter
    // exist, but a row could be deleted between that check and this INSERT.
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      const constraint = pgConstraintName(err) ?? '';
      throw badRequest(
        'INVALID_REFERENCE',
        constraint.includes('reported_by')
          ? 'The reporting user no longer exists.'
          : 'The referenced facility no longer exists.',
      );
    }

    throw err;
  }
}

export async function findTicketById(id: string): Promise<Ticket | null> {
  const { rows } = await query<TicketRow>(
    `SELECT ${SELECT_COLUMNS} FROM tickets t WHERE t.id = $1`,
    [id],
  );
  return rows.length ? toTicket(rows[0]) : null;
}

/** The single unfinished ticket for a facility+category, if there is one. */
export async function findActiveTicketForIssue(
  facilityId: string,
  category: IssueCategory,
): Promise<Ticket | null> {
  const { rows } = await query<TicketRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM tickets t
      WHERE t.facility_id = $1
        AND t.category = $2::issue_category
        AND t.status IN ('open', 'assigned', 'in_progress')`,
    [facilityId, category],
  );
  return rows.length ? toTicket(rows[0]) : null;
}

export async function listTickets(filters: TicketFilters = {}): Promise<Ticket[]> {
  const { rows } = await query<TicketRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM tickets t
      WHERE ($1::uuid IS NULL OR t.facility_id = $1::uuid)
        AND ($2::ticket_status IS NULL OR t.status = $2::ticket_status)
        AND ($3::ticket_priority IS NULL OR t.priority = $3::ticket_priority)
        AND ($4::issue_category IS NULL OR t.category = $4::issue_category)
        AND ($5::uuid IS NULL OR t.reported_by = $5::uuid)
        AND ($6::uuid IS NULL OR t.assigned_to = $6::uuid)
      ORDER BY t.created_at DESC`,
    [
      filters.facilityId ?? null,
      filters.status ?? null,
      filters.priority ?? null,
      filters.category ?? null,
      filters.reportedBy ?? null,
      filters.assignedTo ?? null,
    ],
  );
  return rows.map(toTicket);
}

export async function listTicketEvents(ticketId: string): Promise<TicketEvent[]> {
  const { rows } = await query<TicketEventRow>(
    `SELECT ${EVENT_COLUMNS}
       FROM ticket_events
      WHERE ticket_id = $1
      ORDER BY created_at ASC, id ASC`,
    [ticketId],
  );
  return rows.map(toTicketEvent);
}

/**
 * GUARANTEE G3 -- a ticket has at most one assignee.
 *
 * The `WHERE status = 'open' AND assigned_to IS NULL` clause is not a
 * precaution around a prior check; it *is* the check, evaluated by PostgreSQL
 * while it holds the row lock for this UPDATE. Two staff members claiming the
 * same ticket at the same instant are serialised on that lock, and the second
 * one re-reads a row that no longer matches, so it updates zero rows.
 *
 * Returns null when nothing matched -- the caller distinguishes "no such
 * ticket" from "someone else got there first".
 */
export async function claimTicket(
  ticketId: string,
  actorId: string,
): Promise<Ticket | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<TicketRow>(
      `UPDATE tickets
          SET assigned_to = $2, status = 'assigned'
        WHERE id = $1
          AND status = 'open'
          AND assigned_to IS NULL
        RETURNING ${RETURNING_COLUMNS}`,
      [ticketId, actorId],
    );

    if (!rows.length) return null;

    await insertEvent(client, {
      ticketId,
      actorId,
      eventType: 'claimed',
      fromStatus: 'open',
      toStatus: 'assigned',
    });

    return toTicket(rows[0]);
  });
}

/**
 * Moves a ticket from `expectedStatus` to `nextStatus`.
 *
 * The service decides whether the transition is legal; this function makes the
 * write conditional on the ticket still being in the status the service saw.
 * If a competing request moved it in the meantime the UPDATE matches no rows
 * and returns null, so a stale decision can never be applied.
 *
 * `assigned_to` and `resolved_at` are derived here rather than by the caller so
 * they cannot drift out of step with `status` and violate the CHECK constraints.
 */
export async function changeTicketStatus(
  ticketId: string,
  actorId: string,
  expectedStatus: TicketStatus,
  nextStatus: TicketStatus,
  note?: string,
): Promise<Ticket | null> {
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query<TicketRow>(
        `UPDATE tickets
            SET status = $3::ticket_status,
                -- Releasing a ticket puts it back in the unclaimed pool.
                assigned_to = CASE
                                WHEN $3::ticket_status = 'open' THEN NULL
                                ELSE assigned_to
                              END,
                -- Set on the way into a finished state, cleared on reopen.
                resolved_at = CASE
                                WHEN $3::ticket_status
                                     IN ('resolved', 'closed', 'rejected')
                                  THEN coalesce(resolved_at, now())
                                ELSE NULL
                              END
          WHERE id = $1
            AND status = $2::ticket_status
          RETURNING ${RETURNING_COLUMNS}`,
        [ticketId, expectedStatus, nextStatus],
      );

      if (!rows.length) return null;

      await insertEvent(client, {
        ticketId,
        actorId,
        eventType: 'status_changed',
        fromStatus: expectedStatus,
        toStatus: nextStatus,
        note: note ?? null,
      });

      return toTicket(rows[0]);
    });
  } catch (err) {
    const code = pgErrorCode(err);
    const constraint = pgConstraintName(err) ?? '';

    // Reopening a finished ticket puts it back into the active set, where the
    // duplicate-suppression index applies again. If a newer ticket now holds
    // that facility+category slot, the reopen is refused.
    if (
      code === PG_UNIQUE_VIOLATION &&
      constraint === 'tickets_one_active_per_issue'
    ) {
      throw conflict(
        'ACTIVE_TICKET_EXISTS',
        'Another unresolved ticket already covers this facility and category.',
      );
    }

    // Defensive: the service refuses to start work on an unassigned ticket, so
    // reaching this means the assignee was deleted concurrently.
    if (code === PG_CHECK_VIOLATION && constraint === 'tickets_active_is_assigned') {
      throw conflict(
        'TICKET_NOT_ASSIGNED',
        'The ticket must be claimed before work can be recorded against it.',
      );
    }

    throw err;
  }
}

export async function addComment(
  ticketId: string,
  actorId: string,
  note: string,
): Promise<TicketEvent> {
  return withTransaction((client) =>
    insertEvent(client, {
      ticketId,
      actorId,
      eventType: 'comment',
      note,
    }),
  );
}

/**
 * Registers a user as affected by an existing ticket ("this affects me too").
 *
 * The primary key on (ticket_id, user_id) is what prevents double counting --
 * again a constraint rather than a prior SELECT, so a double-tapped button
 * cannot inflate the number.
 */
export async function markAffected(
  ticketId: string,
  userId: string,
): Promise<Ticket> {
  try {
    await query(
      'INSERT INTO ticket_affected_users (ticket_id, user_id) VALUES ($1, $2)',
      [ticketId, userId],
    );
  } catch (err) {
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw conflict(
        'ALREADY_AFFECTED',
        'This user is already registered as affected by the ticket.',
      );
    }
    if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
      throw badRequest(
        'INVALID_REFERENCE',
        'The referenced ticket or user no longer exists.',
      );
    }
    throw err;
  }

  // The row was just inserted, so the ticket is guaranteed to exist.
  return (await findTicketById(ticketId)) as Ticket;
}
