import type { RequestHandler } from "express";
import { UnauthorizedError } from "../errors/app-error";
import { verifyToken } from "../utils/access.token";

export const authMiddleware: RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new UnauthorizedError();
  }

  const [prefix, token] = authHeader.split(" ");

  if (prefix !== "Bearer" || !token) {
    throw new UnauthorizedError();
  }

  try {
    const user = verifyToken(token);
    req.user = user;

    next();
  } catch {
    throw new UnauthorizedError();
  }
};
