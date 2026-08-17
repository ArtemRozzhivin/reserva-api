import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";
import { BookingStatus } from "../generated/prisma/enums";

const bookingRepository = {
  // status defaults to HELD in the schema, so it isn't passed here.
  async createBooking(
    payload: {
      userId: string;
      eventId: string;
      holdExpiresAt: Date;
    },
    client: Prisma.TransactionClient = prisma,
  ) {
    return await client.booking.create({ data: payload });
  },

  // The "one active booking per user per event" check — mirrors the partial
  // unique index (HELD or CONFIRMED count as active; CANCELLED does not).
  async findActiveByUserEvent(
    userId: string,
    eventId: string,
    client: Prisma.TransactionClient = prisma,
  ) {
    return await client.booking.findFirst({
      where: {
        userId,
        eventId,
        status: { in: [BookingStatus.HELD, BookingStatus.CONFIRMED] },
      },
    });
  },

  async findById(bookingId: string, client: Prisma.TransactionClient = prisma) {
    return await client.booking.findUnique({ where: { id: bookingId } });
  },

  // Atomic, guarded transition: only flips HELD → CONFIRMED, and only while the
  // hold window is still open. Returns the number of rows changed (1 = success,
  // 0 = not HELD or already expired). updateMany is used because it no-ops to
  // count 0 instead of throwing when the WHERE doesn't match.
  async confirmIfHeld(
    bookingId: string,
    client: Prisma.TransactionClient = prisma,
  ) {
    const { count } = await client.booking.updateMany({
      where: {
        id: bookingId,
        status: BookingStatus.HELD,
        holdExpiresAt: { gt: new Date() },
      },
      data: { status: BookingStatus.CONFIRMED },
    });
    return count;
  },

  // Atomic, guarded transition: only an active (HELD/CONFIRMED) booking becomes
  // CANCELLED. Returns rows changed (1 = this call performed the cancel and owes
  // the seat back, 0 = it was already cancelled — don't return the seat twice).
  async cancelIfActive(
    bookingId: string,
    client: Prisma.TransactionClient = prisma,
  ) {
    const { count } = await client.booking.updateMany({
      where: {
        id: bookingId,
        status: { in: [BookingStatus.HELD, BookingStatus.CONFIRMED] },
      },
      data: { status: BookingStatus.CANCELLED },
    });
    return count;
  },
};

export default bookingRepository;
