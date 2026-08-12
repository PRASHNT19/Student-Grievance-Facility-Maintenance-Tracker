import { Router, Response } from "express";
import {
  createGrievance,
  findGrievanceById,
  findGrievancesByStudent,
  findAllGrievances,
  updateGrievanceStatus,
} from "../data/grievances";
import {
  AuthenticatedRequest,
  requireAuth,
  requireRole,
} from "../middleware/auth";
import { GrievanceStatus } from "../types/grievance";

const router = Router();

router.post(
  "/",
  requireAuth,
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    try {
      const {
        title,
        description,
        category,
        location,
      } = req.body;

      if (
        typeof title !== "string" ||
        typeof description !== "string" ||
        typeof category !== "string"
      ) {
        res.status(400).json({
          error:
            "title, description and category are required",
        });
        return;
      }

      if (title.trim().length < 3) {
        res.status(400).json({
          error: "Title must contain at least 3 characters",
        });
        return;
      }

      if (description.trim().length < 10) {
        res.status(400).json({
          error:
            "Description must contain at least 10 characters",
        });
        return;
      }

      const grievance = await createGrievance({
        studentId: req.user!.id,
        title,
        description,
        category,
        location,
      });

      res.status(201).json({
        grievance,
      });
    } catch (error) {
      console.error("Creating grievance failed:", error);

      res.status(500).json({
        error: "Unable to create grievance",
      });
    }
  }
);

router.get(
  "/mine",
  requireAuth,
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    try {
      const grievances =
        await findGrievancesByStudent(req.user!.id);

      res.json({
        grievances,
      });
    } catch (error) {
      console.error(
        "Fetching student grievances failed:",
        error
      );

      res.status(500).json({
        error: "Unable to fetch grievances",
      });
    }
  }
);

router.get(
  "/:id",
  requireAuth,
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    try {
      const grievance =
        await findGrievanceById(req.params.id);

      if (!grievance) {
        res.status(404).json({
          error: "Grievance not found",
        });
        return;
      }

      const isOwner =
        grievance.studentId === req.user!.id;

      const isStaff =
        req.user!.role === "staff" ||
        req.user!.role === "admin";

      if (!isOwner && !isStaff) {
        res.status(403).json({
          error: "You cannot access this grievance",
        });
        return;
      }

      res.json({
        grievance,
      });
    } catch (error) {
      console.error(
        "Fetching grievance failed:",
        error
      );

      res.status(500).json({
        error: "Unable to fetch grievance",
      });
    }
  }
);

router.get(
  "/",
  requireAuth,
  requireRole("staff", "admin"),
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const grievances = await findAllGrievances();

      res.json({
        grievances,
      });
    } catch (error) {
      console.error(
        "Fetching all grievances failed:",
        error
      );

      res.status(500).json({
        error: "Unable to fetch grievances",
      });
    }
  }
);

router.patch(
  "/:id/status",
  requireAuth,
  requireRole("staff", "admin"),
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    try {
      const { status } = req.body;

      const allowedStatuses: GrievanceStatus[] = [
        "OPEN",
        "IN_PROGRESS",
        "RESOLVED",
        "REJECTED",
      ];

      if (!allowedStatuses.includes(status)) {
        res.status(400).json({
          error: "Invalid grievance status",
        });
        return;
      }

      const grievance =
        await updateGrievanceStatus(
          req.params.id,
          status
        );

      if (!grievance) {
        res.status(404).json({
          error: "Grievance not found",
        });
        return;
      }

      res.json({
        grievance,
      });
    } catch (error) {
      console.error(
        "Updating grievance status failed:",
        error
      );

      res.status(500).json({
        error: "Unable to update grievance",
      });
    }
  }
);

export default router;