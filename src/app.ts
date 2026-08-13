import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import swaggerUi from 'swagger-ui-express';
import { facilityRouter } from './routes/facilityRoutes';
import { ticketRouter } from './routes/ticketRoutes';
import { maintenanceRouter } from './routes/maintenanceRoutes';
import { openApiSpec } from './swagger';
import { AppError } from './errors';
import { config } from './config';

export const app = express();

app.use(express.json());

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Liveness probe
 *     description: >
 *       Not one of the business endpoints. It exists because the Docker Compose
 *       healthcheck and the CI workflow need a way to wait until the server is
 *       actually accepting requests before running anything against it.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: The service is up
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/facilities', facilityRouter);
app.use('/tickets', ticketRouter);
app.use('/maintenance', maintenanceRouter);

// Swagger UI plus the raw generated spec.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.status(200).json(openApiSpec);
});

// Unknown route.
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
  });
});

/**
 * Central error handler. Only AppError instances describe themselves to the
 * client; anything else (including raw PostgreSQL errors) is logged server-side
 * and reported as a generic 500, so database internals are never exposed.
 */
app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }

    // Malformed JSON body -- express.json() throws a SyntaxError with a status.
    if (
      err instanceof SyntaxError &&
      'status' in err &&
      (err as { status?: number }).status === 400
    ) {
      res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
      });
      return;
    }

    if (config.nodeEnv !== 'test') {
      console.error('Unhandled error:', err);
    }

    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
    });
  },
);
