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

// Validates route params (e.g. a UUID `:id`). No reassignment — params are only
// checked, so a malformed id fails fast as 400 instead of reaching the DB.
export const validateParams =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = safeParse(schema, req.params);

    if (!result.success) {
      throw new ValidationError(result.error.issues[0]?.message);
    }

    next();
  };

export default validate;
