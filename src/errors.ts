/**
 * A single error type for everything the API is allowed to tell the client
 * about. Anything else becomes a generic 500 in the error handler, so raw
 * PostgreSQL messages never leak out of the process.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

/** The actor is known but is not permitted to perform this action. */
export const forbidden = (code: string, message: string) =>
  new AppError(403, code, message);

export const notFound = (code: string, message: string) =>
  new AppError(404, code, message);

export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
