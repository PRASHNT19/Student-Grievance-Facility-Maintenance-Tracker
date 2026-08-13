import { z } from 'zod';
import { badRequest } from './errors';

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'must be a valid ISO-8601 date-time string',
  })
  .transform((v) => new Date(v));

export const uuidSchema = z.string().uuid('must be a valid UUID');

const shortText = (max: number) => z.string().trim().min(1, 'is required').max(max);

// ---------------------------------------------------------------------------
// Enumerations -- kept in one place so routes, filters and Swagger agree.
// ---------------------------------------------------------------------------

export const ticketStatusSchema = z.enum([
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
]);

export const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const issueCategorySchema = z.enum([
  'hardware',
  'electrical',
  'plumbing',
  'network',
  'furniture',
  'cleanliness',
  'safety',
  'other',
]);

export const maintenanceStatusSchema = z.enum([
  'scheduled',
  'completed',
  'cancelled',
]);

/**
 * There is no authentication layer in this project, so the caller states who is
 * acting. A real deployment would derive this from a verified session instead
 * of trusting the request body -- see the Limitations section of the README.
 */
const actorId = uuidSchema;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const createFacilitySchema = z.object({
  actorId,
  name: shortText(200),
  building: shortText(200),
});

export const createTicketSchema = z.object({
  facilityId: uuidSchema,
  reportedBy: uuidSchema,
  category: issueCategorySchema,
  priority: ticketPrioritySchema.default('medium'),
  title: shortText(200),
  description: shortText(4000),
});

export const claimTicketSchema = z.object({
  actorId,
});

export const updateTicketStatusSchema = z.object({
  actorId,
  status: ticketStatusSchema,
  note: z.string().trim().max(2000).optional(),
});

export const addCommentSchema = z.object({
  actorId,
  note: shortText(2000),
});

export const markAffectedSchema = z.object({
  userId: uuidSchema,
});

export const scheduleMaintenanceSchema = z.object({
  actorId,
  startTime: isoDate,
  endTime: isoDate,
  note: z.string().trim().max(2000).optional(),
});

/**
 * A window may only be closed, never reopened -- 'scheduled' is deliberately
 * absent, so the exclusion constraint can never be re-armed on a stale row.
 */
export const closeMaintenanceSchema = z.object({
  actorId,
  status: z.enum(['completed', 'cancelled']),
});

// ---------------------------------------------------------------------------
// Query strings
// ---------------------------------------------------------------------------

export const ticketFilterSchema = z.object({
  facilityId: uuidSchema.optional(),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  category: issueCategorySchema.optional(),
  reportedBy: uuidSchema.optional(),
  assignedTo: uuidSchema.optional(),
});

export const facilityTicketFilterSchema = z.object({
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  category: issueCategorySchema.optional(),
});

export const facilityFilterSchema = z.object({
  building: z.string().trim().min(1).max(200).optional(),
});

export const maintenanceFilterSchema = z.object({
  status: maintenanceStatusSchema.optional(),
});

/**
 * Runs a zod schema and converts a failure into a 400 AppError, so routes stay
 * free of error-shaping code and the error handler has a single error type.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }));
  throw badRequest('VALIDATION_ERROR', 'Request validation failed.', details);
}
