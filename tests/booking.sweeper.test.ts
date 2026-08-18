import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/db/prisma";
import { BookingStatus, Role } from "../src/generated/prisma/enums";
import bookingService from "../src/services/booking.service";

// The sweeper is background work — no HTTP. Tests call sweepExpiredHolds()
// directly against the separate test database (the `test` script overrides
// DATABASE_URL to reserva_test).

afterAll(async () => {
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

const seedEvent = (
  organizerId: string,
  capacity: number,
  availableSeats: number = capacity,
) =>
  prisma.event.create({
    data: {
      title: "Sweep Night",
      capacity,
      availableSeats,
      startsAt: new Date(Date.now() + 86_400_000),
      organizerId,
    },
  });

const seedAttendee = (index: number) =>
  prisma.user.create({
    data: {
      email: `att_${index}@test.local`,
      passwordHash: "x",
      role: Role.ATTENDEE,
    },
  });

const EXPIRED = new Date(Date.now() - 60_000); // one minute ago
const FUTURE = new Date(Date.now() + 10 * 60_000);

const seedBooking = (
  eventId: string,
  userId: string,
  status: BookingStatus,
  holdExpiresAt: Date,
) =>
  prisma.booking.create({
    data: { eventId, userId, status, holdExpiresAt },
  });

const seatsOf = async (eventId: string) =>
  (await prisma.event.findUnique({ where: { id: eventId } }))?.availableSeats;

const statusOf = async (bookingId: string) =>
  (await prisma.booking.findUnique({ where: { id: bookingId } }))?.status;

// -----------------------------------------------------------------------------

describe("sweepExpiredHolds", () => {
  test("cancels an expired HELD booking and returns its seat", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2); // one seat already held
    const user = await seedAttendee(0);
    const booking = await seedBooking(
      event.id,
      user.id,
      BookingStatus.HELD,
      EXPIRED,
    );

    const released = await bookingService.sweepExpiredHolds();

    expect(released).toBe(1);
    expect(await statusOf(booking.id)).toBe(BookingStatus.CANCELLED);
    expect(await seatsOf(event.id)).toBe(3);
  });

  test("is idempotent — a second sweep returns 0 and does not re-credit the seat", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const user = await seedAttendee(0);
    await seedBooking(event.id, user.id, BookingStatus.HELD, EXPIRED);

    expect(await bookingService.sweepExpiredHolds()).toBe(1);
    expect(await bookingService.sweepExpiredHolds()).toBe(0);

    // Seat returned exactly once.
    expect(await seatsOf(event.id)).toBe(3);
  });

  test("ignores a CONFIRMED booking, even with a stale holdExpiresAt", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const user = await seedAttendee(0);
    const booking = await seedBooking(
      event.id,
      user.id,
      BookingStatus.CONFIRMED,
      EXPIRED,
    );

    const released = await bookingService.sweepExpiredHolds();

    expect(released).toBe(0);
    expect(await statusOf(booking.id)).toBe(BookingStatus.CONFIRMED);
    expect(await seatsOf(event.id)).toBe(2);
  });

  test("ignores a HELD booking whose window has not passed", async () => {
    const organizer = await seedOrganizer();
    const event = await seedEvent(organizer.id, 3, 2);
    const user = await seedAttendee(0);
    const booking = await seedBooking(
      event.id,
      user.id,
      BookingStatus.HELD,
      FUTURE,
    );

    const released = await bookingService.sweepExpiredHolds();

    expect(released).toBe(0);
    expect(await statusOf(booking.id)).toBe(BookingStatus.HELD);
    expect(await seatsOf(event.id)).toBe(2);
  });

  test("credits the right event when expired holds span several events", async () => {
    const organizer = await seedOrganizer();
    const eventA = await seedEvent(organizer.id, 5, 3); // 2 held
    const eventB = await seedEvent(organizer.id, 5, 4); // 1 held
    const [u0, u1, u2] = await Promise.all([
      seedAttendee(0),
      seedAttendee(1),
      seedAttendee(2),
    ]);

    // eventA: two expired holds; eventB: one expired hold.
    await seedBooking(eventA.id, u0.id, BookingStatus.HELD, EXPIRED);
    await seedBooking(eventA.id, u1.id, BookingStatus.HELD, EXPIRED);
    await seedBooking(eventB.id, u2.id, BookingStatus.HELD, EXPIRED);

    const released = await bookingService.sweepExpiredHolds();

    expect(released).toBe(3);
    expect(await seatsOf(eventA.id)).toBe(5);
    expect(await seatsOf(eventB.id)).toBe(5);
  });
});
