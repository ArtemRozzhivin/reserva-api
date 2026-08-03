import z from "zod";

// Shared field rules — defined once so create/update can't drift apart.
const title = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(200, "Title must be at most 200 characters");

const description = z
  .string()
  .trim()
  .max(2000, "Description must be at most 2000 characters");

// Coerces an ISO string to a Date, then enforces "future at creation".
// This lives here (and in the service) rather than as a DB CHECK because
// "in the future" is a point-in-time rule and now() isn't immutable.
const startsAt = z.coerce
  .date()
  .refine(
    (value) => value.getTime() > Date.now(),
    "startsAt must be in the future",
  );

const capacity = z
  .number()
  .int("Capacity must be a whole number")
  .positive("Capacity must be greater than 0");

// availableSeats and organizerId are intentionally absent: the service derives
// availableSeats (= capacity) and takes organizerId from the authenticated user.
// `.strict()` rejects them (and any other extra key) to block mass-assignment.
export const createEventSchema = z
  .object({
    title,
    description: description.optional(),
    startsAt,
    capacity,
  })
  .strict();

// PATCH: every field optional, but at least one must be present (an empty body
// is a client mistake, not a no-op). capacity is deliberately excluded — changing
// it after creation requires reconciling availableSeats safely, deferred to booking work.
export const updateEventSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    startsAt: startsAt.optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  );

// Query params arrive as strings, so coerce. Sensible defaults + a hard limit
// cap so a client can't request an unbounded page.
export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
