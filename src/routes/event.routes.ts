import eventControllers from "../controllers/event.controller";
import bookingControllers from "../controllers/booking.controller";
import express from "express";
import validate, { validateParams } from "../middleware/validate.middleware";
import {
  createEventSchema,
  updateEventSchema,
} from "../validators/event.validators";
import { idParamSchema } from "../validators/params.validators";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/required-role.middleware";
import { bookingLimiter } from "../middleware/rate-limit.middleware";
import { Role } from "../generated/prisma/enums";

const router = express.Router();

router.get("/", eventControllers.list);
router.get("/:id", validateParams(idParamSchema), eventControllers.getById);

// Book a seat on an event — any authenticated user.
router.post(
  "/:id/bookings",
  bookingLimiter,
  validateParams(idParamSchema),
  authMiddleware,
  bookingControllers.create,
);

router.post(
  "/",
  authMiddleware,
  requireRole(Role.ORGANIZER),
  validate(createEventSchema),
  eventControllers.create,
);
router.patch(
  "/:id",
  validateParams(idParamSchema),
  authMiddleware,
  requireRole(Role.ORGANIZER),
  validate(updateEventSchema),
  eventControllers.update,
);
router.delete(
  "/:id",
  validateParams(idParamSchema),
  authMiddleware,
  requireRole(Role.ORGANIZER),
  eventControllers.remove,
);

export default router;
