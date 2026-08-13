import request from 'supertest';
import { app } from '../src/app';
import { closePool } from '../src/data/db';
import {
  resetDatabase,
  createStudent,
  createStaff,
  MISSING_UUID,
} from './helpers';

describe('Facilities', () => {
  let staffId: string;
  let studentId: string;

  beforeEach(async () => {
    await resetDatabase();
    staffId = (await createStaff()).id;
    studentId = (await createStudent()).id;
  });

  afterAll(closePool);

  it('registers a facility and returns it from the list', async () => {
    const created = await request(app).post('/facilities').send({
      actorId: staffId,
      name: 'Computer Lab 301',
      building: 'Science Block',
    });

    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name: 'Computer Lab 301',
      building: 'Science Block',
    });

    const list = await request(app).get('/facilities');

    expect(list.status).toBe(200);
    expect(list.body).toEqual([created.body]);
  });

  it('refuses to let a student register a facility', async () => {
    const res = await request(app).post('/facilities').send({
      actorId: studentId,
      name: 'Computer Lab 301',
      building: 'Science Block',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACTOR_NOT_STAFF');
  });

  it('returns 404 for an unknown actor and 400 for a missing name', async () => {
    const unknownActor = await request(app).post('/facilities').send({
      actorId: MISSING_UUID,
      name: 'Computer Lab 301',
      building: 'Science Block',
    });
    expect(unknownActor.status).toBe(404);
    expect(unknownActor.body.error.code).toBe('ACTOR_NOT_FOUND');

    const noName = await request(app)
      .post('/facilities')
      .send({ actorId: staffId, building: 'Science Block' });
    expect(noName.status).toBe(400);
    expect(noName.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('identifies a facility by (building, name), not by name alone', async () => {
    const body = { actorId: staffId, name: 'Room 101' };

    const first = await request(app)
      .post('/facilities')
      .send({ ...body, building: 'Science Block' });
    expect(first.status).toBe(201);

    // Same name, different building -- a genuinely different room.
    const otherBuilding = await request(app)
      .post('/facilities')
      .send({ ...body, building: 'Hostel Block B' });
    expect(otherBuilding.status).toBe(201);

    // Same name, same building -- the duplicate.
    const duplicate = await request(app)
      .post('/facilities')
      .send({ ...body, building: 'Science Block' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('FACILITY_EXISTS');
  });

  it('filters the list by building', async () => {
    await request(app)
      .post('/facilities')
      .send({ actorId: staffId, name: 'Lecture Hall 12', building: 'Science Block' });
    await request(app)
      .post('/facilities')
      .send({ actorId: staffId, name: 'Common Room', building: 'Hostel Block B' });

    const res = await request(app).get('/facilities?building=Hostel Block B');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Common Room');
  });
});
