import type { RequestHandler } from "express";
import eventServices from "../services/event.service";
import { listEventsQuerySchema } from "../validators/event.validators";
import { UnauthorizedError, ValidationError } from "../errors/app-error";

const create: RequestHandler = async (req, res) => {
  // authMiddleware guarantees req.user, but TS only knows it's optional.
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const event = await eventServices.createEvent(req.user.id, req.body);

  res.status(201).json({ success: true, data: event });
};

const getById: RequestHandler<{ id: string }> = async (req, res) => {
  const event = await eventServices.getEvent(req.params.id);

  res.status(200).json({ success: true, data: event });
};

const list: RequestHandler = async (req, res) => {
  const parsed = listEventsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message);
  }

  const { data, meta } = await eventServices.listEvents(parsed.data);

  res.status(200).json({ success: true, data, meta });
};

const update: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const event = await eventServices.updateEvent(
    req.params.id,
    req.user.id,
    req.body,
  );

  res.status(200).json({ success: true, data: event });
};

const remove: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  await eventServices.deleteEvent(req.params.id, req.user.id);

  res.status(204).send();
};

export default { create, getById, list, update, remove };
