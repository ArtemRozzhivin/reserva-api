import authControllers from "../controllers/auth.controller";
import express from "express";
import validate from "../middleware/validate.middleware";
import { registerSchema } from "../validators/auth.validators";

const router = express.Router();

router.post("/register", validate(registerSchema), authControllers.register);

export default router;
