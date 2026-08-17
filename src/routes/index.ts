import express from "express";
import authRoutes from "./auth.routes";
import eventRoutes from "./event.routes";
import bookingRoutes from "./booking.routes";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/events", eventRoutes);
router.use("/bookings", bookingRoutes);

export default router;
