import { randomBytes } from "node:crypto";
import { env } from "../config/env";

export const generateRerfeshToken = () => randomBytes(32).toString("hex");

export const hashRefreshToken = (token: string) =>
  new Bun.CryptoHasher("sha256").update(token).digest("hex");

export const refreshTokenTtlMs = () => {
  return new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
};
