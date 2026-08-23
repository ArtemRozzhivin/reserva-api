import { ForbiddenError, NotFoundError } from "../errors/app-error";
import eventRepository from "../repositories/event.repository";
import eventCache from "../cache/event.cache";
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
    const cachedEvent = await eventCache.getEvent(eventId);
    if (cachedEvent) return cachedEvent;

    const event = await eventRepository.findByEventId(eventId);
    if (!event) {
      throw new NotFoundError("Event not found");
    }
    await eventCache.setEvent(eventId, event);
    return event;
  },

  async listEvents({ page, limit }: { page: number; limit: number }) {
    const cachedList = await eventCache.getEventList(page, limit);

    if (cachedList) return cachedList;

    const skip = (page - 1) * limit;
    const { data, total } = await eventRepository.listEvents({
      skip,
      take: limit,
    });

    const result = {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };

    eventCache.setEventList(page, limit, result);
    return result;
  },

  async updateEvent(eventId: string, userId: string, input: UpdateEventInput) {
    const event = await loadOwnedEvent(eventId, userId);

    const result = await eventRepository.updateEvent(event.id, input);
    await eventCache.delEvent(eventId);

    return result;
  },

  async deleteEvent(eventId: string, userId: string) {
    const event = await loadOwnedEvent(eventId, userId);
    await eventRepository.deleteEvent(event.id);
    await eventCache.delEvent(eventId);
  },
};

export default eventServices;
