import healthController from "../controllers/health.controller";
import express from "express";

const router = express.Router();

router.get("/", healthController.getStatus);

export default router;
