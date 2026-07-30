import type { AuthUser } from "./auth";

// Augment Express's Request so `req.user` is available (and typed) after the
// authenticate middleware runs. Optional: routes without the middleware won't set it.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
