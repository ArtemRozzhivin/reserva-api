import { z } from "zod";
import {
  loginScema,
  refreshSchema,
  registerSchema,
} from "../validators/auth.validators";
import {
  createEventSchema,
  updateEventSchema,
} from "../validators/event.validators";

// Turn a Zod validator into an OpenAPI (JSON Schema) object. `unrepresentable:
// "any"` keeps it from throwing on types JSON Schema can't express (e.g. the
// coerced Date in createEventSchema) — those become open fields.
const toSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;

const uuid = { type: "string", format: "uuid" } as const;
const dateTime = { type: "string", format: "date-time" } as const;

// --- Response DTOs (hand-written; must mirror what the API actually returns) ---

// Note: no passwordHash — it is always stripped before leaving the service.
const userSchema = {
  type: "object",
  properties: {
    id: uuid,
    email: { type: "string", format: "email" },
    role: { type: "string", enum: ["ORGANIZER", "ATTENDEE"] },
    provider: { type: "string", enum: ["LOCAL", "GOOGLE"] },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
} as const;

const eventSchema = {
  type: "object",
  properties: {
    id: uuid,
    title: { type: "string" },
    description: { type: ["string", "null"] },
    startsAt: dateTime,
    capacity: { type: "integer" },
    availableSeats: { type: "integer" },
    organizerId: uuid,
    createdAt: dateTime,
    updatedAt: dateTime,
  },
} as const;

const bookingSchema = {
  type: "object",
  properties: {
    id: uuid,
    eventId: uuid,
    userId: uuid,
    status: { type: "string", enum: ["HELD", "CONFIRMED", "CANCELLED"] },
    holdExpiresAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
  },
} as const;

const tokenPairSchema = {
  type: "object",
  properties: {
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
  },
} as const;

const authSessionSchema = {
  type: "object",
  properties: {
    user: { $ref: "#/components/schemas/User" },
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
  },
} as const;

const pageMetaSchema = {
  type: "object",
  properties: {
    page: { type: "integer" },
    limit: { type: "integer" },
    total: { type: "integer" },
    totalPages: { type: "integer" },
  },
} as const;

const errorResponse = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

// --- helpers ---

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// A `{ success, data }` response whose data is the given schema (or none).
const ok = (description: string, data?: Record<string, unknown>) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          ...(data ? { data } : {}),
        },
      },
    },
  },
});

// A paginated list response: { success, data: Item[], meta }.
const okList = (description: string, itemName: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          data: { type: "array", items: ref(itemName) },
          meta: ref("PageMeta"),
        },
      },
    },
  },
});

const errorAs = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});

const jsonBody = (bodyRef: string, example: Record<string, unknown>) => ({
  required: true,
  content: {
    "application/json": {
      schema: ref(bodyRef),
      // An explicit example — without it Swagger UI auto-generates nonsense.
      example,
    },
  },
});

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: uuid,
} as const;

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Reserva API",
    version: "1.0.0",
    description:
      "Booking/reservation API for event tickets. Defining constraint: concurrency-safe seat allocation.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [{ name: "Auth" }, { name: "Events" }, { name: "Bookings" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Error: errorResponse,
      // request DTOs (from Zod)
      RegisterRequest: toSchema(registerSchema),
      LoginRequest: toSchema(loginScema),
      RefreshRequest: toSchema(refreshSchema),
      CreateEventRequest: toSchema(createEventSchema),
      UpdateEventRequest: toSchema(updateEventSchema),
      // response DTOs (hand-written)
      User: userSchema,
      Event: eventSchema,
      Booking: bookingSchema,
      AuthSession: authSessionSchema,
      TokenPair: tokenPairSchema,
      PageMeta: pageMetaSchema,
    },
  },
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register with email + password",
        requestBody: jsonBody("RegisterRequest", {
          email: "organizer@example.com",
          password: "Password123",
        }),
        responses: {
          "201": ok("Created", ref("User")),
          "400": errorAs("Validation error"),
          "409": errorAs("Email already registered"),
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in; returns the user + access & refresh tokens",
        requestBody: jsonBody("LoginRequest", {
          email: "organizer@example.com",
          password: "Password123",
        }),
        responses: {
          "200": ok("Session", ref("AuthSession")),
          "401": errorAs("Invalid credentials"),
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate a refresh token for a new pair",
        requestBody: jsonBody("RefreshRequest", {
          refreshToken:
            "9f8c7b6a5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a",
        }),
        responses: {
          "200": ok("New token pair", ref("TokenPair")),
          "401": errorAs("Invalid token"),
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke a refresh token (idempotent)",
        requestBody: jsonBody("RefreshRequest", {
          refreshToken:
            "9f8c7b6a5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a",
        }),
        responses: { "200": ok("Logged out") },
      },
    },
    "/auth/google": {
      get: {
        tags: ["Auth"],
        summary: "Redirect to Google's consent screen",
        responses: { "302": { description: "Redirect to Google" } },
      },
    },
    "/events": {
      get: {
        tags: ["Events"],
        summary: "List events (paginated, public)",
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": okList("A page of events", "Event"),
          "400": errorAs("Bad query"),
        },
      },
      post: {
        tags: ["Events"],
        summary: "Create an event (organizer only)",
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody("CreateEventRequest", {
          title: "Summer Night Concert",
          description: "An open-air live show.",
          startsAt: "2030-06-01T18:00:00.000Z",
          capacity: 100,
        }),
        responses: {
          "201": ok("Created", ref("Event")),
          "401": errorAs("Unauthenticated"),
          "403": errorAs("Not an organizer"),
        },
      },
    },
    "/events/{id}": {
      get: {
        tags: ["Events"],
        summary: "Get one event (public)",
        parameters: [idParam],
        responses: {
          "200": ok("The event", ref("Event")),
          "404": errorAs("Not found"),
        },
      },
      patch: {
        tags: ["Events"],
        summary: "Update an event (owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [idParam],
        requestBody: jsonBody("UpdateEventRequest", {
          title: "Summer Night Concert (rescheduled)",
          startsAt: "2030-06-02T18:00:00.000Z",
        }),
        responses: {
          "200": ok("Updated", ref("Event")),
          "403": errorAs("Not the owner"),
          "404": errorAs("Not found"),
        },
      },
      delete: {
        tags: ["Events"],
        summary: "Delete an event (owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [idParam],
        responses: {
          "204": { description: "Deleted" },
          "403": errorAs("Not the owner"),
          "404": errorAs("Not found"),
        },
      },
    },
    "/events/{id}/bookings": {
      post: {
        tags: ["Bookings"],
        summary: "Book a seat (concurrency-safe hold)",
        security: [{ bearerAuth: [] }],
        parameters: [idParam],
        responses: {
          "201": ok("HELD booking created", ref("Booking")),
          "409": errorAs("Sold out / already booked"),
        },
      },
    },
    "/bookings/{id}/confirm": {
      post: {
        tags: ["Bookings"],
        summary: "Confirm a HELD booking",
        security: [{ bearerAuth: [] }],
        parameters: [idParam],
        responses: {
          "200": ok("Confirmed", ref("Booking")),
          "409": errorAs("Not held / expired"),
        },
      },
    },
    "/bookings/{id}": {
      delete: {
        tags: ["Bookings"],
        summary: "Cancel a booking, returning its seat",
        security: [{ bearerAuth: [] }],
        parameters: [idParam],
        responses: {
          "200": ok("Cancelled", ref("Booking")),
          "409": errorAs("Already cancelled"),
        },
      },
    },
  },
};
