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

describe('Ticket workflow', () => {
  let ticketId: string;
  let facilityId: string;
  let studentId: string;
  let staffId: string;
  let otherStaffId: string;

  beforeEach(async () => {
    await resetDatabase();
    facilityId = (await createFacility()).id;
    studentId = (await createStudent()).id;
    staffId = (await createStaff('Sita Gurung')).id;
    otherStaffId = (await createStaff('Ramesh Adhikari')).id;

    const created = await request(app)
      .post('/tickets')
      .send(ticketBody(facilityId, studentId));
    ticketId = created.body.id;
  });

  afterAll(closePool);

  describe('claiming', () => {
    it('assigns the ticket to the claiming staff member', async () => {
      const res = await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: staffId });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: ticketId,
        status: 'assigned',
        assignedTo: staffId,
      });
    });

    it('refuses a student, an unknown actor and an unknown ticket', async () => {
      const student = await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: studentId });
      expect(student.status).toBe(403);
      expect(student.body.error.code).toBe('ACTOR_NOT_STAFF');

      const unknownActor = await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: MISSING_UUID });
      expect(unknownActor.status).toBe(404);
      expect(unknownActor.body.error.code).toBe('ACTOR_NOT_FOUND');

      const unknownTicket = await request(app)
        .post(`/tickets/${MISSING_UUID}/claim`)
        .send({ actorId: staffId });
      expect(unknownTicket.status).toBe(404);
      expect(unknownTicket.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('refuses a second claim on an already-claimed ticket', async () => {
      await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: staffId });

      const second = await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: otherStaffId });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('TICKET_ALREADY_CLAIMED');
      expect(second.body.error.details.assignedTo).toBe(staffId);
    });

    it('makes a released ticket claimable again', async () => {
      await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: staffId });

      const released = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'open', note: 'Handing this back' });
      expect(released.status).toBe(200);
      // Going back to 'open' must clear the assignee, or the ticket would be
      // unclaimable forever.
      expect(released.body.assignedTo).toBeNull();

      const reclaimed = await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: otherStaffId });
      expect(reclaimed.status).toBe(200);
      expect(reclaimed.body.assignedTo).toBe(otherStaffId);
    });
  });

  describe('status transitions', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: staffId });
    });

    it('runs the full happy path and stamps resolvedAt', async () => {
      const inProgress = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'in_progress' });
      expect(inProgress.status).toBe(200);
      expect(inProgress.body.resolvedAt).toBeNull();

      const resolved = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'resolved', note: 'Replaced the lamp' });
      expect(resolved.status).toBe(200);
      expect(resolved.body.resolvedAt).not.toBeNull();

      const closed = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'closed' });
      expect(closed.status).toBe(200);
      // Closing keeps the original resolution time rather than re-stamping it.
      expect(closed.body.resolvedAt).toBe(resolved.body.resolvedAt);
    });

    it('rejects an illegal transition and reports the legal ones', async () => {
      const res = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'closed' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.details).toMatchObject({
        from: 'assigned',
        to: 'closed',
        allowed: ['in_progress', 'open', 'rejected'],
      });
    });

    it('treats closed as terminal', async () => {
      for (const status of ['in_progress', 'resolved', 'closed']) {
        await request(app)
          .patch(`/tickets/${ticketId}/status`)
          .send({ actorId: staffId, status });
      }

      const res = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'in_progress' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.details.allowed).toEqual([]);
    });

    it('clears resolvedAt when a resolved ticket is reopened', async () => {
      await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'in_progress' });
      await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'resolved' });

      const reopened = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'in_progress', note: 'Still broken' });

      expect(reopened.status).toBe(200);
      expect(reopened.body.resolvedAt).toBeNull();
      expect(reopened.body.assignedTo).toBe(staffId);
    });

    it('refuses to reopen when a newer ticket now covers the same issue', async () => {
      await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'in_progress' });
      await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'resolved' });

      // The slot is free again, so a new ticket takes it.
      const newer = await request(app)
        .post('/tickets')
        .send(ticketBody(facilityId, studentId, { title: 'Broken again' }));
      expect(newer.status).toBe(201);

      // Reopening the old one would put two active tickets on the same issue.
      const reopen = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'in_progress' });

      expect(reopen.status).toBe(409);
      expect(reopen.body.error.code).toBe('ACTIVE_TICKET_EXISTS');
    });

    it('refuses a status change from a student', async () => {
      const res = await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: studentId, status: 'in_progress' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACTOR_NOT_STAFF');
    });
  });

  describe('audit trail', () => {
    it('records every action in order on GET /tickets/:id', async () => {
      await request(app)
        .post(`/tickets/${ticketId}/claim`)
        .send({ actorId: staffId });
      await request(app)
        .patch(`/tickets/${ticketId}/status`)
        .send({ actorId: staffId, status: 'in_progress' });

      const comment = await request(app)
        .post(`/tickets/${ticketId}/comments`)
        .send({ actorId: studentId, note: 'Thanks, it is urgent before the exam.' });
      expect(comment.status).toBe(201);
      expect(comment.body).toMatchObject({
        ticketId,
        actorId: studentId,
        eventType: 'comment',
        note: 'Thanks, it is urgent before the exam.',
      });

      const detail = await request(app).get(`/tickets/${ticketId}`);

      expect(detail.status).toBe(200);
      expect(detail.body.timeline.map((e: { eventType: string }) => e.eventType)).toEqual(
        ['reported', 'claimed', 'status_changed', 'comment'],
      );
      expect(detail.body.timeline[1]).toMatchObject({
        actorId: staffId,
        fromStatus: 'open',
        toStatus: 'assigned',
      });
    });

    it('rejects an empty comment and an unknown ticket', async () => {
      const empty = await request(app)
        .post(`/tickets/${ticketId}/comments`)
        .send({ actorId: studentId, note: '   ' });
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION_ERROR');

      const unknown = await request(app)
        .post(`/tickets/${MISSING_UUID}/comments`)
        .send({ actorId: studentId, note: 'Hello' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    it('returns 400 for a malformed ticket id', async () => {
      const res = await request(app).get('/tickets/123');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
