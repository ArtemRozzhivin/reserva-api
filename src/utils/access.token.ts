import { env } from "../config/env";
import type { User } from "../generated/prisma/client";
import type { AuthUser } from "../types/auth";
import jwt from "jsonwebtoken";

export const signToken = (user: User) => {
  const { id, email, role } = user;
  const payload: AuthUser = { id, email, role };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
};

export const verifyToken = (token: string): AuthUser => {
  return jwt.verify(token, env.JWT_SECRET) as AuthUser;
};
