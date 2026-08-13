import request from 'supertest';
import { app } from '../src/app';
import { closePool } from '../src/data/db';
import {
  resetDatabase,
  createStudent,
  createStaff,
  createFacility,
  SLOT,
  MISSING_UUID,
} from './helpers';

describe('Maintenance windows', () => {
  let facilityId: string;
  let staffId: string;
  let studentId: string;

  const schedule = (body: Record<string, unknown>, id = facilityId) =>
    request(app).post(`/facilities/${id}/maintenance`).send(body);

  beforeEach(async () => {
    await resetDatabase();
    facilityId = (await createFacility()).id;
    staffId = (await createStaff()).id;
    studentId = (await createStudent()).id;
  });

  afterAll(closePool);

  it('schedules a window', async () => {
    const res = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
      note: 'Replacing the projector lamp',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      facilityId,
      scheduledBy: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
      note: 'Replacing the projector lamp',
      status: 'scheduled',
    });
  });

  it('rejects a window whose startTime is not before its endTime', async () => {
    const res = await schedule({
      actorId: staffId,
      startTime: SLOT.end,
      endTime: SLOT.start,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIME_RANGE');
  });

  it('refuses a student, an unknown facility and a malformed id', async () => {
    const student = await schedule({
      actorId: studentId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });
    expect(student.status).toBe(403);
    expect(student.body.error.code).toBe('ACTOR_NOT_STAFF');

    const unknownFacility = await schedule(
      { actorId: staffId, startTime: SLOT.start, endTime: SLOT.end },
      MISSING_UUID,
    );
    expect(unknownFacility.status).toBe(404);
    expect(unknownFacility.body.error.code).toBe('FACILITY_NOT_FOUND');

    const malformed = await request(app)
      .post('/facilities/abc/maintenance')
      .send({ actorId: staffId, startTime: SLOT.start, endTime: SLOT.end });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a sequential overlapping window with 409', async () => {
    const first = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });
    expect(first.status).toBe(201);

    const overlapping = await schedule({
      actorId: staffId,
      startTime: SLOT.overlappingStart,
      endTime: SLOT.overlappingEnd,
    });

    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('MAINTENANCE_CONFLICT');
  });

  it('allows a back-to-back window that only touches at the boundary', async () => {
    await schedule({ actorId: staffId, startTime: SLOT.start, endTime: SLOT.end });

    const adjacent = await schedule({
      actorId: staffId,
      startTime: SLOT.adjacentStart,
      endTime: SLOT.adjacentEnd,
    });

    // The constraint uses a half-open '[)' range, so 10:00-11:00 does not
    // overlap 09:00-10:00.
    expect(adjacent.status).toBe(201);
  });

  it('allows the same period on a different facility', async () => {
    await schedule({ actorId: staffId, startTime: SLOT.start, endTime: SLOT.end });

    const otherFacility = (await createFacility('Physics Lab')).id;
    const res = await schedule(
      { actorId: staffId, startTime: SLOT.start, endTime: SLOT.end },
      otherFacility,
    );

    expect(res.status).toBe(201);
  });

  it('frees the period when a window is cancelled', async () => {
    const created = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });

    const cancelled = await request(app)
      .patch(`/maintenance/${created.body.id}`)
      .send({ actorId: staffId, status: 'cancelled' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      id: created.body.id,
      status: 'cancelled',
    });

    // The exclusion constraint ignores non-scheduled rows, so the identical
    // period can be scheduled again.
    const rescheduled = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });
    expect(rescheduled.status).toBe(201);
    expect(rescheduled.body.id).not.toBe(created.body.id);
  });

  it('frees the period when a window is completed', async () => {
    const created = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });

    const completed = await request(app)
      .patch(`/maintenance/${created.body.id}`)
      .send({ actorId: staffId, status: 'completed' });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('completed');

    const rescheduled = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });
    expect(rescheduled.status).toBe(201);
  });

  it('returns 404 for an unknown window and 409 when closing twice', async () => {
    const unknown = await request(app)
      .patch(`/maintenance/${MISSING_UUID}`)
      .send({ actorId: staffId, status: 'cancelled' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('MAINTENANCE_NOT_FOUND');

    const created = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });
    await request(app)
      .patch(`/maintenance/${created.body.id}`)
      .send({ actorId: staffId, status: 'cancelled' });

    const again = await request(app)
      .patch(`/maintenance/${created.body.id}`)
      .send({ actorId: staffId, status: 'completed' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('MAINTENANCE_ALREADY_CLOSED');
  });

  it('refuses to put a window back into the scheduled state', async () => {
    const created = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });

    const res = await request(app)
      .patch(`/maintenance/${created.body.id}`)
      .send({ actorId: staffId, status: 'scheduled' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists a facility\'s windows in order and filters by status', async () => {
    // Insert the later window first to prove the ordering is applied.
    await schedule({
      actorId: staffId,
      startTime: SLOT.adjacentStart,
      endTime: SLOT.adjacentEnd,
    });
    const first = await schedule({
      actorId: staffId,
      startTime: SLOT.start,
      endTime: SLOT.end,
    });

    const all = await request(app).get(`/facilities/${facilityId}/maintenance`);
    expect(all.status).toBe(200);
    expect(all.body.map((w: { startTime: string }) => w.startTime)).toEqual([
      SLOT.start,
      SLOT.adjacentStart,
    ]);

    await request(app)
      .patch(`/maintenance/${first.body.id}`)
      .send({ actorId: staffId, status: 'cancelled' });

    const scheduled = await request(app).get(
      `/facilities/${facilityId}/maintenance?status=scheduled`,
    );
    expect(scheduled.body).toHaveLength(1);
    expect(scheduled.body[0].startTime).toBe(SLOT.adjacentStart);

    const unknown = await request(app).get(
      `/facilities/${MISSING_UUID}/maintenance`,
    );
    expect(unknown.status).toBe(404);
  });
});
