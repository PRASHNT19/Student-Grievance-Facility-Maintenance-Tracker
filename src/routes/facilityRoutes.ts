import { Router, type Request, type Response, type NextFunction } from 'express';
import { createFacility, getFacilities } from '../services/facilityService';
import { getTicketsForFacility } from '../services/ticketService';
import {
  scheduleMaintenance,
  getMaintenanceForFacility,
} from '../services/maintenanceService';
import {
  createFacilitySchema,
  facilityFilterSchema,
  facilityTicketFilterSchema,
  maintenanceFilterSchema,
  scheduleMaintenanceSchema,
  uuidSchema,
  parseOrThrow,
} from '../validation';

export const facilityRouter = Router();

/**
 * @openapi
 * /facilities:
 *   post:
 *     summary: Register a campus facility
 *     description: >
 *       Registers a room, lab, or piece of equipment that issues can be
 *       reported against. Staff only. A facility is identified by the pair
 *       (building, name), so "Room 101" may exist in more than one building.
 *     tags: [Facilities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [actorId, name, building]
 *             properties:
 *               actorId:
 *                 type: string
 *                 format: uuid
 *                 description: A staff or admin user id
 *               name: { type: string, minLength: 1, maxLength: 200, example: Computer Lab 301 }
 *               building: { type: string, minLength: 1, maxLength: 200, example: Science Block }
 *     responses:
 *       201:
 *         description: Facility registered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Facility' }
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: The actor is not staff (ACTOR_NOT_STAFF)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: The acting user does not exist
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: That facility already exists in that building
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
facilityRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parseOrThrow(createFacilitySchema, req.body);
      res.status(201).json(await createFacility(input));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /facilities:
 *   get:
 *     summary: List facilities
 *     tags: [Facilities]
 *     parameters:
 *       - in: query
 *         name: building
 *         required: false
 *         schema: { type: string }
 *         description: Optional filter; omit to return every facility
 *     responses:
 *       200:
 *         description: Facilities, ordered by building then name
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Facility' }
 *       400:
 *         description: Invalid filter
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
facilityRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { building } = parseOrThrow(facilityFilterSchema, req.query);
      res.status(200).json(await getFacilities(building));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /facilities/{id}/tickets:
 *   get:
 *     summary: List the tickets reported against one facility
 *     tags: [Facilities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [open, assigned, in_progress, resolved, closed, rejected]
 *       - in: query
 *         name: priority
 *         required: false
 *         schema: { type: string, enum: [low, medium, high, critical] }
 *       - in: query
 *         name: category
 *         required: false
 *         schema:
 *           type: string
 *           enum: [hardware, electrical, plumbing, network, furniture, cleanliness, safety, other]
 *     responses:
 *       200:
 *         description: Tickets for the facility, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Ticket' }
 *       400:
 *         description: Invalid facility id or filter
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Facility not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
facilityRouter.get(
  '/:id/tickets',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facilityId = parseOrThrow(uuidSchema, req.params.id);
      const filters = parseOrThrow(facilityTicketFilterSchema, req.query);
      res.status(200).json(await getTicketsForFacility(facilityId, filters));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /facilities/{id}/maintenance:
 *   post:
 *     summary: Schedule a maintenance window on a facility
 *     description: >
 *       Reserves a period during which the facility is out of service. Overlap
 *       is rejected by a PostgreSQL exclusion constraint, not by an
 *       application-level availability check, so two simultaneous requests for
 *       the same period can never both succeed -- exactly one receives 201 and
 *       the other receives 409.
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Facility id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [actorId, startTime, endTime]
 *             properties:
 *               actorId:
 *                 type: string
 *                 format: uuid
 *                 description: A staff or admin user id
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-09-01T09:00:00.000Z'
 *               endTime:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-09-01T10:00:00.000Z'
 *               note: { type: string, maxLength: 2000, example: Replacing the projector lamp }
 *     responses:
 *       201:
 *         description: Maintenance window scheduled
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MaintenanceWindow' }
 *       400:
 *         description: Validation failed, or startTime is not before endTime
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: The actor is not staff (ACTOR_NOT_STAFF)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Facility or acting user not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: >
 *           MAINTENANCE_CONFLICT -- the exclusion constraint rejected an overlap
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
facilityRouter.post(
  '/:id/maintenance',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facilityId = parseOrThrow(uuidSchema, req.params.id);
      const body = parseOrThrow(scheduleMaintenanceSchema, req.body);
      res.status(201).json(await scheduleMaintenance({ facilityId, ...body }));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /facilities/{id}/maintenance:
 *   get:
 *     summary: List the maintenance windows of one facility
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         required: false
 *         schema: { type: string, enum: [scheduled, completed, cancelled] }
 *         description: Optional filter; omit to return every window
 *     responses:
 *       200:
 *         description: Maintenance windows, ordered by start time
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/MaintenanceWindow' }
 *       400:
 *         description: Invalid facility id or status filter
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Facility not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
facilityRouter.get(
  '/:id/maintenance',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facilityId = parseOrThrow(uuidSchema, req.params.id);
      const { status } = parseOrThrow(maintenanceFilterSchema, req.query);
      res.status(200).json(await getMaintenanceForFacility(facilityId, status));
    } catch (err) {
      next(err);
    }
  },
);
