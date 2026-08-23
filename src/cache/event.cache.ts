import { env } from "../config/env";
import type { Event } from "../generated/prisma/client";
import { redis } from "./redis";

type SerializedEvent = Omit<Event, "startsAt" | "createdAt" | "updatedAt"> & {
  startsAt: string;
  createdAt: string;
  updatedAt: string;
};

const reviveEvent = (e: SerializedEvent): Event => ({
  ...e,
  startsAt: new Date(e.startsAt),
  createdAt: new Date(e.createdAt),
  updatedAt: new Date(e.updatedAt),
});

const eventKey = (id: string) => `event:${id}`;

const getEvent = async (id: string) => {
  try {
    const raw = await redis.get(eventKey(id));

    if (!raw) return null;

    const parsed = JSON.parse(raw) as SerializedEvent;

    return reviveEvent(parsed);
  } catch (error) {
    console.warn(
      `[event-cache] read failed for ${eventKey(id)}; serving from Postgres`,
      error,
    );
    return null;
  }
};

const setEvent = async (id: string, event: Event) => {
  try {
    const value = JSON.stringify(event);
    await redis.set(eventKey(id), value, "EX", env.REDIS_TTL);
  } catch (error) {
    console.warn(
      `[event-cache] write failed for ${eventKey(id)}; event left uncached`,
      error,
    );
    return null;
  }
};

const delEvent = async (id: string) => {
  try {
    await redis.del(eventKey(id));
  } catch (error) {
    console.warn(
      `[event-cache] invalidation failed for ${eventKey(id)}; stale entry persists up to ${env.REDIS_TTL}s`,
      error,
    );
    return null;
  }
};

interface EventListValue {
  data: Event[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type SerializedEventList = Omit<EventListValue, "data"> & {
  data: SerializedEvent[];
};

const eventListKey = (page: number, limit: number) =>
  `events:list:p${page}:l:${limit}`;

const getEventList = async (page: number, limit: number) => {
  try {
    const raw = await redis.get(eventListKey(page, limit));

    if (!raw) return null;

    const parsed = JSON.parse(raw) as SerializedEventList;

    return { data: parsed.data.map(reviveEvent), meta: parsed.meta };
  } catch (error) {
    console.warn(
      `[event-cache] read failed for ${eventListKey(page, limit)}; serving from Postgres`,
      error,
    );
    return null;
  }
};

const setEventList = async (
  page: number,
  limit: number,
  value: EventListValue,
) => {
  try {
    const parsed = JSON.stringify(value);
    await redis.set(eventListKey(page, limit), parsed, "EX", env.REDIS_TTL);
  } catch (error) {
    console.warn(
      `[event-cache] write failed for ${eventListKey(page, limit)}; page left uncached`,
      error,
    );
    return null;
  }
};

export default { getEvent, setEvent, delEvent, getEventList, setEventList };
