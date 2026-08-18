import { app } from "./app";
import { env } from "./config/env";
import { startHoldSweeper } from "./jobs/hold-sweeper";

const port = env.PORT;

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
  startHoldSweeper();
});
