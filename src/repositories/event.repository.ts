import { prisma } from "../db/prisma";

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
};

export default eventRepository;
