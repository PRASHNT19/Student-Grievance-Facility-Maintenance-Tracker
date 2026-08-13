import { Router, Request, Response, NextFunction } from "express";
import * as maintenanceService from "../services/maintenanceService";

const router = Router();

// Create maintenance window
router.post(
  "/facilities/:id/maintenance",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facilityId = req.params.id;
      const { startTime, endTime, note, scheduledBy } = req.body as {
        startTime?: string;
        endTime?: string;
        note?: string;
        scheduledBy?: string;
      };

      if (!startTime || !endTime || !note || !scheduledBy) {
        return res.status(400).json({
          error: "startTime, endTime, note and scheduledBy are required",
        });
      }

      const maintenance = await maintenanceService.createMaintenance(
        facilityId,
        startTime,
        endTime,
        note,
        scheduledBy,
      );

      return res.status(201).json({ maintenance });
    } catch (error) {
      next(error);
    }
  },
);

// List maintenance windows for a facility
router.get(
  "/facilities/:id/maintenance",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const maintenance = await maintenanceService.getMaintenance(
        req.params.id,
      );
      return res.json({ maintenance });
    } catch (error) {
      next(error);
    }
  },
);

// Update maintenance window
router.patch(
  "/maintenance/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startTime, endTime, note } = req.body as {
        startTime?: string;
        endTime?: string;
        note?: string;
      };

      if (!startTime || !endTime || !note) {
        return res.status(400).json({
          error: "startTime, endTime and note are required",
        });
      }

      const maintenance = await maintenanceService.updateMaintenance(
        req.params.id,
        startTime,
        endTime,
        note,
      );

      if (!maintenance) {
        return res.status(404).json({ error: "Maintenance window not found" });
      }

      return res.json({ maintenance });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
