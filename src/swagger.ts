import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

const TICKET_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
];

const ISSUE_CATEGORIES = [
  'hardware',
  'electrical',
  'plumbing',
  'network',
  'furniture',
  'cleanliness',
  'safety',
  'other',
];

const ticketProperties = {
  id: { type: 'string', format: 'uuid' },
  facilityId: { type: 'string', format: 'uuid' },
  reportedBy: { type: 'string', format: 'uuid' },
  assignedTo: {
    type: 'string',
    format: 'uuid',
    nullable: true,
    description: 'The staff member who claimed the ticket; null while open',
  },
  category: { type: 'string', enum: ISSUE_CATEGORIES },
  priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  title: { type: 'string', example: 'Projector will not power on' },
  description: { type: 'string' },
  status: { type: 'string', enum: TICKET_STATUSES },
  affectedCount: {
    type: 'integer',
    description: 'How many people have registered as affected, reporter included',
    example: 12,
  },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
  resolvedAt: { type: 'string', format: 'date-time', nullable: true },
};

const ticketEventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    ticketId: { type: 'string', format: 'uuid' },
    actorId: { type: 'string', format: 'uuid', nullable: true },
    eventType: {
      type: 'string',
      enum: ['reported', 'claimed', 'status_changed', 'comment'],
    },
    fromStatus: { type: 'string', enum: TICKET_STATUSES, nullable: true },
    toStatus: { type: 'string', enum: TICKET_STATUSES, nullable: true },
    note: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

/**
 * The spec is generated from the @openapi comments that sit directly above the
 * route handlers, so there is no separate hand-maintained specification file to
 * keep in sync. Both .ts (ts-node / tests) and .js (compiled dist) are scanned
 * so Swagger works in development and in the Docker image.
 */
export const openApiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Student Grievance & Facility Maintenance Tracker API',
      version: '1.0.0',
      description:
        'Ticketing API for campus issues -- broken lab hardware, projector ' +
        'faults, water and electricity problems. Three integrity rules are ' +
        'enforced by PostgreSQL rather than by application code: at most one ' +
        'unresolved ticket per facility and category, at most one assignee per ' +
        'ticket, and no overlapping maintenance windows on a facility.',
    },
    tags: [
      { name: 'Facilities', description: 'Rooms, labs and equipment on campus' },
      { name: 'Tickets', description: 'Reporting and resolving campus issues' },
      { name: 'Maintenance', description: 'Scheduled downtime on a facility' },
      { name: 'System', description: 'Operational endpoints' },
    ],
    components: {
      schemas: {
        Facility: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Computer Lab 301' },
            building: { type: 'string', example: 'Science Block' },
          },
        },
        Ticket: {
          type: 'object',
          properties: ticketProperties,
        },
        TicketDetail: {
          type: 'object',
          description: 'A ticket together with its append-only audit trail.',
          properties: {
            ...ticketProperties,
            timeline: { type: 'array', items: ticketEventSchema },
          },
        },
        TicketEvent: ticketEventSchema,
        MaintenanceWindow: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            facilityId: { type: 'string', format: 'uuid' },
            scheduledBy: { type: 'string', format: 'uuid' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            note: { type: 'string', nullable: true },
            status: {
              type: 'string',
              enum: ['scheduled', 'completed', 'cancelled'],
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'DUPLICATE_TICKET' },
                message: {
                  type: 'string',
                  example:
                    'An unresolved ticket for this facility and category already exists.',
                },
                details: {
                  description:
                    'Field-level validation problems, or context for a conflict ' +
                    '(for example the id of the ticket that already exists).',
                  oneOf: [
                    {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          field: { type: 'string' },
                          message: { type: 'string' },
                        },
                      },
                    },
                    { type: 'object' },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [
    path.join(__dirname, 'routes', '*.ts'),
    path.join(__dirname, 'routes', '*.js'),
    path.join(__dirname, 'app.ts'),
    path.join(__dirname, 'app.js'),
  ],
});
