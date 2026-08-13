import { query } from '../src/data/db';
import { insertUser } from '../src/data/userData';
import { insertFacility } from '../src/data/facilityData';
import type { Facility, User } from '../src/types';

/** Wipes all business data between tests. */
export async function resetDatabase(): Promise<void> {
  await query(
    `TRUNCATE ticket_events, ticket_affected_users, maintenance_windows,
              tickets, facilities, users
     RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;
const unique = (): string => `${(counter += 1)}.${Date.now()}`;

export function createStudent(name = 'Test Student'): Promise<User> {
  return insertUser(name, `student${unique()}@campus.example`, 'student');
}

export function createStaff(name = 'Test Staff'): Promise<User> {
  return insertUser(name, `staff${unique()}@campus.example`, 'staff');
}

export function createAdmin(name = 'Test Admin'): Promise<User> {
  return insertUser(name, `admin${unique()}@campus.example`, 'admin');
}

export function createFacility(
  name?: string,
  building = 'Science Block',
): Promise<Facility> {
  return insertFacility(name ?? `Computer Lab ${unique()}`, building);
}

/** A ready-to-post ticket body; override whatever the test cares about. */
export function ticketBody(
  facilityId: string,
  reportedBy: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    facilityId,
    reportedBy,
    category: 'hardware',
    priority: 'high',
    title: 'Projector will not power on',
    description: 'The ceiling projector shows no light when switched on.',
    ...overrides,
  };
}

/** Fixed, unambiguous UTC times so tests never depend on the machine's clock. */
export const SLOT = {
  start: '2026-09-01T09:00:00.000Z',
  end: '2026-09-01T10:00:00.000Z',
  // Overlaps the window above by 30 minutes.
  overlappingStart: '2026-09-01T09:30:00.000Z',
  overlappingEnd: '2026-09-01T10:30:00.000Z',
  // Starts exactly when the first window ends -- must NOT be treated as overlap.
  adjacentStart: '2026-09-01T10:00:00.000Z',
  adjacentEnd: '2026-09-01T11:00:00.000Z',
};

export const MISSING_UUID = '00000000-0000-4000-8000-000000000000';
