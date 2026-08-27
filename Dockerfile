# ---- build: install deps + generate the Prisma client ----
FROM oven/bun:1 AS build
WORKDIR /app

# Copy manifests first so `bun install` is cached unless deps actually change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the source and generate the Prisma client. The generated
# client (src/generated/prisma) is gitignored, so it must be created here.
COPY . .

# `prisma generate` reads DATABASE_URL via prisma.config.ts. A throwaway value
# is enough — generating the client never connects to a database — and the real
# URL comes from the host at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN bunx prisma generate

# ---- runtime: a smaller image that just runs the server ----
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Bring over the fully-installed app (deps + generated Prisma client) from build.
COPY --from=build /app ./

# Run as the non-root `bun` user the base image provides.
USER bun

EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
