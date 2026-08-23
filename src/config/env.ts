import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  ARGONID_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGONID_MEMORY_COST: z.coerce.number().int().positive().default(19456),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("1h"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  BOOKING_HOLD_MINUTES: z.coerce.number().int().positive().default(10),
  HOLD_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  REDIS_TTL: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
