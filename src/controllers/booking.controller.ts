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

export default { create };
