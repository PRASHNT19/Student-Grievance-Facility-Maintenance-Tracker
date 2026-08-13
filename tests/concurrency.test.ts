import request from "supertest";
import app from "../src/app"; // adjust path if your app export is elsewhere

describe("Concurrency tests", () => {
  let facilityId: string;
  let ticketId: string;
  const staffA = "staff-a";
  const staffB = "staff-b";

  beforeAll(async () => {
    // Create a facility for testing
    const facilityRes = await request(app).post("/facilities").send({
      name: "Test Lab",
      building: "Main Building",
    });

    expect(facilityRes.status).toBe(201);
    facilityId = facilityRes.body.id;

    // Create a ticket for claim race test
    const ticketRes = await request(app).post("/tickets").send({
      facilityId,
      category: "electrical",
      title: "Initial Power Issue",
      description: "Lights flickering",
      actorId: "student-0",
    });

    expect(ticketRes.status).toBe(201);
    ticketId = ticketRes.body.id;
  });

  it("allows only one active ticket for a facility/category", async () => {
    const requests = Array.from({ length: 10 }, (_, index) =>
      request(app)
        .post("/tickets")
        .send({
          facilityId,
          category: "electrical",
          title: `Power issue ${index}`,
          description: "Electrical problem",
          actorId: `student-${index}`,
        }),
    );

    const responses = await Promise.all(requests);

    const successful = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successful.length).toBe(1);
    expect(conflicts.length).toBe(9);
  });

  it("allows only one staff member to claim a ticket", async () => {
    const responses = await Promise.all([
      request(app).post(`/tickets/${ticketId}/claim`).send({ actorId: staffA }),
      request(app).post(`/tickets/${ticketId}/claim`).send({ actorId: staffB }),
    ]);

    const successful = responses.filter((r) => r.status === 200);
    const rejected = responses.filter((r) => r.status === 409);

    expect(successful.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it("prevents overlapping maintenance windows", async () => {
    const responses = await Promise.all([
      request(app).post(`/facilities/${facilityId}/maintenance`).send({
        startTime: "2026-08-15T10:00:00Z",
        endTime: "2026-08-15T12:00:00Z",
        note: "Electrical work",
        scheduledBy: staffA,
      }),
      request(app).post(`/facilities/${facilityId}/maintenance`).send({
        startTime: "2026-08-15T11:00:00Z",
        endTime: "2026-08-15T13:00:00Z",
        note: "Maintenance work",
        scheduledBy: staffB,
      }),
    ]);

    const successful = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successful.length).toBe(1);
    expect(conflicts.length).toBe(1);
  });

  it("allows adjacent maintenance windows (end equals next start)", async () => {
    const first = await request(app)
      .post(`/facilities/${facilityId}/maintenance`)
      .send({
        startTime: "2026-08-16T10:00:00Z",
        endTime: "2026-08-16T12:00:00Z",
        note: "First window",
        scheduledBy: staffA,
      });

    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/facilities/${facilityId}/maintenance`)
      .send({
        startTime: "2026-08-16T12:00:00Z",
        endTime: "2026-08-16T14:00:00Z",
        note: "Second window",
        scheduledBy: staffB,
      });

    expect(second.status).toBe(201);
  });
});
