import bookingControllers from "../controllers/booking.controller";
import express from "express";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// Both act on a booking the caller owns (ownership enforced in the service).
router.post("/:id/confirm", authMiddleware, bookingControllers.confirm);
router.delete("/:id", authMiddleware, bookingControllers.cancel);

export default router;
