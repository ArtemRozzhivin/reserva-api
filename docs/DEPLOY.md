# Deploying Reserva

Reserva ships as a single Docker image plus two managed backing services. This guide covers the
deployment model, the environment it needs, and a concrete walkthrough on a PaaS.

## The model

```
        ┌──────────────────────┐
        │   PaaS web service   │   runs the Docker image (Dockerfile)
        │   reserva-api        │   listens on $PORT, serves /api/v1
        └──────────┬───────────┘
                   │ DATABASE_URL / REDIS_URL (injected as env)
        ┌──────────┴───────────┐
        │  managed Postgres    │  the source of truth (durable)
        │  managed Redis       │  cache only (disposable)
        └──────────────────────┘
```

Three rules that shape everything below:

1. **Config comes from the environment, never the image.** The image is built once and is
   identical across environments; all secrets/URLs are injected at runtime. `docker-compose.yml`
   is for local full-stack testing only — it is **not** used in production.
2. **Postgres is durable; Redis is disposable.** Use a managed Postgres with backups. Redis can be
   the platform's smallest cache tier — losing it only costs a cold cache.
3. **Migrations run on deploy, not at image build.** Apply committed migrations with
   `bunx prisma migrate deploy` as a release/pre-deploy step (never `migrate dev`).

## Environment variables

| Variable                                                                                      | Value in production                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                    | `production`                                                                          |
| `PORT`                                                                                        | provided by the platform (the app reads it)                                           |
| `DATABASE_URL`                                                                                | the **managed Postgres** connection string                                            |
| `REDIS_URL`                                                                                   | the **managed Redis** connection string                                               |
| `JWT_SECRET`                                                                                  | a fresh ≥32-char random secret (`openssl rand -hex 32`) — **never reuse the dev one** |
| `JWT_EXPIRES_IN`                                                                              | e.g. `1h`                                                                             |
| `REFRESH_TOKEN_TTL_DAYS`                                                                      | e.g. `7`                                                                              |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                                                   | from Google Cloud Console                                                             |
| `GOOGLE_REDIRECT_URI`                                                                         | **your production callback URL** (see OAuth note below)                               |
| `CORS_ORIGIN`                                                                                 | your frontend origin(s) — **not** `*` in production                                   |
| `BOOKING_HOLD_MINUTES`, `HOLD_SWEEP_INTERVAL_MS`, `REDIS_TTL`, `JSON_BODY_LIMIT`, `LOG_LEVEL` | tune or leave defaults                                                                |

Secrets live in the platform's secret store, **never** in git.

## Walkthrough (Render as the example)

The steps are the same shape on Railway / Fly.io — only the UI differs.

1. **Provision data services:** create a managed **PostgreSQL** and a managed **Redis / Key Value**
   instance. Copy their connection strings.
2. **Create a web service** from this repo, choosing **Docker** as the runtime (it uses the
   `Dockerfile`). Set the health check path to `/health`.
3. **Set env vars** from the table above. Wire `DATABASE_URL`/`REDIS_URL` to the two services;
   generate a fresh `JWT_SECRET`; paste the Google credentials.
4. **Run migrations on each deploy** — set the pre-deploy / release command to:
   ```
   bunx prisma migrate deploy
   ```
5. **Deploy.** The platform builds the image, runs the release command (migrations), then starts
   the container (`CMD ["bun", "run", "src/server.ts"]`).

A Render blueprint (`render.yaml`) can codify all of this — a web service (Docker), a Postgres
database, and a Key Value instance, with `DATABASE_URL`/`REDIS_URL` wired via `fromDatabase` /
`fromService`, `JWT_SECRET` via `generateValue: true`, the Google vars marked `sync: false` (set
in the dashboard), and `preDeployCommand: bunx prisma migrate deploy`. Verify field names against
current Render docs before committing it.

## Google OAuth in production (don't skip)

The Google login flow only works if the callback URL matches on both sides:

1. In **Google Cloud Console → Credentials → your OAuth client**, add the production redirect URI
   to the **Authorized redirect URIs** list, e.g. `https://api.yourdomain.com/api/v1/auth/google/callback`.
2. Set `GOOGLE_REDIRECT_URI` in the platform to that **exact** URL.

A mismatch produces Google's `redirect_uri_mismatch` error.

## Verify

After the first deploy:

```
curl https://<your-app>/health     # 200 — process is up
curl https://<your-app>/ready      # 200 with {db:true, redis:true} — deps reachable
```

Open `https://<your-app>/api/v1/docs` to confirm the API and Swagger UI are live.

## Production hardening checklist

Before real traffic, revisit the deferred items in [`TECH_DEBT.md`](./TECH_DEBT.md):

- **Rate limiting** → move to the Redis store so limits hold across multiple instances.
- **CORS** → replace `*` with an explicit allow-list of your frontend origin(s).
- **OAuth `id_token`** → verify the signature against Google's JWKS.
- **OAuth `state`** → bind it to the browser via an httpOnly cookie.
- **Readiness** → decide whether a Redis outage should fail `/ready` (it currently does).
- **Secrets** → confirm nothing sensitive is in git; rotate the dev `JWT_SECRET`.
