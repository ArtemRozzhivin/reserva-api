import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";

const eventRepository = {
  async createEvent(payload: {
    title: string;
    description?: string;
    startsAt: Date;
    capacity: number;
    organizerId: string;
  }) {
    return await prisma.event.create({
      data: {
        ...payload,
        // Derived here, never accepted from the client: a fresh event has all seats free.
        availableSeats: payload.capacity,
      },
    });
  },

  async findByEventId(eventId: string) {
    return await prisma.event.findUnique({ where: { id: eventId } });
  },

  // One snapshot for both the page and the total, so count and rows can't disagree.
  async listEvents({ skip, take }: { skip: number; take: number }) {
    const [data, total] = await prisma.$transaction([
      prisma.event.findMany({ skip, take, orderBy: { startsAt: "asc" } }),
      prisma.event.count(),
    ]);

    return { data, total };
  },

  async updateEvent(
    eventId: string,
    payload: {
      title?: string;
      description?: string;
      startsAt?: Date;
    },
  ) {
    return await prisma.event.update({ where: { id: eventId }, data: payload });
  },

  async deleteEvent(eventId: string) {
    return await prisma.event.delete({ where: { id: eventId } });
  },

  // Lock the event row and read its seat count in one statement. FOR UPDATE makes
  // any concurrent booking for THIS event wait until we commit/rollback.
  async lockEvent(eventId: string, tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<
      { availableSeats: number }[]
    >`SELECT "availableSeats" FROM "Event" WHERE "id" = ${eventId}::uuid FOR UPDATE`;

    return rows[0] ?? null;
  },

  async decrementSeat(eventId: string, tx: Prisma.TransactionClient) {
    return tx.event.update({
      where: { id: eventId },
      data: { availableSeats: { decrement: 1 } },
    });
  },

  // Return a seat on cancellation. Atomic increment; the CHECK (availableSeats <=
  // capacity) is the backstop if a seat is ever returned more times than it was taken.
  async incrementSeat(eventId: string, tx: Prisma.TransactionClient) {
    return tx.event.update({
      where: { id: eventId },
      data: { availableSeats: { increment: 1 } },
    });
  },
};

export default eventRepository;
