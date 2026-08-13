import { Router, Request, Response, NextFunction } from "express";
import * as ticketService from "../services/ticketService";

const router = Router();

// Create ticket (simple example)
router.post(
  "/tickets",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { facilityId, category, title, description, actorId } =
        req.body as {
          facilityId?: string;
          category?: string;
          title?: string;
          description?: string;
          actorId?: string;
        };

      if (!facilityId || !category || !title || !description || !actorId) {
        return res.status(400).json({
          error:
            "facilityId, category, title, description and actorId are required",
        });
      }

      const ticket = await ticketService.createTicket(
        facilityId,
        category,
        title,
        description,
        actorId,
      );

      return res.status(201).json(ticket);
    } catch (error) {
      next(error);
    }
  },
);

// Claim ticket
router.post(
  "/tickets/:id/claim",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticketId = req.params.id;
      const { actorId } = req.body as { actorId?: string };

      if (!actorId) {
        return res.status(400).json({ error: "actorId is required" });
      }

      const result = await ticketService.claimTicket(ticketId, actorId);

      if (!result) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      return res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// Add comment to ticket
router.post(
  "/tickets/:id/comments",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticketId = req.params.id;
      const { actorId, note } = req.body as { actorId?: string; note?: string };

      if (!actorId || !note) {
        return res.status(400).json({ error: "actorId and note are required" });
      }

      const comment = await ticketService.commentOnTicket(
        ticketId,
        actorId,
        note,
      );

      return res.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  },
);

// Register affected user
router.post(
  "/tickets/:id/affected",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticketId = req.params.id;
      const { actorId } = req.body as { actorId?: string };

      if (!actorId) {
        return res.status(400).json({ error: "actorId is required" });
      }

      const result = await ticketService.registerAffectedUser(
        ticketId,
        actorId,
      );

      return res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
