# Reserva

A booking / reservation API for event tickets. Organizers publish events with a fixed capacity;
attendees reserve seats. Its defining constraint is **concurrency-safe seat allocation** — under
a stampede of simultaneous requests for the last seat, it never oversells.

The full concurrency design is documented in [`docs/CONCURRENCY.md`](docs/CONCURRENCY.md); the
system design in [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md).

## Highlights

- **Never oversell.** Booking runs inside an interactive transaction that takes a row lock
  (`SELECT … FOR UPDATE`) on the event, with `CHECK (availableSeats >= 0)` and a partial-unique
  index as database-level backstops. Correctness is proven by a test that fires K simultaneous
  bookings at a 1-seat event and asserts no oversell.
- **Full auth.** Email/password (argon2id) and **"Sign in with Google"** (OAuth2 authorization-code
  flow), JWT access tokens, rotating revocable refresh tokens, and role-based access control.
- **Booking lifecycle.** `HELD → CONFIRMED → CANCELLED` state machine with timed holds and a
  background sweeper that reclaims expired holds and returns their seats.
- **Caching.** Redis cache-aside for event reads with write- and seat-change invalidation.
- **Hardened & observable.** helmet, CORS, body limits, rate limiting, structured logging
  (`pino`) with per-request ids, and `/health` + `/ready` probes.
- **Documented.** OpenAPI 3.1 spec generated from the Zod validators, served as Swagger UI at
  `/api/v1/docs`.

## Stack

**Runtime:** Bun · **HTTP:** Express 5 · **Database:** PostgreSQL via Prisma 7 (driver adapter) ·
**Cache:** Redis (`Bun.redis`) · **Validation:** Zod · **Containerized** with Docker & a CI
pipeline (GitHub Actions).

## Architecture

A layered design with a single direction of dependency:

```
routes/        method + path → controller     (mapping)
controllers/   HTTP I/O only                  (knows HTTP, not SQL/rules)
services/      business logic + authorization (knows neither HTTP nor SQL)
repositories/  DB access via the Prisma singleton
```

Services throw typed `AppError`s; one error middleware maps them to a consistent envelope
(`{ success, data }` / `{ success: false, error: { code, message } }`).

## Getting started

**Prerequisites:** [Bun](https://bun.com) and Docker.

```bash
# 1. Install dependencies
bun install

# 2. Start Postgres + Redis
docker compose up -d

# 3. Configure the environment
cp .env.example .env
#   then set JWT_SECRET (≥32 chars) and the GOOGLE_* credentials

# 4. Apply migrations + generate the Prisma client
bunx prisma migrate dev

# 5. Run the server
bun run dev            # watch mode  (or: bun run start)
```

The API is served under `http://localhost:3000/api/v1`, with interactive docs at
`http://localhost:3000/api/v1/docs`.

### Run the whole stack in containers

```bash
docker compose --profile full up --build
```

This builds the app image and runs it alongside Postgres and Redis (migrations applied on start).

## Testing

Integration tests drive the exported Express app in-process against a **separate** test database.

```bash
bun run db:test:migrate    # once, to create/migrate the test DB
bun run test
```

## Scripts

| Script                            | Purpose                               |
| --------------------------------- | ------------------------------------- |
| `bun run dev` / `start`           | Run the server (watch / plain)        |
| `bun run test`                    | Integration tests against the test DB |
| `bun run ts`                      | Type-check (`tsc --noEmit`)           |
| `bun run lint` / `lint:fix`       | ESLint                                |
| `bun run format` / `format:check` | Prettier                              |
| `bun run db:migrate`              | Create/apply a migration              |
| `bun run db:generate:client`      | Regenerate the Prisma client          |

## Documentation

- [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md) — data model, API, milestones
- [`docs/CONCURRENCY.md`](docs/CONCURRENCY.md) — the seat-allocation concurrency model
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploying to a PaaS with managed Postgres/Redis
- [`docs/TECH_DEBT.md`](docs/TECH_DEBT.md) — deliberate deferrals and shortcuts
