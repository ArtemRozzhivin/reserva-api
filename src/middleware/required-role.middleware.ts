import type { RequestHandler } from "express";
import type { Role } from "../generated/prisma/enums";
import { ForbiddenError, UnauthorizedError } from "../errors/app-error";

export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    if (req.user.role === role) {
      next();
    } else {
      throw new ForbiddenError();
    }
  };
