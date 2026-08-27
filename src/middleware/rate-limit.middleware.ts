import rateLimit from "express-rate-limit";
import { env } from "../config/env";

// Rate limits would make the integration tests flaky (many requests from one IP
// in one window), and they aren't what those tests exercise — so skip in tests.
const skip = () => env.NODE_ENV === "test";

// Strict limiter for auth endpoints — the main brute-force / credential-stuffing
// surface (login, register, refresh). Few attempts per IP per window.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 15, // per IP per window
  standardHeaders: "draft-7", // expose RateLimit-* headers so clients can back off
  legacyHeaders: false,
  skip,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests, please try again later",
    },
  },
});

// Looser limiter for booking creation — allows normal use, caps spamming holds.
export const bookingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many booking attempts, please slow down",
    },
  },
});
