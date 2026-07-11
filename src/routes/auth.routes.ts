import authControllers from "../controllers/auth.controller";
import express from "express";
import validate from "../middleware/validate.middleware";
import { loginScema, registerSchema } from "../validators/auth.validators";

const router = express.Router();

router.post("/register", validate(registerSchema), authControllers.register);
router.post("/login", validate(loginScema), authControllers.login);

export default router;
