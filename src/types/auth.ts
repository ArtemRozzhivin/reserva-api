import type { Role } from "../generated/prisma/enums";

/** Shape of the authenticated principal carried in the JWT and on `req.user`. */
export type AuthUser = {
  id: string;
  email: string;
  role: Role;
};
