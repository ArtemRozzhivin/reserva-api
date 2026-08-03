import { ForbiddenError, NotFoundError } from "../errors/app-error";
import eventRepository from "../repositories/event.repository";
import type {
  CreateEventInput,
  UpdateEventInput,
} from "../validators/event.validators";

// Load an event and assert the caller owns it. Order matters: 404 before 403 —
// we don't reveal "this event exists" to someone who isn't its organizer.
async function loadOwnedEvent(eventId: string, userId: string) {
  const event = await eventRepository.findByEventId(eventId);
  if (!event) {
    throw new NotFoundError("Event not found");
  }
  if (event.organizerId !== userId) {
    throw new ForbiddenError("You do not have access to this event");
  }
  return event;
}

const eventServices = {
  async createEvent(organizerId: string, input: CreateEventInput) {
    return await eventRepository.createEvent({ ...input, organizerId });
  },

  async getEvent(eventId: string) {
    const event = await eventRepository.findByEventId(eventId);
    if (!event) {
      throw new NotFoundError("Event not found");
    }
    return event;
  },

  async listEvents({ page, limit }: { page: number; limit: number }) {
    const skip = (page - 1) * limit;
    const { data, total } = await eventRepository.listEvents({
      skip,
      take: limit,
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async updateEvent(eventId: string, userId: string, input: UpdateEventInput) {
    const event = await loadOwnedEvent(eventId, userId);
    return await eventRepository.updateEvent(event.id, input);
  },

  async deleteEvent(eventId: string, userId: string) {
    const event = await loadOwnedEvent(eventId, userId);
    await eventRepository.deleteEvent(event.id);
  },
};

export default eventServices;
