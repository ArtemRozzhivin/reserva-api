import eventCache from "../cache/event.cache";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../errors/app-error";
import bookingRepository from "../repositories/booking.repository";
import eventRepository from "../repositories/event.repository";

const SWEEP_BATCH_SIZE = 100;

const bookingService = {
  async book(userId: string, eventId: string) {
    const result = await prisma.$transaction(async (tx) => {
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

    await eventCache.delEvent(eventId);
    return result;
  },

  async confirm(userId: string, bookingId: string) {
    const booking = await bookingRepository.findById(bookingId);

    if (!booking) {
      throw new NotFoundError("Booking not found");
    }

    if (booking.userId !== userId) {
      throw new ForbiddenError();
    }

    const confirm = await bookingRepository.confirmIfHeld(bookingId);

    if (confirm === 0 && booking.status === "CONFIRMED") {
      throw new ConflictError("Booking already confirmed", "ALREADY_CONFIRMED");
    } else if (confirm === 0 && booking.status === "CANCELLED") {
      throw new ConflictError("Booking is cancelled", "BOOKING_CANCELLED");
    } else if (confirm === 0) {
      throw new ConflictError("Hold has expired", "HOLD_EXPIRED");
    }

    return await bookingRepository.findById(bookingId);
  },

  async cancel(userId: string, bookingId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const booking = await bookingRepository.findById(bookingId, tx);

      if (!booking) {
        throw new NotFoundError("Booking not found");
      }

      if (booking.userId !== userId) {
        throw new ForbiddenError();
      }

      const cancel = await bookingRepository.cancelIfActive(bookingId, tx);

      // Branch on the write's result, never on `booking` — that snapshot predates the
      // write, and a concurrent cancel (or the M5 sweeper) can have moved the row since.
      // 0 rows means it is no longer active, so whoever cancelled it already returned
      // its seat; incrementing again would inflate availableSeats and oversell later.
      if (cancel === 0) {
        throw new ConflictError(
          "Booking already cancelled",
          "ALREADY_CANCELLED",
        );
      }

      await eventRepository.incrementSeat(booking.eventId, tx);

      return bookingRepository.findById(bookingId, tx);
    });

    if (result) await eventCache.delEvent(result.eventId);
    return result;
  },

  async sweepExpiredHolds() {
    const bookings = await bookingRepository.findExpiredHeld(SWEEP_BATCH_SIZE);

    if (bookings.length === 0) return 0;

    const { released, eventIds } = await prisma.$transaction(async (tx) => {
      let released = 0;
      const touched = new Set<string>();
      for (const booking of bookings) {
        const result = await bookingRepository.expireIfHeld(booking.id, tx);

        if (result === 1) {
          await eventRepository.incrementSeat(booking.eventId, tx);
          touched.add(booking.eventId);
          released++;
        }
      }

      return { released, eventIds: [...touched] };
    });

    for (const eventId of eventIds) {
      await eventCache.delEvent(eventId);
    }

    return released;
  },
};

export default bookingService;
