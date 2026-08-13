import {
  createMaintenanceWindow,
  getMaintenanceWindows,
  updateMaintenanceWindow,
} from "../data/maintenanceData";
import { MaintenanceConflictError } from "../errors";

export async function createMaintenance(
  facilityId: string,
  startTime: string,
  endTime: string,
  note: string,
  scheduledBy: string,
) {
  if (new Date(startTime) >= new Date(endTime)) {
    throw new Error("startTime must be before endTime");
  }

  if (!note || !note.trim()) {
    throw new Error("Maintenance note is required");
  }

  try {
    return await createMaintenanceWindow(
      facilityId,
      startTime,
      endTime,
      note.trim(),
      scheduledBy,
    );
  } catch (error: any) {
    // PostgreSQL exclusion constraint violation code
    if (error && error.code === "23P01") {
      throw new MaintenanceConflictError();
    }
    throw error;
  }
}

export async function getMaintenance(facilityId: string) {
  return getMaintenanceWindows(facilityId);
}

export async function updateMaintenance(
  id: string,
  startTime: string,
  endTime: string,
  note: string,
) {
  if (new Date(startTime) >= new Date(endTime)) {
    throw new Error("startTime must be before endTime");
  }

  if (!note || !note.trim()) {
    throw new Error("Maintenance note is required");
  }

  try {
    return await updateMaintenanceWindow(id, startTime, endTime, note.trim());
  } catch (error: any) {
    if (error && error.code === "23P01") {
      throw new MaintenanceConflictError();
    }
    throw error;
  }
}
