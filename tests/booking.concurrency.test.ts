import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { Server } from "node:http";
import { app } from "../src/app";
import { prisma } from "../src/db/prisma";
import { BookingStatus, Role } from "../src/generated/prisma/enums";
import { signToken } from "../src/utils/access.token";

// Drives the exported app in-process against the separate test database
// (see the `test` script, which overrides DATABASE_URL to reserva_test).

let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://localhost:${port}/api/v1`;
});

afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.booking.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

test("does not oversell under K concurrent bookings on a 1-seat event", async () => {
  const CAPACITY = 1;
  const K = 20;

  const organizer = await prisma.user.create({
    data: { email: "org@test.local", passwordHash: "x", role: Role.ORGANIZER },
  });
  const event = await prisma.event.create({
    data: {
      title: "Race Night",
      capacity: CAPACITY,
      availableSeats: CAPACITY,
      startsAt: new Date(Date.now() + 86_400_000),
      organizerId: organizer.id,
    },
  });
  const users = await Promise.all(
    Array.from({ length: K }, (_, i) =>
      prisma.user.create({
        data: {
          email: `att_${i}@test.local`,
          passwordHash: "x",
          role: Role.ATTENDEE,
        },
      }),
    ),
  );
  const tokens = users.map((user) => signToken(user));

  // Fire all K bookings simultaneously.
  const statuses = await Promise.all(
    tokens.map((token) =>
      fetch(`${baseUrl}/events/${event.id}/bookings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).then((res) => res.status),
    ),
  );

  const created = statuses.filter((s) => s === 201).length;
  const soldOut = statuses.filter((s) => s === 409).length;
  const held = await prisma.booking.count({
    where: { eventId: event.id, status: BookingStatus.HELD },
  });
  const fresh = await prisma.event.findUnique({ where: { id: event.id } });

  // The invariant: exactly CAPACITY seats granted, the rest rejected with 409,
  // the counter lands at 0 and never goes negative.
  expect(created).toBe(CAPACITY);
  expect(soldOut).toBe(K - CAPACITY);
  expect(held).toBe(CAPACITY);
  expect(fresh?.availableSeats).toBe(0);
});
