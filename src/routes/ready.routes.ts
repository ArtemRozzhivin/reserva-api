import readyController from "../controllers/ready.controller";
import express from "express";

const router = express.Router();

router.get("/", readyController.getReadiness);

export default router;
