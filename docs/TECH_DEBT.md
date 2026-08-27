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

### Google `id_token` signature not verified

- **Decision (2026-08-23):** `loginWithGoogle` decodes the `id_token` payload without verifying
  its signature against Google's public keys.
- **Why deferred:** the token is fetched directly from Google's token endpoint over TLS in a
  server-to-server call, so the channel is already trusted — decoding is safe for this flow.
- **What it'd take:** fetch Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`, cached by
  `kid`), verify the `id_token`'s RS256 signature, and check `iss` / `aud` / `exp`. Needed if a
  token is ever accepted from a less-trusted path than the direct exchange.

### OAuth `state` not bound to the browser

- **Decision (2026-08-23):** `state` is stored server-side in Redis (single-use), not tied to the
  initiating browser.
- **Why deferred:** this blocks forged/guessed callbacks — the common CSRF case — and keeps the
  flow cookie-free.
- **What it'd take:** also set `state` in an httpOnly cookie on `/auth/google` and compare the
  callback's `state` to the cookie. Closes the remaining login-CSRF vector where an attacker
  supplies their own valid `state` + `code` to the victim.

### Rate limiting uses an in-memory store

- **Decision (2026-08-23):** `express-rate-limit` runs with its default in-memory store —
  counters live in the process.
- **Why deferred:** correct for a single instance; fine for v1.
- **What it'd take:** a shared store (`rate-limit-redis`, reusing the existing Redis) so limits
  hold across N instances — otherwise the real limit is N × the configured value.

### Readiness treats Redis as critical

- **Decision (2026-08-23):** `/ready` returns 503 if **either** Postgres or Redis is unreachable.
- **Why deferred:** matches the spec ("checks DB + Redis") and is simple.
- **What it'd take:** since Redis is optional infra (fail-open cache), fail readiness only on
  Postgres and report Redis as "degraded but ready" — so a Redis blip doesn't pull a
  still-serviceable instance out of rotation.

_(More added as the build proceeds — e.g. mock payment instead of a real processor, an
in-process scheduler vs. a real job queue. Each gets the same what / why / what-it'd-take entry.)_
