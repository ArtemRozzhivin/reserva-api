import type { RequestHandler } from "express";
import { safeParse, type ZodType } from "zod";
import { ValidationError } from "../errors/app-error";

const validate =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = safeParse(schema, req.body);

    if (!result.success) {
      const firstErrorMessage = result.error.issues[0]?.message;
      throw new ValidationError(firstErrorMessage);
    } else {
      req.body = result.data;
      next();
    }
  };

export default validate;
