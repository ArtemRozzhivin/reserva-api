import type { RequestHandler } from "express";
import { NotFoundError } from "../errors/app-error";

export const notFoundMiddleware: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
};
