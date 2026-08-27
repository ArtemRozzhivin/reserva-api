import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { startHoldSweeper } from "./jobs/hold-sweeper";

const port = env.PORT;

app.listen(port, () => {
  logger.info({ port }, "server listening");
  startHoldSweeper();
});
