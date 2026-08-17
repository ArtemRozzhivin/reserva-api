import type { RequestHandler } from "express";
import bookingServices from "../services/booking.service";
import { UnauthorizedError } from "../errors/app-error";

// POST /events/:id/bookings  — :id is the event id.
const create: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const booking = await bookingServices.book(req.user.id, req.params.id);

  res.status(201).json({ success: true, data: booking });
};

// POST /bookings/:id/confirm  — :id is the booking id.
const confirm: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const booking = await bookingServices.confirm(req.user.id, req.params.id);

  res.status(200).json({ success: true, data: booking });
};

// DELETE /bookings/:id  — :id is the booking id.
const cancel: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const booking = await bookingServices.cancel(req.user.id, req.params.id);

  res.status(200).json({ success: true, data: booking });
};

export default { create, confirm, cancel };
