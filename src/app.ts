import express, { NextFunction, Request, Response } from "express";

import healthRoutes from "./routes/healthRoutes";
import { AppError } from "./errors";
import authRouter from "./routes/auth";
import grievanceRouter from "./routes/grievances";
const app = express();

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/grievances", grievanceRouter);

app.use(healthRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });

    return;
  }

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
});

export default app;
