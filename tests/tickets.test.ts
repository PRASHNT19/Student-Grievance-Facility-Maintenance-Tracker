import request from 'supertest';
import { app } from '../src/app';
import { closePool } from '../src/data/db';
import {
  resetDatabase,
  createStudent,
  createStaff,
  createFacility,
  ticketBody,
  MISSING_UUID,
} from './helpers';

// One shared pool serves both blocks in this file, so it is closed once here
// rather than per describe.
afterAll(closePool);

describe('Reporting issues', () => {
  let facilityId: string;
  let otherFacilityId: string;
  let studentId: string;
  let staffId: string;

  beforeEach(async () => {
    await resetDatabase();
    facilityId = (await createFacility('Computer Lab 301')).id;
    otherFacilityId = (await createFacility('Physics Lab')).id;
    studentId = (await createStudent()).id;
    staffId = (await createStaff()).id;
  });

  it('creates an open ticket with the reporter already counted as affected', async () => {
    const res = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      facilityId,
      reportedBy: studentId,
      assignedTo: null,
      category: 'hardware',
      priority: 'high',
      status: 'open',
      // The reporter is affected by definition, so the count starts at one.
      affectedCount: 1,
      resolvedAt: null,
    });
  });

  it('defaults priority to medium', async () => {
    const res = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId, { priority: undefined }));

    expect(res.status).toBe(201);
    expect(res.body.priority).toBe('medium');
  });

  it('rejects an unknown facility, an unknown reporter and a bad category', async () => {
    const unknownFacility = await request(app)
      .post('/tickets')
      .send(ticketBody(MISSING_UUID, studentId));
    expect(unknownFacility.status).toBe(404);
    expect(unknownFacility.body.error.code).toBe('FACILITY_NOT_FOUND');

    const unknownReporter = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, MISSING_UUID));
    expect(unknownReporter.status).toBe(404);
    expect(unknownReporter.body.error.code).toBe('ACTOR_NOT_FOUND');

    const badCategory = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId, { category: 'wombat' }));
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.error.code).toBe('VALIDATION_ERROR');

    const noTitle = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId, { title: '   ' }));
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a second unresolved ticket for the same facility and category', async () => {
    const first = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId));
    expect(first.status).toBe(201);

    const otherStudent = (await createStudent()).id;
    const duplicate = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, otherStudent, { title: 'Projector broken' }));

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_TICKET');
    // The response names the existing ticket, so the second reporter can be
    // sent to it rather than being left with nowhere to go.
    expect(duplicate.body.error.details).toMatchObject({
      ticketId: first.body.id,
      status: 'open',
    });
  });

  it('allows a different category on the same facility, and the same category elsewhere', async () => {
    await request(app).post('/tickets').send(ticketBody(facilityId, studentId));

    const differentCategory = await request(app)
      .post('/tickets')
      .send(
        ticketBody(facilityId, studentId, {
          category: 'electrical',
          title: 'Sockets at the back are dead',
        }),
      );
    expect(differentCategory.status).toBe(201);

    const differentFacility = await request(app)
      .post('/tickets')
      .send(ticketBody(otherFacilityId, studentId));
    expect(differentFacility.status).toBe(201);
  });

  it('allows a fresh ticket once the previous one is finished', async () => {
    const first = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId));

    // Drive it to a finished state: claim -> in_progress -> resolved -> closed.
    await request(app)
      .post(`/tickets/${first.body.id}/claim`)
      .send({ actorId: staffId });
    await request(app)
      .patch(`/tickets/${first.body.id}/status`)
      .send({ actorId: staffId, status: 'in_progress' });
    await request(app)
      .patch(`/tickets/${first.body.id}/status`)
      .send({ actorId: staffId, status: 'resolved' });

    // 'resolved' already leaves the partial index, so the slot is free again.
    const again = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId, { title: 'It broke again' }));

    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(first.body.id);
  });

  it('filters the ticket list', async () => {
    const hardware = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId));
    await request(app)
      .post('/tickets')
      .send(
        ticketBody(otherFacilityId, studentId, {
          category: 'plumbing',
          priority: 'low',
        }),
      );

    const byFacility = await request(app).get(`/tickets?facilityId=${facilityId}`);
    expect(byFacility.body).toHaveLength(1);
    expect(byFacility.body[0].id).toBe(hardware.body.id);

    const byPriority = await request(app).get('/tickets?priority=low');
    expect(byPriority.body).toHaveLength(1);
    expect(byPriority.body[0].category).toBe('plumbing');

    const byStatus = await request(app).get('/tickets?status=open');
    expect(byStatus.body).toHaveLength(2);

    const bogus = await request(app).get('/tickets?status=nonsense');
    expect(bogus.status).toBe(400);
    expect(bogus.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists tickets per facility and 404s an unknown facility', async () => {
    await request(app).post('/tickets').send(ticketBody(facilityId, studentId));
    await request(app)
      .post('/tickets')
      .send(ticketBody(otherFacilityId, studentId));

    const res = await request(app).get(`/facilities/${facilityId}/tickets`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].facilityId).toBe(facilityId);

    const unknown = await request(app).get(`/facilities/${MISSING_UUID}/tickets`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('FACILITY_NOT_FOUND');

    const malformed = await request(app).get('/facilities/abc/tickets');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('"This affects me too"', () => {
  let ticketId: string;
  let facilityId: string;
  let studentId: string;
  let staffId: string;

  beforeEach(async () => {
    await resetDatabase();
    facilityId = (await createFacility()).id;
    studentId = (await createStudent()).id;
    staffId = (await createStaff()).id;

    const created = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId));
    ticketId = created.body.id;
  });

  it('counts additional affected students without creating extra tickets', async () => {
    const second = (await createStudent()).id;
    const third = (await createStudent()).id;

    const res1 = await request(app)
      .post(`/tickets/${ticketId}/affected`)
      .send({ userId: second });
    expect(res1.status).toBe(200);
    expect(res1.body.affectedCount).toBe(2);

    const res2 = await request(app)
      .post(`/tickets/${ticketId}/affected`)
      .send({ userId: third });
    expect(res2.body.affectedCount).toBe(3);

    // Still exactly one ticket for the issue.
    const all = await request(app).get('/tickets');
    expect(all.body).toHaveLength(1);
  });

  it('refuses to count the same person twice, including the reporter', async () => {
    const second = (await createStudent()).id;
    await request(app)
      .post(`/tickets/${ticketId}/affected`)
      .send({ userId: second });

    const again = await request(app)
      .post(`/tickets/${ticketId}/affected`)
      .send({ userId: second });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_AFFECTED');

    // The reporter was registered automatically when the ticket was created.
    const reporter = await request(app)
      .post(`/tickets/${ticketId}/affected`)
      .send({ userId: studentId });
    expect(reporter.status).toBe(409);
    expect(reporter.body.error.code).toBe('ALREADY_AFFECTED');
  });

  it('refuses to register against a finished ticket', async () => {
    await request(app).post(`/tickets/${ticketId}/claim`).send({ actorId: staffId });
    await request(app)
      .patch(`/tickets/${ticketId}/status`)
      .send({ actorId: staffId, status: 'in_progress' });
    await request(app)
      .patch(`/tickets/${ticketId}/status`)
      .send({ actorId: staffId, status: 'resolved' });

    const late = (await createStudent()).id;
    const res = await request(app)
      .post(`/tickets/${ticketId}/affected`)
      .send({ userId: late });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TICKET_NOT_ACTIVE');
  });

  it('returns 404 for an unknown ticket or user', async () => {
    const unknownTicket = await request(app)
      .post(`/tickets/${MISSING_UUID}/affected`)
      .send({ userId: studentId });
    expect(unknownTicket.status).toBe(404);
    expect(unknownTicket.body.error.code).toBe('TICKET_NOT_FOUND');

    const unknownUser = await request(app)
      .post(`/tickets/${ticketId}/affected`)
      .send({ userId: MISSING_UUID });
    expect(unknownUser.status).toBe(404);
    expect(unknownUser.body.error.code).toBe('ACTOR_NOT_FOUND');
  });
});
