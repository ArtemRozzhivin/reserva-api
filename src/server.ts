import { app } from "./app";
import { env } from "./config/env";
const port = env.PORT;

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
