import authControllers from "../controllers/auth.controller";
import express from "express";
import validate from "../middleware/validate.middleware";
import {
  loginScema,
  refreshSchema,
  registerSchema,
} from "../validators/auth.validators";

const router = express.Router();

router.post("/register", validate(registerSchema), authControllers.register);
router.post("/login", validate(loginScema), authControllers.login);
router.post("/refresh", validate(refreshSchema), authControllers.refresh);

router.get("/google", authControllers.googleRedirect);
router.get("/google/callback", authControllers.googleCallback);

router.post("/logout", validate(refreshSchema), authControllers.logout);

export default router;
