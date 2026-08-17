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

// availableSeats is passed explicitly so a fixture can represent an event that
// already has seats taken, keeping the invariant true before the test starts.
const seedEvent = (
  organizerId: string,
  capacity: number,
  availableSeats: number = capacity,
) =>
  prisma.event.create({
    data: {
      title: "Cancel Night",
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
) =>
  prisma.booking.create({
    data: {
      eventId,
      userId,
      status,
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });

const cancel = (bookingId: string, token?: string) =>
  fetch(`${baseUrl}/bookings/${bookingId}`, {
    method: "DELETE",
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

const countActive = (eventId: string) =>
  prisma.booking.count({
    where: {
      eventId,
      status: { in: [BookingStatus.HELD, BookingStatus.CONFIRMED] },
    },
  });

// --- single-request behaviour ------------------------------------------------

describe("DELETE /bookings/:id", () => {
  test("cancels a HELD booking, returns the seat, responds 200 with the row", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(event.id, user.id);

    const { status, body } = await readResponse(
      await cancel(booking.id, token),
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.status).toBe(BookingStatus.CANCELLED);

    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    expect(fresh?.availableSeats).toBe(3);
  });

  test("cancels a CONFIRMED booking and returns its seat", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(
      event.id,
      user.id,
      BookingStatus.CONFIRMED,
    );

    const { status, body } = await readResponse(
      await cancel(booking.id, token),
    );

    expect(status).toBe(200);
    expect(body.data?.status).toBe(BookingStatus.CANCELLED);

    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    expect(fresh?.availableSeats).toBe(3);
  });

  test("a second, sequential cancel is 409 ALREADY_CANCELLED and returns no extra seat", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(event.id, user.id);

    const first = await readResponse(await cancel(booking.id, token));
    const second = await readResponse(await cancel(booking.id, token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("ALREADY_CANCELLED");

    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    expect(fresh?.availableSeats).toBe(3);
  });

  test("cancelling another user's booking is 403 and leaves the seat taken", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const owner = await seedAttendee(0);
    const stranger = await seedAttendee(1);
    const booking = await seedBooking(event.id, owner.user.id);

    const { status, body } = await readResponse(
      await cancel(booking.id, stranger.token),
    );

    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");

    const untouched = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    expect(untouched?.status).toBe(BookingStatus.HELD);
    expect(fresh?.availableSeats).toBe(2);
  });

  test("requires authentication", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user } = await seedAttendee(0);
    const booking = await seedBooking(event.id, user.id);

    const { status, body } = await readResponse(await cancel(booking.id));

    expect(status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("is 404 for a booking that does not exist", async () => {
    const { token } = await seedAttendee(0);

    const { status, body } = await readResponse(
      await cancel("00000000-0000-0000-0000-000000000000", token),
    );

    expect(status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  // The partial unique index is `WHERE status IN ('HELD','CONFIRMED')`, so a
  // CANCELLED row must not block a fresh booking for the same (userId, eventId).
  test("the same user can re-book the event after cancelling", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(event.id, user.id);

    expect((await cancel(booking.id, token)).status).toBe(200);

    const rebooked = await fetch(`${baseUrl}/events/${event.id}/bookings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(rebooked.status).toBe(201);

    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    expect(fresh?.availableSeats).toBe(2);
    expect(await countActive(event.id)).toBe(1);
  });

  // Known gap: nothing validates that :id is a UUID, so Prisma throws on the
  // malformed value and the error middleware maps it to 500 INTERNAL.
  test.todo(
    "rejects a non-UUID booking id with 400 VALIDATION_ERROR (currently 500)",
    () => {},
  );
});

// --- the race ---------------------------------------------------------------
//
// These must fire real concurrent HTTP requests. The sequential double-cancel
// above passes even against a guard that trusts the pre-write snapshot, because
// the second request's own read already sees CANCELLED. Only overlapping
// requests — where both read HELD before either commits — expose it.

describe("DELETE /bookings/:id — concurrent cancels of one booking", () => {
  const N = 5;

  test("exactly one succeeds and the seat is returned exactly once", async () => {
    const CAPACITY = 4;
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, CAPACITY, CAPACITY - 1);
    const { user, token } = await seedAttendee(0);
    const booking = await seedBooking(event.id, user.id);

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        cancel(booking.id, token).then(readResponse),
      ),
    );

    const cancelled = results.filter((r) => r.status === 200);
    const conflicted = results.filter((r) => r.status === 409);

    // Every loser must be a clean 409; a 500 here means a duplicate seat return
    // tripped CHECK (availableSeats <= capacity) instead of being rejected.
    expect(cancelled).toHaveLength(1);
    expect(conflicted).toHaveLength(N - 1);
    for (const loser of conflicted) {
      expect(loser.body.error?.code).toBe("ALREADY_CANCELLED");
    }

    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    expect(fresh?.availableSeats).toBe(CAPACITY);
    expect(await countActive(event.id)).toBe(0);
  });

  // The CHECK constraint cannot catch this one: with other seats still held the
  // inflated counter stays <= capacity, so a duplicate seat return is silent and
  // only shows up later as an oversell. The invariant is the only witness.
  test("keeps availableSeats consistent with active bookings while other seats are held", async () => {
    const CAPACITY = 8;
    const HELD_SEATS = 5;

    const organizer = await seedOrganizer();
    const event = await seedEvent(
      organizer.id,
      CAPACITY,
      CAPACITY - HELD_SEATS,
    );

    // One booking per attendee — the partial unique index allows only one active
    // booking per (userId, eventId).
    const attendees = await Promise.all(
      Array.from({ length: HELD_SEATS }, (_, i) => seedAttendee(i)),
    );
    const bookings = await Promise.all(
      attendees.map((a) => seedBooking(event.id, a.user.id)),
    );

    const target = bookings[0]!;
    const token = attendees[0]!.token;

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        cancel(target.id, token).then(readResponse),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(N - 1);

    const fresh = await prisma.event.findUnique({ where: { id: event.id } });
    const active = await countActive(event.id);

    // CONCURRENCY.md §1, asserted directly.
    expect(active).toBe(HELD_SEATS - 1);
    expect(fresh?.availableSeats).toBe(CAPACITY - active);
  });
});
