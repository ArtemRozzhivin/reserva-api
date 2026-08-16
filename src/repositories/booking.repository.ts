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
};

export default bookingRepository;
