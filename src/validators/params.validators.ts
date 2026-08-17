import z from "zod";

// Every `:id` route param is a UUID. Reused across event and booking routes so a
// malformed id is a clean 400 instead of a Prisma cast error surfacing as 500.
export const idParamSchema = z.object({
  id: z.uuid("Invalid id format"),
});
