# Reserva — Technical Specification (v1)

> A booking/reservation API for **event tickets**, written in TypeScript. Its defining
> constraint is **concurrency-safe seat allocation** — never sell the same seat twice. This
> document specifies the v1 data model, API surface, and concurrency strategy. Items marked
> **Open question** are still unresolved.

---

## 1. Overview & Scope

Organizers publish events with a fixed capacity; attendees reserve seats. The one rule the
whole system exists to enforce:

> **Never sell the same seat twice — even when two requests arrive in the same millisecond.**

### In scope (v1)

- **Auth:** register / login, JWT access tokens, **revocable refresh tokens**, RBAC (`ORGANIZER` vs `ATTENDEE`).
- **Events:** organizer-only writes, public reads, pagination.
- **Bookings:** `HELD → CONFIRMED` flow, **concurrency-safe seat allocation**, cancellation.
- **Hold expiry:** a background job auto-releases unpaid holds.
- **Caching:** Redis for event listings/availability, with invalidation.
- **OAuth2:** "Sign in with Google".
- **Hardening:** rate limiting, `helmet`, structured logging, `/health` + `/ready`.
- **Docs & ops:** Swagger/OpenAPI, full-stack Docker, CI, deploy.

### Out of scope (v1 → v2, see `TECH_DEBT.md`)

Real payment processing (mock it), real email (log it), a frontend, **multi-seat bookings**,
waitlists, refunds, recurring events, websockets/live seat maps, multi-currency.

---

## 2. Domain Model & Schema

### User

| field                     | type                           | notes                                |
| ------------------------- | ------------------------------ | ------------------------------------ |
| `id`                      | uuid (PK)                      |                                      |
| `email`                   | string, **unique**             | citext / lowercased                  |
| `passwordHash`            | string, **nullable**           | bcrypt; null for OAuth-only accounts |
| `role`                    | enum `ORGANIZER` \| `ATTENDEE` | default `ATTENDEE`                   |
| `provider`                | enum `LOCAL` \| `GOOGLE`       | default `LOCAL`                      |
| `createdAt` / `updatedAt` | timestamptz                    |                                      |

### Event

| field                     | type               | notes                                   |
| ------------------------- | ------------------ | --------------------------------------- |
| `id`                      | uuid (PK)          |                                         |
| `title`                   | string (1..200)    |                                         |
| `description`             | string?, max ~2000 |                                         |
| `startsAt`                | timestamptz        | must be in the future at creation       |
| `capacity`                | int, `> 0`         | the maximum; set at creation            |
| `availableSeats`          | int, `0..capacity` | **stored counter**, starts `= capacity` |
| `organizerId`             | uuid → User        | owner                                   |
| `createdAt` / `updatedAt` | timestamptz        |                                         |

**Constraints (the database is the last line of defense):**

- `CHECK (capacity > 0)`
- `CHECK (availableSeats >= 0)` — makes overselling _impossible_ at the DB.
- `CHECK (availableSeats <= capacity)`
- index on `organizerId`; index on `startsAt` (used for listing/sorting).

### Booking — _the concurrency rules live here_

| field                     | type                                      | notes                                          |
| ------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `id`                      | uuid (PK)                                 |                                                |
| `eventId`                 | uuid → Event                              |                                                |
| `userId`                  | uuid → User                               |                                                |
| `status`                  | enum `HELD` \| `CONFIRMED` \| `CANCELLED` |                                                |
| `holdExpiresAt`           | timestamptz?, set while `HELD`            | the auto-release deadline; null once confirmed |
| `createdAt` / `updatedAt` | timestamptz                               |                                                |

- **Unique active booking per user per event:** a user may hold/confirm **at most one** seat
  for a given event. Primary enforcement in the service layer (inside the booking transaction);
  DB backstop = a **partial unique index** `(userId, eventId) WHERE status IN ('HELD','CONFIRMED')`
  (allows re-booking after a cancel/expire).
  - **Note:** Prisma can't express a partial unique index in `schema.prisma`; implement it as a
    raw SQL migration.
- index on `eventId`, `userId`, and `(status, holdExpiresAt)` (scanned by the expiry job).

### Seat accounting

`availableSeats` is a **stored counter**, the single number reads trust:

- event created → `availableSeats = capacity`
- `HELD` booking created → `-1` (under lock)
- `CONFIRMED` → no change (the seat was already taken at hold time)
- `CANCELLED` / expired → `+1`

**Invariant:** `availableSeats == capacity − count(bookings WHERE status IN ('HELD','CONFIRMED'))`,
always. The lock keeps it true; the `CHECK` constraint refuses to let it become false.

### Relationships

`User (organizer) 1—N Event` · `Event 1—N Booking` · `User 1—N Booking`

---

## 3. Booking State Machine

```
   POST /events/:id/bookings           POST /bookings/:id/confirm
   (seat available, under lock)         (mock payment)
        │                                     │
        ▼                                     ▼
     ┌──────┐  confirm                   ┌───────────┐
     │ HELD │ ───────────────────────▶   │ CONFIRMED │
     └──────┘                            └───────────┘
        │   \                                  │
        │    \ cancel (owner)                  │ cancel (owner)
        │     \                                ▼
        │      \                          ┌───────────┐
        │       └────────────────────▶   │ CANCELLED │
        │  holdExpiresAt passes           └───────────┘
        │  (background job)                    ▲
        └──────────────────────────────────────┘
```

| from                      | trigger                      | to          | seat effect                       | actor    |
| ------------------------- | ---------------------------- | ----------- | --------------------------------- | -------- |
| —                         | `POST /events/:id/bookings`  | `HELD`      | `-1`                              | attendee |
| `HELD`                    | `POST /bookings/:id/confirm` | `CONFIRMED` | none                              | owner    |
| `HELD`                    | `DELETE /bookings/:id`       | `CANCELLED` | `+1`                              | owner    |
| `HELD`                    | hold-expiry job              | `CANCELLED` | `+1`                              | system   |
| `CONFIRMED`               | `DELETE /bookings/:id`       | `CANCELLED` | `+1`                              | owner    |
| `CONFIRMED` / `CANCELLED` | confirm / re-cancel          | —           | **invalid → 409 `INVALID_STATE`** | —        |

- **Hold duration:** `HOLD_DURATION_MINUTES`, config-driven, default **10**. `holdExpiresAt = now + duration`; cleared on confirm.
- Confirm checks `holdExpiresAt` is still in the future — a hold that expired mid-flight can't be confirmed (409).

---

## 4. Concurrency Rules ★ — the core feature

### The invariant to defend

`availableSeats` never goes negative; at most `capacity` seats are `HELD`+`CONFIRMED` at once;
no two concurrent requests both succeed in taking the last seat.

### The race (naive, broken)

```
A: SELECT availableSeats → 1   (looks OK)
B: SELECT availableSeats → 1   (A hasn't committed — also looks OK)
A: INSERT booking; availableSeats = 0
B: INSERT booking; availableSeats = -1   ❌ OVERSOLD
```

A transaction _alone_ doesn't fix this — it gives atomicity, not protection from the **stale read**.

### The solution — pessimistic row lock (primary)

One interactive transaction:

1. `SELECT * FROM "Event" WHERE id = $1 FOR UPDATE` — **locks the event row**. A concurrent
   booker blocks here until we commit.
2. Re-read `availableSeats`; if `0` → roll back → **409 `SOLD_OUT`**.
3. Enforce "one active booking per user" (service check).
4. `INSERT` Booking (`HELD`).
5. `UPDATE "Event" SET "availableSeats" = "availableSeats" - 1 WHERE id = $1`.
6. Commit → lock released → the blocked booker now reads the **decremented** value and is
   correctly rejected.

- **Prisma note:** there's no first-class `forUpdate()`. Use
  `prisma.$transaction(async (tx) => { ... })` and run the `FOR UPDATE` select via `tx.$queryRaw`.

### Backstops (defense in depth)

- `CHECK (availableSeats >= 0)` — the DB makes overselling impossible even if app logic is wrong.
- partial unique `(userId, eventId)` — a single user can't double-hold.

### Alternative — atomic conditional write

```sql
UPDATE "Event" SET "availableSeats" = "availableSeats" - 1
WHERE id = $1 AND "availableSeats" > 0;   -- then check rows-affected == 1
```

An optimistic-atomic alternative to the pessimistic (`FOR UPDATE`) approach; the DB serializes
the row update with no explicit lock. **Open question:** implement both for comparison, or ship
only the row-lock approach in v1?

### The proof — the concurrency test

Fire `K` simultaneous booking requests at an event with `capacity C < K`. Assert:

- exactly `C` succeed (201), `K − C` fail (409 `SOLD_OUT`),
- final `availableSeats == 0`, booking count `== C`, never negative.

Run repeatedly (the failure is probabilistic). This test is the primary correctness guarantee
for the feature.

### Implementation approach (test-first)

1. Write the concurrency test that fires `K` simultaneous bookings — it reproduces the oversell.
2. Implement the transaction + `FOR UPDATE`; the test passes.
3. Add the `CHECK` + partial-unique constraints as backstops.
4. _(optional)_ add the atomic-update variant for comparison.

---

## 5. API Surface

Base path `/api/v1`. JSON in/out. `Authorization: Bearer <accessToken>`.

### Auth

| method | path                    | auth          | role | success                            | errors                 |
| ------ | ----------------------- | ------------- | ---- | ---------------------------------- | ---------------------- |
| POST   | `/auth/register`        | —             | —    | 201 user + tokens                  | 400, 409 `EMAIL_TAKEN` |
| POST   | `/auth/login`           | —             | —    | 200 tokens                         | 400, 401               |
| POST   | `/auth/refresh`         | refresh token | —    | 200 new access (+ rotated refresh) | 401                    |
| POST   | `/auth/logout`          | refresh token | —    | 204                                | 401                    |
| GET    | `/auth/google`          | —             | —    | 302 → Google                       | —                      |
| GET    | `/auth/google/callback` | —             | —    | 200 tokens                         | 401                    |

### Events

| method | path          | auth     | role                | success                      | errors             |
| ------ | ------------- | -------- | ------------------- | ---------------------------- | ------------------ |
| GET    | `/events`     | optional | —                   | 200 list (paginated, public) | 400                |
| GET    | `/events/:id` | optional | —                   | 200                          | 404                |
| POST   | `/events`     | required | `ORGANIZER`         | 201                          | 400, 401, 403      |
| PATCH  | `/events/:id` | required | `ORGANIZER` (owner) | 200                          | 400, 401, 403, 404 |
| DELETE | `/events/:id` | required | `ORGANIZER` (owner) | 204                          | 401, 403, 404      |

- Editing `capacity` after bookings exist: may not drop below seats already taken
  (`capacity >= capacity - availableSeats`). Adjust `availableSeats` by the delta under lock.

### Bookings

| method | path                    | auth     | role  | success         | errors                                           |
| ------ | ----------------------- | -------- | ----- | --------------- | ------------------------------------------------ |
| POST   | `/events/:id/bookings`  | required | any   | 201 `HELD`      | 400, 401, 404, 409 `SOLD_OUT` / `ALREADY_BOOKED` |
| GET    | `/bookings`             | required | own   | 200 (paginated) | 401                                              |
| GET    | `/bookings/:id`         | required | owner | 200             | 401, 403, 404                                    |
| POST   | `/bookings/:id/confirm` | required | owner | 200 `CONFIRMED` | 401, 403, 404, 409 `INVALID_STATE`               |
| DELETE | `/bookings/:id`         | required | owner | 204 `CANCELLED` | 401, 403, 404, 409 `INVALID_STATE`               |

- Booking is open to **any authenticated user** (an `ORGANIZER` may also book, including on their
  own events); only _creating_ events is role-gated.

---

## 6. Response Envelope & Error Codes

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { /* pagination, optional */ } }
// error
{ "success": false, "error": { "code": "MACHINE_CODE", "message": "human-readable" } }
```

| code               | HTTP | when                                             |
| ------------------ | ---- | ------------------------------------------------ |
| `VALIDATION_ERROR` | 400  | bad request shape (Zod)                          |
| `UNAUTHENTICATED`  | 401  | missing/invalid token                            |
| `FORBIDDEN`        | 403  | known identity, not allowed                      |
| `NOT_FOUND`        | 404  | resource missing                                 |
| `EMAIL_TAKEN`      | 409  | register conflict                                |
| `SOLD_OUT`         | 409  | no seats left                                    |
| `ALREADY_BOOKED`   | 409  | user already has an active booking for the event |
| `INVALID_STATE`    | 409  | illegal state-machine transition                 |
| `RATE_LIMITED`     | 429  | throttled                                        |
| `INTERNAL`         | 500  | unexpected (never leak internals)                |

Domain errors are `AppError` subclasses (`statusCode` + `code`); services `throw`, never touch
`res`. **One** global error middleware (4-arg) translates to the envelope.

- **Cross-user access returns 403** (not 404). The 404-hides-existence alternative is a noted
  trade-off; v1 uses 403.

---

## 7. Validation (Zod)

Validated at the edge by a `validate(schema)` middleware factory (runs before controllers).
`.strict()` everywhere (mass-assignment protection). `z.infer<typeof schema>` → TS types, so
validation and types never drift.

- `register`: `email` (email), `password` (min 8 + complexity).
- `login`: `email`, `password` present (no complexity check — correctness is bcrypt's job).
- `createEvent`: `title` 1..200, `startsAt` ISO + future, `capacity` int 1..N, `description?`.
- `updateEvent`: explicit partial **without defaults** (a `.partial()` of create would re-inject defaults).
- pagination query: `limit` 1..100 (default 20), `page`.

---

## 8. RBAC Matrix

| action                               | `ATTENDEE` | `ORGANIZER` |
| ------------------------------------ | :--------: | :---------: |
| browse / read events                 |     ✓      |      ✓      |
| create / edit / delete **own** event |     ✗      |      ✓      |
| book a seat                          |     ✓      |      ✓      |
| confirm / cancel **own** booking     |     ✓      |      ✓      |

- Coarse gate: `requireRole('ORGANIZER')` middleware for the role check.
- Fine gate: **ownership in the service layer** (transport-agnostic). Guard pattern: fetch →
  404 if missing → compare token `userId` vs row owner → 403. _Identity from the token,
  ownership from the DB — never trust the request body for either._

---

## 9. Pagination

- v1 uses **offset/limit** (`?page=&limit=`, `total` in `meta`). Its known weaknesses
  (deep-offset cost, drift under concurrent inserts) make **cursor pagination** (keyset on
  `(startsAt, id)`) the planned upgrade — tracked in `TECH_DEBT.md`.

---

## 10. Non-functional (by milestone)

- **Caching (M6):** cache-aside in Redis for `GET /events` and availability; invalidate on event
  create/update and on any booking seat change.
- **Background jobs (M5):** a scheduled sweeper cancels `HELD` bookings past `holdExpiresAt` and
  returns their seats. Start with `node-cron`/interval; `BullMQ` is the real-queue upgrade. Must
  be **idempotent** and concurrency-safe (it also takes the row lock).
- **Rate limiting (M8):** `express-rate-limit` on `/auth/login`, `/auth/register`, and booking create.
- **Security (M8):** `helmet`, CORS allow-list, body-size limits, never log secrets/tokens.
- **Observability (M8):** `pino` structured logs + per-request id; `/health` (liveness),
  `/ready` (checks DB + Redis).
- **OAuth (M7):** Google via `openid-client`/`arctic`; link to `User` by email; `provider` field.

---

## 11. Build Milestones

| #        | milestone                                                                                                               | focus                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **M1**   | Setup: TS + Express + Prisma + Postgres (Docker), layered skeleton, config that fails fast, error middleware, `/health` | project structure, TS, Prisma      |
| **M2**   | Auth: register/login (bcrypt+JWT), RBAC roles, **revocable refresh tokens**                                             | RBAC, refresh tokens               |
| **M3**   | Events CRUD (organizer writes, public reads) + pagination                                                               | RBAC in practice, pagination       |
| **M4 ★** | **Booking core:** concurrency-safe seat allocation (transaction + `FOR UPDATE`, constraint backstops, concurrency test) | transactions, locking, isolation   |
| **M5**   | Hold-expiry background job                                                                                              | scheduled work outside the request |
| **M6**   | Redis caching + invalidation                                                                                            | caching, invalidation              |
| **M7**   | OAuth2 "Sign in with Google"                                                                                            | delegated auth                     |
| **M8**   | Hardening + observability (rate limit, helmet, pino, `/ready`)                                                          | production-readiness               |
| **M9**   | Swagger/OpenAPI (generated from Zod)                                                                                    | consumer docs                      |
| **M10**  | Dockerize full stack + CI + deploy                                                                                      | ship it                            |

M1–M4 are the core; **M4 (concurrency-safe booking) is the central feature.** M5–M10 add the
production concerns.
