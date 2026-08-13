import {
  insertMaintenanceWindow,
  findMaintenanceWindowById,
  closeMaintenanceWindow,
  listMaintenanceForFacility,
} from '../data/maintenanceData';
import { requireFacility } from './facilityService';
import { requireStaff } from './actorService';
import { badRequest, conflict, notFound } from '../errors';
import type { MaintenanceStatus, MaintenanceWindow } from '../types';

export interface ScheduleMaintenanceInput {
  facilityId: string;
  actorId: string;
  startTime: Date;
  endTime: Date;
  note?: string;
}

/**
 * Schedules maintenance on a facility.
 *
 * The checks below are referential and range validation. They are deliberately
 * NOT an availability check: nothing here asks whether the facility is already
 * booked for maintenance. Overlap is decided by the `maintenance_no_overlap`
 * exclusion constraint inside insertMaintenanceWindow's single INSERT, so no
 * gap exists between "check" and "insert" for a competing request to slip
 * through.
 */
export async function scheduleMaintenance(
  input: ScheduleMaintenanceInput,
): Promise<MaintenanceWindow> {
  if (input.startTime.getTime() >= input.endTime.getTime()) {
    throw badRequest(
      'INVALID_TIME_RANGE',
      'startTime must be strictly before endTime.',
    );
  }

  await requireStaff(input.actorId);
  await requireFacility(input.facilityId);

  return insertMaintenanceWindow({
    facilityId: input.facilityId,
    scheduledBy: input.actorId,
    startTime: input.startTime,
    endTime: input.endTime,
    note: input.note,
  });
}

export async function getMaintenanceForFacility(
  facilityId: string,
  status?: MaintenanceStatus,
): Promise<MaintenanceWindow[]> {
  await requireFacility(facilityId);
  return listMaintenanceForFacility(facilityId, status);
}

/**
 * Marks a scheduled window completed or cancelled. Either way the period stops
 * being reserved, because the exclusion constraint only covers rows whose
 * status is still 'scheduled'.
 */
export async function closeMaintenance(
  id: string,
  actorId: string,
  nextStatus: Exclude<MaintenanceStatus, 'scheduled'>,
): Promise<MaintenanceWindow> {
  await requireStaff(actorId);

  const closed = await closeMaintenanceWindow(id, nextStatus);
  if (closed) return closed;

  // The UPDATE matched nothing: either the window does not exist, or it was
  // already closed. Distinguish the two so the client gets a useful status.
  const existing = await findMaintenanceWindowById(id);
  if (!existing) {
    throw notFound('MAINTENANCE_NOT_FOUND', 'Maintenance window not found.');
  }
  throw conflict(
    'MAINTENANCE_ALREADY_CLOSED',
    `This maintenance window is already ${existing.status}.`,
  );
}
