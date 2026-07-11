import { env } from "../config/env";
import type { User } from "../generated/prisma/client";
import jwt from "jsonwebtoken";

export const signToken = (user: User) => {
  const { id, email, role } = user;
  const payload = { id, email, role };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET);
};
