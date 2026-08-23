# Reserva — Build Progress

Milestone tracker. Each milestone lists its concrete steps and completion status. Design lives
in `[TECH_SPEC.md](./TECH_SPEC.md)`; deferred scope in `[TECH_DEBT.md](./TECH_DEBT.md)`.

**Legend:** `[x]` done · `[~]` in progress · `[ ]` not started
**Current position:** **M2 (Auth) complete** — register/login, JWT, refresh rotation, logout, and RBAC middleware all verified end-to-end. Next: M3 (Events).

---

## M1 — Project setup ✅

- [x] Bun + TypeScript (strict) + ESLint/Prettier/Husky baseline
- [x] Express app / server split (`src/app.ts`, `src/server.ts`)
- [x] Layered structure + barrel router (`src/routes`, `src/controllers`)
- [x] `/health` liveness endpoint
- [x] Fail-fast config, Zod-validated (`src/config/env.ts`)
- [x] Error pipeline: `AppError` + global error middleware + 404 catch-all (`src/errors`, `src/middleware`)
- [x] PostgreSQL via Docker Compose (`docker-compose.yml`)
- [x] Prisma 7 — `prisma-client` generator (`runtime = "bun"`) + `@prisma/adapter-pg`
- [x] `User` model + first migration (`@db.Uuid`, `@db.Timestamptz(6)`)
- [x] Prisma client singleton (`src/db/prisma.ts`)
- [x] `CLAUDE.md` updated to the real stack

---

## M2 — Auth: register/login, RBAC, refresh tokens

- [x] Password hashing via `Bun.password` (argon2id, 19 MiB / t=2) + `argonVerify`
- [x] `User` repository (`createUser`, `findByEmail`, `findById`) over the Prisma singleton
- [x] validate Zod middleware factory (register, login, refresh schemas)
- [x] `POST /api/v1/auth/register` — normalized email, 409 `EMAIL_TAKEN`, P2002 backstop
- [x] `POST /api/v1/auth/login` (enumeration-safe errors)
- [x] JWT access tokens (issue + verify)
- [x] Auth middleware: verify access token → `req.user`
- [x] RBAC: `requireRole('ORGANIZER')` middleware
- [x] `RefreshToken` model + migration (revocable, hashed)
- [x] `POST /auth/refresh` (rotate) + `POST /auth/logout` (revoke)
- [x] Mount the API under `/api/v1`
- [x] `AppError` subclasses (`NotFoundError`, `ConflictError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`)

## M3 — Events CRUD + pagination

- [x] `Event` model + migration (`capacity`, `availableSeats`, `CHECK` constraints, indexes)
- [x] Event repository + service (ownership guard)
- [x] `POST` / `PATCH` / `DELETE /events` (organizer-only)
- [x] `GET /events` + `GET /events/:id` (public)
- [x] Offset pagination (`page`/`limit` + `meta`)

## M4 — Booking core ★ (the star)

- [x] `Booking` model + migration (status enum, `holdExpiresAt`, partial unique index via raw SQL)
- [x] Naive booking implementation
- [x] Concurrency test — fire K simultaneous bookings, assert no oversell
- [x] Fix: transaction + `SELECT … FOR UPDATE` (interactive tx / `$queryRaw`)
- [x] Backstops: `CHECK (availableSeats >= 0)` + partial unique
- [x] `confirm` / `cancel` endpoints (state machine)
- [x] _(open question #2)_ atomic-update variant for comparison

## M5 — Hold-expiry background job

- [x] Scheduled sweeper cancels expired `HELD` bookings, returns seats (idempotent, lock-safe)

## M6 — Redis caching + invalidation

- [x] Redis in Docker (`Bun.redis`)
- [x] Cache `GET /events` + availability; invalidate on writes / seat changes

## M7 — OAuth2 "Sign in with Google"

- [ ] Google auth flow; link by email; `provider` field

## M8 — Hardening + observability

- [ ] Rate limiting (`/auth/*`, booking create), `helmet`, CORS, body limits
- [ ] `pino` structured logging + request id
- [ ] `/ready` (checks DB + Redis)

## M9 — Swagger / OpenAPI

- [ ] OpenAPI spec (generated from Zod) served at `/api/v1/docs`

## M10 — Docker full stack + CI + deploy

- [ ] Dockerfile for the app; full stack in `docker-compose`
- [ ] CI (lint + tests on push)
- [ ] Deploy (PaaS + managed Postgres)

---

_Update the checkboxes as steps land. M1–M4 are the core; M4 is the central feature._
