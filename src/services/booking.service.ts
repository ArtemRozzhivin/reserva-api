import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError } from "../errors/app-error";
import bookingRepository from "../repositories/booking.repository";
import eventRepository from "../repositories/event.repository";

const bookingService = {
  async book(userId: string, eventId: string) {
    return prisma.$transaction(async (tx) => {
      const locked = await eventRepository.lockEvent(eventId, tx);

      if (!locked) {
        throw new NotFoundError("Event not found");
      }

      if (locked.availableSeats <= 0) {
        throw new ConflictError("No seats available", "SOLD_OUT");
      }

      const existingBooking = await bookingRepository.findActiveByUserEvent(
        userId,
        eventId,
        tx,
      );

      if (existingBooking) {
        throw new ConflictError(
          "You already have a booking for this event",
          "ALREADY_BOOKED",
        );
      }

      const holdExpiresAt = new Date(
        Date.now() + env.BOOKING_HOLD_MINUTES * 60 * 1000,
      );

      const booking = await bookingRepository.createBooking(
        {
          userId,
          eventId,
          holdExpiresAt,
        },
        tx,
      );

      await eventRepository.decrementSeat(eventId, tx);

      return booking;
    });
  },
};

export default bookingService;
