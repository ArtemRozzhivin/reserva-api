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

- v1 ships **offset/limit** pagination. It degrades on deep offsets and can skip/repeat rows
  under concurrent inserts. Planned upgrade: **cursor (keyset) pagination** on `(startsAt, id)`.

_(More added as the build proceeds — e.g. mock payment instead of a real processor, an
in-process scheduler vs. a real job queue. Each gets the same what / why / what-it'd-take entry.)_
