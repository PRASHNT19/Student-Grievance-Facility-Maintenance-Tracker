import { Router, type Request, type Response, type NextFunction } from 'express';
import { closeMaintenance } from '../services/maintenanceService';
import {
  closeMaintenanceSchema,
  uuidSchema,
  parseOrThrow,
} from '../validation';

export const maintenanceRouter = Router();

/**
 * @openapi
 * /maintenance/{id}:
 *   patch:
 *     summary: Complete or cancel a maintenance window
 *     description: >
 *       Sets the window's status to `completed` or `cancelled`. The row is kept
 *       for auditing. Because the exclusion constraint only applies to windows
 *       that are still `scheduled`, the freed period immediately becomes
 *       available again. A window cannot be moved back to `scheduled`.
 *     tags: [Maintenance]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [actorId, status]
 *             properties:
 *               actorId: { type: string, format: uuid, description: A staff or admin user id }
 *               status: { type: string, enum: [completed, cancelled] }
 *     responses:
 *       200:
 *         description: The closed maintenance window
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MaintenanceWindow' }
 *       400:
 *         description: Invalid id or body
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: The actor is not staff (ACTOR_NOT_STAFF)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Maintenance window or acting user not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: The window is already completed or cancelled
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
maintenanceRouter.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuidSchema, req.params.id);
      const { actorId, status } = parseOrThrow(closeMaintenanceSchema, req.body);
      res.status(200).json(await closeMaintenance(id, actorId, status));
    } catch (err) {
      next(err);
    }
  },
);
