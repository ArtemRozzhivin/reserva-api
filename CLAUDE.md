# Reserva

A booking/reservation API for event tickets. Defining constraint: **concurrency-safe seat
allocation** (never oversell). Full design in `docs/TECH_SPEC.md`; deferred decisions in
`docs/TECH_DEBT.md`.

## Runtime & tooling — use Bun

- Run the server with `bun run src/server.ts` (never `node`/`ts-node`). Imports may be
  extensionless — Bun resolves them.
- `bun install` / `bun add` — not npm/yarn/pnpm.
- `bun run <script>` for package scripts; `bunx <pkg>` instead of `npx`.
- `bun test` for tests — not jest/vitest.
- Bun auto-loads `.env` for the app, so **application code never uses `dotenv`**.
  - One exception: the Prisma CLI runs under Node and does not auto-load `.env`, so
    `prisma.config.ts` imports `dotenv/config`. That is the only place `dotenv` appears.
- Prefer Bun built-ins: `Bun.password` for hashing (bcrypt/argon2 — not the `bcrypt` npm
  package), `Bun.redis` for Redis (not `ioredis`), `Bun.file` over `node:fs`.

## Stack

- **Runtime / platform:** Bun. **HTTP framework:** Express 5 (chosen for its middleware
  ecosystem). Bun is the platform; Express handles routing, middleware, request/response.
  We do **not** use `Bun.serve()`.
- **Database:** PostgreSQL, run via Docker Compose (`docker compose up -d`).
- **ORM:** Prisma 7 — the `prisma-client` generator (ESM, `runtime = "bun"`, output to
  `src/generated/prisma`) with the `@prisma/adapter-pg` driver adapter. Do **not** use raw
  `pg`, `postgres.js`, or `Bun.sql` directly — all DB access goes through Prisma.
- **Validation:** Zod (also the source of runtime types via `z.infer`).

## Architecture

Layered, single direction of dependency:

```
routes/        method + path → controller           (mapping)
controllers/   HTTP I/O only                         (knows HTTP, not SQL/rules)
services/      business logic + authorization        (knows neither HTTP nor SQL)
repositories/  DB access via the Prisma singleton    (knows the DB, not HTTP)
```

- **Prisma client:** one singleton in `src/db/prisma.ts`. Never construct `PrismaClient`
  elsewhere; repositories import `prisma` from there.
- **Config:** validated once at boot in `src/config/env.ts`; fails fast on misconfiguration.
  Import typed values from it — never read `process.env` directly elsewhere.
- **Errors:** services `throw` `AppError` subclasses (`src/errors/`); one global error
  middleware maps them to the response envelope. Nothing outside the HTTP layer touches `res`.
- **Response envelope:** `{ success: true, data }` / `{ success: false, error: { code, message } }`.

## Database & migrations

- Schema in `prisma/schema.prisma`; connection string in `DATABASE_URL`.
- `bunx prisma migrate dev --name <name>` to create/apply a migration; `bunx prisma generate`
  to regenerate the client. Commit `prisma/migrations/`. Never edit an applied, shared
  migration — add a new one instead.
- Instants use `@db.Timestamptz(6)`; ids use `@db.Uuid`.

## Testing

`bun test`. A separate test database; integration tests drive the exported `app` in-process.
