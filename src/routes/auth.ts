import { Router, Request, Response } from "express";
import {
  createUser,
  findUserByEmail,
  findUserById,
  toPublicUser,
} from "../data/users";
import {
  hashPassword,
  verifyPassword,
} from "../services/password";
import { createAccessToken } from "../services/token";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post(
  "/register",
  async (req: Request, res: Response) => {
    try {
      const { name, email, password } = req.body;

      if (
        typeof name !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string"
      ) {
        res.status(400).json({
          error: "name, email and password are required",
        });
        return;
      }

      if (name.trim().length < 2) {
        res.status(400).json({
          error: "Name must contain at least 2 characters",
        });
        return;
      }

      if (!isValidEmail(email)) {
        res.status(400).json({
          error: "Invalid email address",
        });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({
          error: "Password must contain at least 8 characters",
        });
        return;
      }

      const existingUser = await findUserByEmail(email);

      if (existingUser) {
        res.status(409).json({
          error: "An account with this email already exists",
        });
        return;
      }

      const passwordHash = await hashPassword(password);

      const user = await createUser(
        {
          name,
          email,
        },
        passwordHash
      );

      const token = createAccessToken(
        user.id,
        user.role
      );

      res.status(201).json({
        user: toPublicUser(user),
        token,
      });
    } catch (error) {
      console.error("Registration failed:", error);

      res.status(500).json({
        error: "Unable to create account",
      });
    }
  }
);

router.post(
  "/login",
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (
        typeof email !== "string" ||
        typeof password !== "string"
      ) {
        res.status(400).json({
          error: "email and password are required",
        });
        return;
      }

      const user = await findUserByEmail(email);

      if (!user) {
        res.status(401).json({
          error: "Invalid email or password",
        });
        return;
      }

      const validPassword = await verifyPassword(
        password,
        user.passwordHash
      );

      if (!validPassword) {
        res.status(401).json({
          error: "Invalid email or password",
        });
        return;
      }

      const token = createAccessToken(
        user.id,
        user.role
      );

      res.json({
        user: toPublicUser(user),
        token,
      });
    } catch (error) {
      console.error("Login failed:", error);

      res.status(500).json({
        error: "Unable to log in",
      });
    }
  }
);

router.get(
  "/me",
  requireAuth,
  async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    try {
      const userId = req.user!.id;

      const user = await findUserById(userId);

      if (!user) {
        res.status(404).json({
          error: "User not found",
        });
        return;
      }

      res.json({
        user: toPublicUser(user),
      });
    } catch (error) {
      console.error("Fetching current user failed:", error);

      res.status(500).json({
        error: "Unable to fetch user",
      });
    }
  }
);

export default router;