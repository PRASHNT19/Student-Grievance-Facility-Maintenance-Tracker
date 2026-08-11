import jwt from "jsonwebtoken";
import { UserRole } from "../types/user";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not configured");
}

export interface AuthTokenPayload {
  sub: string;
  role: UserRole;
}

export function createAccessToken(
  userId: string,
  role: UserRole
): string {
  const payload: AuthTokenPayload = {
    sub: userId,
    role,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "2h",
  });
}

export function verifyAccessToken(
  token: string
): AuthTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof decoded.sub !== "string" ||
    typeof decoded.role !== "string"
  ) {
    throw new Error("Invalid token payload");
  }

  return {
    sub: decoded.sub,
    role: decoded.role as UserRole,
  };
}