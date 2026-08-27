import express, { type RequestHandler } from "express";
import swaggerUi from "swagger-ui-express";
import authRoutes from "./auth.routes";
import eventRoutes from "./event.routes";
import bookingRoutes from "./booking.routes";
import { authLimiter } from "../middleware/rate-limit.middleware";
import { openApiDocument } from "../docs/openapi";

const router = express.Router();

// Swagger UI ships inline scripts/styles that helmet's strict CSP would block,
// so relax the policy on the docs route only (nothing else is affected).
const relaxCspForDocs: RequestHandler = (_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
  );
  next();
};

router.get("/docs.json", (_req, res) => {
  res.json(openApiDocument);
});
router.use(
  "/docs",
  relaxCspForDocs,
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument),
);

router.use("/auth", authLimiter, authRoutes);
router.use("/events", eventRoutes);
router.use("/bookings", bookingRoutes);

export default router;
