import {
  insertFacility,
  listFacilities,
  findFacilityById,
} from '../data/facilityData';
import { requireStaff } from './actorService';
import { notFound } from '../errors';
import type { Facility } from '../types';

export interface CreateFacilityInput {
  actorId: string;
  name: string;
  building: string;
}

/** Registering campus facilities is an estates/staff task, not a student one. */
export async function createFacility(
  input: CreateFacilityInput,
): Promise<Facility> {
  await requireStaff(input.actorId);
  return insertFacility(input.name.trim(), input.building.trim());
}

export function getFacilities(building?: string): Promise<Facility[]> {
  return listFacilities(building?.trim());
}

/**
 * Referential check shared by every endpoint nested under a facility, so the
 * client gets a 404 rather than an empty list for an id that does not exist.
 */
export async function requireFacility(id: string): Promise<Facility> {
  const facility = await findFacilityById(id);
  if (!facility) {
    throw notFound('FACILITY_NOT_FOUND', 'Facility not found.');
  }
  return facility;
}
