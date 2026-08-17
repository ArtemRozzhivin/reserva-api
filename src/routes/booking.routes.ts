import bookingControllers from "../controllers/booking.controller";
import express from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateParams } from "../middleware/validate.middleware";
import { idParamSchema } from "../validators/params.validators";

const router = express.Router();

// Both act on a booking the caller owns (ownership enforced in the service).
router.post(
  "/:id/confirm",
  validateParams(idParamSchema),
  authMiddleware,
  bookingControllers.confirm,
);
router.delete(
  "/:id",
  validateParams(idParamSchema),
  authMiddleware,
  bookingControllers.cancel,
);

export default router;
