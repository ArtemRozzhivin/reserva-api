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

// Standard envelopes, written once and referenced everywhere.
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

// A JSON-body response with the given data schema under { success, data }.
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

const errorAs = (description: string) => ({
  description,
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
});

const jsonBody = (ref: string) => ({
  required: true,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${ref}` } },
  },
});

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
      RegisterRequest: toSchema(registerSchema),
      LoginRequest: toSchema(loginScema),
      RefreshRequest: toSchema(refreshSchema),
      CreateEventRequest: toSchema(createEventSchema),
      UpdateEventRequest: toSchema(updateEventSchema),
    },
  },
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register with email + password",
        requestBody: jsonBody("RegisterRequest"),
        responses: {
          "201": ok("Created"),
          "400": errorAs("Validation error"),
          "409": errorAs("Email already registered"),
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in; returns access + refresh tokens",
        requestBody: jsonBody("LoginRequest"),
        responses: {
          "200": ok("Tokens issued"),
          "401": errorAs("Invalid credentials"),
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate a refresh token for a new pair",
        requestBody: jsonBody("RefreshRequest"),
        responses: {
          "200": ok("New token pair"),
          "401": errorAs("Invalid token"),
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke a refresh token (idempotent)",
        requestBody: jsonBody("RefreshRequest"),
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
          "200": ok("A page of events"),
          "400": errorAs("Bad query"),
        },
      },
      post: {
        tags: ["Events"],
        summary: "Create an event (organizer only)",
        security: [{ bearerAuth: [] }],
        requestBody: jsonBody("CreateEventRequest"),
        responses: {
          "201": ok("Created"),
          "401": errorAs("Unauthenticated"),
          "403": errorAs("Not an organizer"),
        },
      },
    },
    "/events/{id}": {
      get: {
        tags: ["Events"],
        summary: "Get one event (public)",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": ok("The event"), "404": errorAs("Not found") },
      },
      patch: {
        tags: ["Events"],
        summary: "Update an event (owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: jsonBody("UpdateEventRequest"),
        responses: {
          "200": ok("Updated"),
          "403": errorAs("Not the owner"),
          "404": errorAs("Not found"),
        },
      },
      delete: {
        tags: ["Events"],
        summary: "Delete an event (owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
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
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "201": ok("HELD booking created"),
          "409": errorAs("Sold out / already booked"),
        },
      },
    },
    "/bookings/{id}/confirm": {
      post: {
        tags: ["Bookings"],
        summary: "Confirm a HELD booking",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": ok("Confirmed"),
          "409": errorAs("Not held / expired"),
        },
      },
    },
    "/bookings/{id}": {
      delete: {
        tags: ["Bookings"],
        summary: "Cancel a booking, returning its seat",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": ok("Cancelled"),
          "409": errorAs("Already cancelled"),
        },
      },
    },
  },
};
