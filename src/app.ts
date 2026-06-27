import express from "express";
import routes from "./routes";
import { errorMiddleware } from "./middleware/error.middleware";
import { notFoundMiddleware } from "./middleware/not-found.middleware";

export const app = express();

app.use(express.json());

app.use("/", routes);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
