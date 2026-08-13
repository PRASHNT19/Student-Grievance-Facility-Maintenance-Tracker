import request from 'supertest';
import { app } from '../src/app';
import { pool, closePool } from '../src/data/db';
import {
  resetDatabase,
  createStudent,
  createStaff,
  createFacility,
  ticketBody,
  SLOT,
} from './helpers';

/**
 * The core tests of the project.
 *
 * Everything here runs against the real PostgreSQL database named by
 * DATABASE_URL. Nothing is mocked or stubbed. Each block covers one of the
 * three rules the database, rather than the application, is responsible for:
 *
 *   G1  tickets_one_active_per_issue   one active ticket per facility+category
 *   G2  maintenance_no_overlap         no overlapping maintenance on a facility
 *   G3  the guarded claim UPDATE       at most one assignee per ticket
 *
 * Each block contains a request-level test (two simultaneous HTTP requests) and
 * a connection-level test that reproduces the exact race a naive
 * check-then-write implementation loses.
 */

// One shared pool serves every block in this file, so it is closed once here
// rather than per describe.
afterAll(closePool);

const activeTicketCount = async (facilityId: string): Promise<number> => {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM tickets
      WHERE facility_id = $1
        AND category = 'hardware'
        AND status IN ('open', 'assigned', 'in_progress')`,
    [facilityId],
  );
  return rows[0].count;
};

describe('G1 -- two students reporting the same issue at the same instant', () => {
  let facilityId: string;
  let studentA: string;
  let studentB: string;

  beforeEach(async () => {
    await resetDatabase();
    facilityId = (await createFacility()).id;
    studentA = (await createStudent('Student A')).id;
    studentB = (await createStudent('Student B')).id;
  });

  it('lets exactly one of two simultaneous duplicate reports succeed', async () => {
    // Same facility, same category, two different students, both requests
    // fired at the same time.
    const [first, second] = await Promise.all([
      request(app).post('/tickets').send(ticketBody(facilityId, studentA)),
      request(app)
        .post('/tickets')
        .send(
          ticketBody(facilityId, studentB, { title: 'Projector is dead again' }),
        ),
    ]);

    const statuses = [first.status, second.status].sort();

    // Exactly one 201 and exactly one 409 -- never two 201s.
    expect(statuses).toEqual([201, 409]);

    // The loser failed specifically because of the unique index.
    // DUPLICATE_TICKET is produced in exactly one place in the codebase:
    // src/data/ticketData.ts, when PostgreSQL raises SQLSTATE 23505 on
    // constraint tickets_one_active_per_issue. No application-level lookup can
    // generate this code.
    const loser = first.status === 409 ? first : second;
    const winner = first.status === 201 ? first : second;
    expect(loser.body.error.code).toBe('DUPLICATE_TICKET');

    // And the 409 points the losing reporter at the ticket that did win.
    expect(loser.body.error.details.ticketId).toBe(winner.body.id);

    // The database really holds only one active ticket for the issue.
    expect(await activeTicketCount(facilityId)).toBe(1);
  });

  it('proves the index, not the application, is what blocks the second report', async () => {
    // This reproduces the exact race that a naive "look for an existing ticket
    // then insert" implementation loses, using two separate database
    // connections in two concurrent transactions.
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    const insert = `
      INSERT INTO tickets
        (facility_id, reported_by, category, priority, title, description)
      VALUES ($1, $2, 'hardware', 'high', 'Projector will not power on', 'No light.')`;

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      // Transaction A files its ticket but does not commit yet.
      await clientA.query(insert, [facilityId, studentA]);

      // Transaction B now runs the naive duplicate check. A's row is still
      // uncommitted and therefore invisible, so the check reports "no existing
      // ticket" -- this is precisely the moment where check-then-insert goes
      // wrong.
      const naiveCheck = await clientB.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM tickets
          WHERE facility_id = $1
            AND category = 'hardware'
            AND status IN ('open', 'assigned', 'in_progress')`,
        [facilityId],
      );
      expect(naiveCheck.rows[0].count).toBe(0); // "nothing filed yet" -- but there is

      // Acting on that check, B inserts. PostgreSQL blocks this statement until
      // A resolves, instead of letting both rows through.
      //
      // The expectation is attached here, before the COMMIT below, rather than
      // after it: the statement is already waiting server-side and rejects the
      // instant A commits, so the promise must never be left unhandled.
      // Once A commits, B's insert fails with SQLSTATE 23505 = unique_violation.
      const blockedInsert = expect(
        clientB.query(insert, [facilityId, studentB]),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'tickets_one_active_per_issue',
      });

      await clientA.query('COMMIT');
      await blockedInsert;

      await clientB.query('ROLLBACK');
    } finally {
      clientA.release();
      clientB.release();
    }

    expect(await activeTicketCount(facilityId)).toBe(1);
  });
});

describe('G2 -- two staff scheduling overlapping maintenance at the same instant', () => {
  let facilityId: string;
  let staffA: string;
  let staffB: string;

  beforeEach(async () => {
    await resetDatabase();
    facilityId = (await createFacility()).id;
    staffA = (await createStaff('Staff A')).id;
    staffB = (await createStaff('Staff B')).id;
  });

  const scheduledCount = async (): Promise<number> => {
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM maintenance_windows
        WHERE facility_id = $1 AND status = 'scheduled'`,
      [facilityId],
    );
    return rows[0].count;
  };

  it('lets exactly one of two simultaneous overlapping requests succeed', async () => {
    // Same facility, overlapping periods (09:00-10:00 vs 09:30-10:30),
    // two different staff members, both requests fired at the same time.
    const [first, second] = await Promise.all([
      request(app).post(`/facilities/${facilityId}/maintenance`).send({
        actorId: staffA,
        startTime: SLOT.start,
        endTime: SLOT.end,
      }),
      request(app).post(`/facilities/${facilityId}/maintenance`).send({
        actorId: staffB,
        startTime: SLOT.overlappingStart,
        endTime: SLOT.overlappingEnd,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    // MAINTENANCE_CONFLICT is produced in exactly one place in the codebase:
    // src/data/maintenanceData.ts, when PostgreSQL raises SQLSTATE 23P01.
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('MAINTENANCE_CONFLICT');

    expect(await scheduledCount()).toBe(1);
  });

  it('proves the exclusion constraint is what blocks the second write', async () => {
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    const insert = `
      INSERT INTO maintenance_windows
        (facility_id, scheduled_by, start_time, end_time, status)
      VALUES ($1, $2, $3, $4, 'scheduled')`;

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      await clientA.query(insert, [facilityId, staffA, SLOT.start, SLOT.end]);

      // The naive availability check, run at the worst possible moment.
      const naiveCheck = await clientB.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM maintenance_windows
          WHERE facility_id = $1
            AND status = 'scheduled'
            AND tstzrange(start_time, end_time, '[)')
                && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        [facilityId, SLOT.overlappingStart, SLOT.overlappingEnd],
      );
      expect(naiveCheck.rows[0].count).toBe(0); // "period is free" -- but it is not

      // As in the G1 test, the expectation is attached before the COMMIT so the
      // blocked statement's rejection is never momentarily unhandled.
      // Once A commits, B's insert fails with SQLSTATE 23P01 = exclusion_violation.
      const blockedInsert = expect(
        clientB.query(insert, [
          facilityId,
          staffB,
          SLOT.overlappingStart,
          SLOT.overlappingEnd,
        ]),
      ).rejects.toMatchObject({
        code: '23P01',
        constraint: 'maintenance_no_overlap',
      });

      await clientA.query('COMMIT');
      await blockedInsert;

      await clientB.query('ROLLBACK');
    } finally {
      clientA.release();
      clientB.release();
    }

    expect(await scheduledCount()).toBe(1);
  });
});

describe('G3 -- two staff claiming the same ticket at the same instant', () => {
  let ticketId: string;
  let staffA: string;
  let staffB: string;

  const GUARDED_CLAIM = `
    UPDATE tickets
       SET assigned_to = $2, status = 'assigned'
     WHERE id = $1
       AND status = 'open'
       AND assigned_to IS NULL`;

  const assigneeOf = async (id: string): Promise<string | null> => {
    const { rows } = await pool.query<{ assigned_to: string | null }>(
      'SELECT assigned_to FROM tickets WHERE id = $1',
      [id],
    );
    return rows[0].assigned_to;
  };

  beforeEach(async () => {
    await resetDatabase();
    const facilityId = (await createFacility()).id;
    const studentId = (await createStudent()).id;
    staffA = (await createStaff('Staff A')).id;
    staffB = (await createStaff('Staff B')).id;

    const created = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId));
    ticketId = created.body.id;
  });

  it('lets exactly one of two simultaneous claims succeed', async () => {
    const [first, second] = await Promise.all([
      request(app).post(`/tickets/${ticketId}/claim`).send({ actorId: staffA }),
      request(app).post(`/tickets/${ticketId}/claim`).send({ actorId: staffB }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('TICKET_ALREADY_CLAIMED');

    // The winner owns the ticket, and the database agrees.
    expect([staffA, staffB]).toContain(winner.body.assignedTo);
    expect(await assigneeOf(ticketId)).toBe(winner.body.assignedTo);

    // The loser's error names the actual owner, not itself.
    expect(loser.body.error.details.assignedTo).toBe(winner.body.assignedTo);

    // Exactly one 'claimed' event was recorded -- the losing claim left no
    // trace in the audit trail, because its transaction never committed a row.
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM ticket_events
        WHERE ticket_id = $1 AND event_type = 'claimed'`,
      [ticketId],
    );
    expect(rows[0].count).toBe(1);
  });

  it('proves the WHERE guard, not the application, is what blocks the second claim', async () => {
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      // Transaction A claims the ticket but does not commit yet.
      const aClaim = await clientA.query(GUARDED_CLAIM, [ticketId, staffA]);
      expect(aClaim.rowCount).toBe(1);

      // Transaction B now runs the naive check. A's update is uncommitted and
      // therefore invisible, so the ticket still looks unclaimed -- precisely
      // the moment where check-then-update goes wrong.
      const naiveCheck = await clientB.query<{ assigned_to: string | null }>(
        'SELECT assigned_to FROM tickets WHERE id = $1',
        [ticketId],
      );
      expect(naiveCheck.rows[0].assigned_to).toBeNull(); // "nobody has it" -- but A does

      // Acting on that check, B issues its claim. PostgreSQL blocks the
      // statement on A's row lock instead of letting it through.
      const blockedClaim = clientB.query(GUARDED_CLAIM, [ticketId, staffB]);

      await clientA.query('COMMIT');

      // Unlike G1 and G2 this is not an error: once A commits, B's UPDATE is
      // re-evaluated against the new row version, the WHERE no longer matches,
      // and it simply affects nothing. Zero rows is how the service knows it
      // lost the race.
      const bClaim = await blockedClaim;
      expect(bClaim.rowCount).toBe(0);

      await clientB.query('COMMIT');
    } finally {
      clientA.release();
      clientB.release();
    }

    expect(await assigneeOf(ticketId)).toBe(staffA);
  });

  it('negative control: without the WHERE guard the second claim silently wins', async () => {
    // The same race, but B issues the UPDATE a check-then-update implementation
    // would write -- unguarded, because "we already checked that it was free".
    // This is the control for the test above: it shows the guard is what does
    // the work, not the blocking, the transaction, or anything else.
    const UNGUARDED_CLAIM = `
      UPDATE tickets
         SET assigned_to = $2, status = 'assigned'
       WHERE id = $1`;

    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      await clientA.query(GUARDED_CLAIM, [ticketId, staffA]);

      const naiveCheck = await clientB.query<{ assigned_to: string | null }>(
        'SELECT assigned_to FROM tickets WHERE id = $1',
        [ticketId],
      );
      expect(naiveCheck.rows[0].assigned_to).toBeNull();

      const blockedClaim = clientB.query(UNGUARDED_CLAIM, [ticketId, staffB]);

      await clientA.query('COMMIT');

      // B's update matched, because there was no condition left to fail.
      const bClaim = await blockedClaim;
      expect(bClaim.rowCount).toBe(1);

      await clientB.query('COMMIT');
    } finally {
      clientA.release();
      clientB.release();
    }

    // A was told it had claimed the ticket. It no longer owns it, and nothing
    // anywhere reported an error. This is the bug the guard prevents.
    expect(await assigneeOf(ticketId)).toBe(staffB);
  });
});
