import type { RequestHandler } from "express";
import authServices from "../services/auth.service";

const register: RequestHandler = async (req, res) => {
  const { email, password } = req.body;

  const user = await authServices.register({ email, password });

  res.status(201).json({
    success: true,
    data: user,
  });
};

const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body;

  const user = await authServices.login({ email, password });

  res.status(200).json({
    success: true,
    data: user,
  });
};

export default { register, login };
