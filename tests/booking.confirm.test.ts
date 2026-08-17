import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Server } from "node:http";
import { app } from "../src/app";
import { prisma } from "../src/db/prisma";
import { BookingStatus, Role } from "../src/generated/prisma/enums";
import { signToken } from "../src/utils/access.token";

// Drives the exported app in-process against the separate test database
// (see the `test` script, which overrides DATABASE_URL to reserva_test).

let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://localhost:${port}/api/v1`;
});

afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.booking.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// --- helpers -----------------------------------------------------------------

const seedOrganizer = () =>
  prisma.user.create({
    data: { email: "org@test.local", passwordHash: "x", role: Role.ORGANIZER },
  });

// availableSeats is passed explicitly: a HELD booking exists, so a 3-seat event
// starts with 2 free — confirm must leave that number untouched.
const seedEvent = (
  organizerId: string,
  capacity: number,
  availableSeats: number = capacity,
) =>
  prisma.event.create({
    data: {
      title: "Confirm Night",
      capacity,
      availableSeats,
      startsAt: new Date(Date.now() + 86_400_000),
      organizerId,
    },
  });

const seedAttendee = async (index: number) => {
  const user = await prisma.user.create({
    data: {
      email: `att_${index}@test.local`,
      passwordHash: "x",
      role: Role.ATTENDEE,
    },
  });

  return { user, token: signToken(user) };
};

const seedBooking = (
  eventId: string,
  userId: string,
  status: BookingStatus = BookingStatus.HELD,
  holdExpiresAt: Date = new Date(Date.now() + 10 * 60_000),
) =>
  prisma.booking.create({
    data: { eventId, userId, status, holdExpiresAt },
  });

const confirm = (bookingId: string, token?: string) =>
  fetch(`${baseUrl}/bookings/${bookingId}/confirm`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

// Status + parsed body together, so an unexpected 500 surfaces its message in the
// assertion diff instead of just showing a bare number.
const readResponse = async (res: Response) => ({
  status: res.status,
  body: (await res.json()) as {
    success: boolean;
    data?: { id: string; status: BookingStatus };
    error?: { code: string; message: string };
  },
});

// -----------------------------------------------------------------------------

describe("POST /bookings/:id/confirm", () => {
  test("confirms a HELD booking within its window, 200, and does not touch seats", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(event.id, user.id);

    const { status, body } = await readResponse(
      await confirm(booking.id, token),
    );

    expect(status).toBe(200);
    expect(body.data?.status).toBe(BookingStatus.CONFIRMED);

    // Confirm changes no seat count — the hold already decremented it.
    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    expect(fresh?.availableSeats).toBe(2);
  });

  test("a hold that already expired is 409 HOLD_EXPIRED", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(
      event.id,
      user.id,
      BookingStatus.HELD,
      new Date(Date.now() - 60_000), // hold window lapsed one minute ago
    );

    const { status, body } = await readResponse(
      await confirm(booking.id, token),
    );

    expect(status).toBe(409);
    expect(body.error?.code).toBe("HOLD_EXPIRED");

    // The row stays HELD — confirm did not flip it.
    const fresh = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(fresh?.status).toBe(BookingStatus.HELD);
  });

  test("confirming an already-CONFIRMED booking is 409 ALREADY_CONFIRMED", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(
      event.id,
      user.id,
      BookingStatus.CONFIRMED,
    );

    const { status, body } = await readResponse(
      await confirm(booking.id, token),
    );

    expect(status).toBe(409);
    expect(body.error?.code).toBe("ALREADY_CONFIRMED");
  });

  test("confirming a CANCELLED booking is 409 BOOKING_CANCELLED", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(
      event.id,
      user.id,
      BookingStatus.CANCELLED,
    );

    const { status, body } = await readResponse(
      await confirm(booking.id, token),
    );

    expect(status).toBe(409);
    expect(body.error?.code).toBe("BOOKING_CANCELLED");
  });

  test("confirming another user's booking is 403 and leaves it HELD", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const owner = await seedAttendee(0);
    const stranger = await seedAttendee(1);
    const booking = await seedBooking(event.id, owner.user.id);

    const { status, body } = await readResponse(
      await confirm(booking.id, stranger.token),
    );

    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");

    const untouched = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(untouched?.status).toBe(BookingStatus.HELD);
  });

  test("requires authentication", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user } = await seedAttendee(0);
    const booking = await seedBooking(event.id, user.id);

    const { status, body } = await readResponse(await confirm(booking.id));

    expect(status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("is 404 for a booking that does not exist", async () => {
    const { token } = await seedAttendee(0);

    const { status, body } = await readResponse(
      await confirm("00000000-0000-0000-0000-000000000000", token),
    );

    expect(status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  test("rejects a non-UUID booking id with 400 VALIDATION_ERROR", async () => {
    const { token } = await seedAttendee(0);

    const { status, body } = await readResponse(
      await confirm("not-a-uuid", token),
    );

    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});
