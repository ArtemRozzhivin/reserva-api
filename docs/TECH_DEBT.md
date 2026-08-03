# Reserva — Tech Debt & Deferred Decisions

A ledger of deliberate deferrals and known shortcuts — every place v1 takes the simpler path on
purpose. Each entry: **what**, **why deferred**, and **what it'd take** to do it properly.

---

## Deferred features (v2+)

### Multi-seat bookings (`quantity` per booking)

- **Decision (2026-06-26):** v1 is **one seat per booking**. A booking reserves exactly one
  seat; a unique `(userId, eventId)` on active bookings stops a user double-booking.
- **Why deferred:** it keeps the v1 concurrency model crisp. The decrement is always `-1`, and
  the "last seat" race is the clean canonical case. A `quantity` field turns it into a "last
  _N_ seats" race — the decrement becomes `-quantity`, you must decide a partial-fill policy
  (reject vs. grant fewer), validation grows, and the concurrency test gets harder to assert.
- **What it'd take:**
  - Add `quantity` (int, `>= 1`) to `Booking`.
  - Change the locked decrement to `-quantity`, guarded by `availableSeats >= quantity`.
  - Decide partial-fill policy — **all-or-nothing recommended** (either the full quantity is
    available or the request fails; no surprise partial bookings).
  - Revisit the `(userId, eventId)` uniqueness rule (one booking of N seats? or several
    bookings? pick one).
  - Update the concurrency test: assert `sum(granted quantity) == capacity`, not `count == capacity`.

---

## Known shortcuts (v1)

### Offset pagination

- **Decision (2026-08-03):** `GET /events` ships **offset/limit** pagination — the service maps
  `page`/`limit` to `skip = (page - 1) * limit` / `take`, and returns `meta` with
  `total` + `totalPages`.
- **Why deferred:** offset is simple, supports "jump to page N," and is perfectly fine at v1
  scale. Its two known weaknesses don't bite yet:
  - **Deep-offset cost:** `OFFSET n` makes Postgres walk and discard `n` rows before returning
    the page, so latency grows with page depth.
  - **Drift under concurrent writes:** an insert/delete while a client pages can shift rows
    across page boundaries, causing a row to repeat or be skipped.
- **What it'd take:** switch to **cursor (keyset) pagination** on `(startsAt, id)` — instead of
  `OFFSET`, filter `WHERE (startsAt, id) > (:lastStartsAt, :lastId) ORDER BY startsAt, id LIMIT n`.
  Stays fast at any depth (indexed range scan, no discarded rows) and is drift-free. Costs the
  ability to jump to an arbitrary page number, so it's the right tool for infinite scroll / very
  large tables, not for a "page 37" UI.

### Capacity updates after event creation

- **Decision (2026-08-03):** `updateEventSchema` (PATCH `/events/:id`) accepts `title`,
  `description`, `startsAt` only — **`capacity` is not editable** after creation.
- **Why deferred:** changing `capacity` means reconciling the stored `availableSeats` counter
  against existing bookings, under the same lock the booking flow uses. A naive PATCH could
  violate the `availableSeats <= capacity` invariant (e.g. shrinking capacity below seats
  already sold). Out of scope until the booking transaction (M4) exists to piggyback on.
- **What it'd take:** a dedicated, locked operation that (1) locks the event row, (2) computes
  `seatsSold = capacity - availableSeats`, (3) rejects a new capacity `< seatsSold`, and
  (4) sets `availableSeats = newCapacity - seatsSold` in the same transaction.

_(More added as the build proceeds — e.g. mock payment instead of a real processor, an
in-process scheduler vs. a real job queue. Each gets the same what / why / what-it'd-take entry.)_
