import eventControllers from "../controllers/event.controller";
import bookingControllers from "../controllers/booking.controller";
import express from "express";
import validate from "../middleware/validate.middleware";
import {
  createEventSchema,
  updateEventSchema,
} from "../validators/event.validators";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/required-role.middleware";
import { Role } from "../generated/prisma/enums";

const router = express.Router();

router.get("/", eventControllers.list);
router.get("/:id", eventControllers.getById);

// Book a seat on an event — any authenticated user.
router.post("/:id/bookings", authMiddleware, bookingControllers.create);

router.post(
  "/",
  authMiddleware,
  requireRole(Role.ORGANIZER),
  validate(createEventSchema),
  eventControllers.create,
);
router.patch(
  "/:id",
  authMiddleware,
  requireRole(Role.ORGANIZER),
  validate(updateEventSchema),
  eventControllers.update,
);
router.delete(
  "/:id",
  authMiddleware,
  requireRole(Role.ORGANIZER),
  eventControllers.remove,
);

export default router;
