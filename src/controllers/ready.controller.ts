import type { RequestHandler } from "express";
import { prisma } from "../db/prisma";
import { redis } from "../cache/redis";

// Readiness probe: are the critical dependencies reachable *right now*? Unlike
// /health (liveness = "the process is up"), this tells a load balancer/orchestrator
// whether this instance is fit to receive traffic yet. 503 = don't route to me.
const getReadiness: RequestHandler = async (_req, res) => {
  const checks = { db: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    // leave db: false
  }

  try {
    await redis.send("PING", []);
    checks.redis = true;
  } catch {
    // leave redis: false
  }

  const ready = checks.db && checks.redis;
  res.status(ready ? 200 : 503).json({ success: ready, data: { checks } });
};

export default { getReadiness };
