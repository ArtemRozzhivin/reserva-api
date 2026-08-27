import { env } from "../config/env";
import { logger } from "../config/logger";
import bookingService from "../services/booking.service";

// The "when" half of the sweeper. The "what" (sweepExpiredHolds) lives in the
// service so it can be called directly from tests without a running timer.
//
// Started from server.ts, never app.ts — importing `app` in tests must not spawn
// a background timer.

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startHoldSweeper() {
  if (timer) return; // guard against a double start

  timer = setInterval(async () => {
    // Skip this tick if the previous sweep is still in flight, so slow runs
    // never overlap and double-process the same batch.
    if (running) return;
    running = true;

    try {
      const released = await bookingService.sweepExpiredHolds();
      if (released > 0) {
        logger.info({ released }, "hold-sweeper released expired holds");
      }
    } catch (error) {
      // A failed sweep must not crash the process; the next tick retries
      // (the operation is idempotent).
      logger.error({ err: error }, "hold-sweeper sweep failed");
    } finally {
      running = false;
    }
  }, env.HOLD_SWEEP_INTERVAL_MS);

  // Don't let the sweeper alone keep the process alive.
  timer.unref?.();
}

export function stopHoldSweeper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
