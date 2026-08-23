import { RedisClient } from "bun";
import { env } from "../config/env";

const globalForRedis = globalThis as unknown as { redis?: RedisClient };

export const redis = globalForRedis.redis ?? new RedisClient(env.REDIS_URL);

if (env.NODE_ENV !== "production") globalForRedis.redis = redis;
