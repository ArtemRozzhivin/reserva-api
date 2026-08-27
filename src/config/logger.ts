import pino from "pino";
import { env } from "./env";

// One structured (JSON) logger for the process. Silent under tests so the suite
// output stays clean; level is config-driven everywhere else.
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
});
