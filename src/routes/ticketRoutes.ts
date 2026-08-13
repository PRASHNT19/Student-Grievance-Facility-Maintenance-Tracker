import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  reportIssue,
  getTickets,
  getTicketDetail,
  claimTicketForStaff,
  updateTicketStatus,
  commentOnTicket,
  registerAffected,
} from '../services/ticketService';
import {
  createTicketSchema,
  ticketFilterSchema,
  claimTicketSchema,
  updateTicketStatusSchema,
  addCommentSchema,
  markAffectedSchema,
  uuidSchema,
  parseOrThrow,
} from '../validation';

export const ticketRouter = Router();

/**
 * @openapi
 * /tickets:
 *   post:
 *     summary: Report a campus issue
 *     description: >
 *       Creates an open ticket against a facility. At most one unresolved
 *       ticket may exist per facility and category: the duplicate is rejected
 *       by a PostgreSQL partial unique index, not by an application-level
 *       lookup, so two students reporting the same broken projector at the same
 *       instant produce exactly one ticket. The 409 body names the existing
 *       ticket so the second reporter can register on it via
 *       `POST /tickets/{id}/affected`.
 *     tags: [Tickets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [facilityId, reportedBy, category, title, description]
 *             properties:
 *               facilityId: { type: string, format: uuid }
 *               reportedBy:
 *                 type: string
 *                 format: uuid
 *                 description: The reporting user (use a seeded id)
 *               category:
 *                 type: string
 *                 enum: [hardware, electrical, plumbing, network, furniture, cleanliness, safety, other]
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, critical]
 *                 default: medium
 *               title: { type: string, minLength: 1, maxLength: 200, example: Projector will not power on }
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *                 example: The ceiling projector in Lab 301 shows no light when switched on.
 *     responses:
 *       201:
 *         description: Ticket created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ticket' }
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Facility or reporting user not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: >
 *           DUPLICATE_TICKET -- an unresolved ticket already covers this
 *           facility and category. `details` names it.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
ticketRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parseOrThrow(createTicketSchema, req.body);
      res.status(201).json(await reportIssue(input));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /tickets:
 *   get:
 *     summary: List and filter tickets
 *     description: The staff queue. All filters are optional and combine with AND.
 *     tags: [Tickets]
 *     parameters:
 *       - in: query
 *         name: facilityId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, assigned, in_progress, resolved, closed, rejected]
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [low, medium, high, critical] }
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [hardware, electrical, plumbing, network, furniture, cleanliness, safety, other]
 *       - in: query
 *         name: reportedBy
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string, format: uuid }
 *         description: "What is on my plate?" for a staff member
 *     responses:
 *       200:
 *         description: Matching tickets, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Ticket' }
 *       400:
 *         description: Invalid filter value
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
ticketRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = parseOrThrow(ticketFilterSchema, req.query);
      res.status(200).json(await getTickets(filters));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /tickets/{id}:
 *   get:
 *     summary: Get one ticket with its full audit trail
 *     description: >
 *       Returns the ticket plus `timeline`, the append-only record of who
 *       reported, claimed, commented on and re-statused it.
 *     tags: [Tickets]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The ticket and its timeline
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TicketDetail' }
 *       400:
 *         description: Invalid ticket id
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Ticket not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
ticketRouter.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuidSchema, req.params.id);
      res.status(200).json(await getTicketDetail(id));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /tickets/{id}/claim:
 *   post:
 *     summary: Claim an open ticket
 *     description: >
 *       Assigns the ticket to the acting staff member and moves it to
 *       `assigned`. The assignment is made by a single guarded UPDATE, so two
 *       staff members claiming at the same instant produce exactly one 200 and
 *       one 409 -- no ticket can acquire two owners.
 *     tags: [Tickets]
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
 *             required: [actorId]
 *             properties:
 *               actorId: { type: string, format: uuid, description: A staff or admin user id }
 *     responses:
 *       200:
 *         description: The claimed ticket
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ticket' }
 *       400:
 *         description: Invalid ticket id or body
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: The actor is not staff (ACTOR_NOT_STAFF)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Ticket or acting user not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: >
 *           TICKET_ALREADY_CLAIMED -- another staff member got there first; or
 *           TICKET_NOT_OPEN if the ticket has moved on
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
ticketRouter.post(
  '/:id/claim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuidSchema, req.params.id);
      const { actorId } = parseOrThrow(claimTicketSchema, req.body);
      res.status(200).json(await claimTicketForStaff(id, actorId));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /tickets/{id}/status:
 *   patch:
 *     summary: Move a ticket through its lifecycle
 *     description: |
 *       Staff only. Legal transitions:
 *
 *       * `open` → `rejected`
 *       * `assigned` → `in_progress`, `open` (release), `rejected`
 *       * `in_progress` → `resolved`, `assigned`
 *       * `resolved` → `closed`, `in_progress` (reopen)
 *       * `closed` and `rejected` are terminal
 *
 *       `open` → `assigned` is not listed because a ticket becomes assigned
 *       only through `POST /tickets/{id}/claim`, which sets the assignee in the
 *       same statement.
 *
 *       The write is conditional on the status the server just read, so a
 *       transition decided against stale data is refused with 409 rather than
 *       applied.
 *     tags: [Tickets]
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
 *               status:
 *                 type: string
 *                 enum: [open, assigned, in_progress, resolved, closed, rejected]
 *               note: { type: string, maxLength: 2000, example: Replaced the projector lamp }
 *     responses:
 *       200:
 *         description: The updated ticket
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ticket' }
 *       400:
 *         description: Invalid ticket id or body
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: The actor is not staff (ACTOR_NOT_STAFF)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Ticket or acting user not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: >
 *           INVALID_TRANSITION (with the legal targets in `details`),
 *           TICKET_STATUS_CHANGED if a competing request moved it first, or
 *           ACTIVE_TICKET_EXISTS if reopening would collide with a newer ticket
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
ticketRouter.patch(
  '/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuidSchema, req.params.id);
      const { actorId, status, note } = parseOrThrow(
        updateTicketStatusSchema,
        req.body,
      );
      res.status(200).json(await updateTicketStatus(id, actorId, status, note));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /tickets/{id}/comments:
 *   post:
 *     summary: Comment on a ticket
 *     description: >
 *       Appends a comment to the ticket's audit trail. Open to students and
 *       staff alike, so a reporter can add detail after filing.
 *     tags: [Tickets]
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
 *             required: [actorId, note]
 *             properties:
 *               actorId: { type: string, format: uuid }
 *               note: { type: string, minLength: 1, maxLength: 2000 }
 *     responses:
 *       201:
 *         description: The created timeline entry
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TicketEvent' }
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Ticket or acting user not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
ticketRouter.post(
  '/:id/comments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuidSchema, req.params.id);
      const { actorId, note } = parseOrThrow(addCommentSchema, req.body);
      res.status(201).json(await commentOnTicket(id, actorId, note));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /tickets/{id}/affected:
 *   post:
 *     summary: Register as also affected by this issue ("me too")
 *     description: >
 *       The other half of duplicate suppression. Because the database refuses a
 *       second unresolved ticket for the same facility and category, students
 *       who would have filed one register here instead and the scale of the
 *       problem is still recorded in `affectedCount`. A primary key on
 *       (ticket, user) makes double counting impossible.
 *     tags: [Tickets]
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
 *             required: [userId]
 *             properties:
 *               userId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The ticket with its updated affectedCount
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ticket' }
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Ticket or user not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: >
 *           ALREADY_AFFECTED if the user is already registered, or
 *           TICKET_NOT_ACTIVE if the ticket is already finished
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
ticketRouter.post(
  '/:id/affected',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseOrThrow(uuidSchema, req.params.id);
      const { userId } = parseOrThrow(markAffectedSchema, req.body);
      res.status(200).json(await registerAffected(id, userId));
    } catch (err) {
      next(err);
    }
  },
);
