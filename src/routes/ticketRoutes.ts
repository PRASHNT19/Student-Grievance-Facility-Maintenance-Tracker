import { Router, Request, Response, NextFunction } from "express";
import * as ticketService from "../services/ticketService";

const router = Router();

// -----------------------------------------------------------------------------
// Add a comment to a ticket
// -----------------------------------------------------------------------------
router.post(
  "/tickets/:id/comments",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticketId = req.params.id;
      const { actorId, note } = req.body as { actorId?: string; note?: string };

      if (!actorId || !note) {
        return res.status(400).json({
          error: "actorId and note are required",
        });
      }

      const comment = await ticketService.commentOnTicket(ticketId, actorId, note);

      return res.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  }
);

// -----------------------------------------------------------------------------
// Register an affected user for a ticket
// -----------------------------------------------------------------------------
router.post(
  "/tickets/:id/affected",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticketId = req.params.id;
      const { actorId } = req.body as { actorId?: string };

      if (!actorId) {
        return res.status(400).json({
          error: "actorId is required",
        });
      }

      const result = await ticketService.registerAffectedUser(ticketId, actorId);

      return res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
