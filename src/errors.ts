export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "BAD_REQUEST", message, details);
}

export function notFound(message: string, details?: unknown): AppError {
  return new AppError(404, "NOT_FOUND", message, details);
}

export function forbidden(message: string, details?: unknown): AppError {
  return new AppError(403, "FORBIDDEN", message, details);
}

export function conflict(
  code: string,
  message: string,
  details?: unknown,
): AppError {
  return new AppError(409, code, message, details);
}
