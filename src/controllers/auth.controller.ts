import type { RequestHandler } from "express";
import authServices from "../services/auth.service";
import { randomBytes } from "node:crypto";
import { consumeState, storeState } from "../cache/state.cache";
import { UnauthorizedError } from "../errors/app-error";

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

const refresh: RequestHandler = async (req, res) => {
  const { refreshToken } = req.body;

  const tokens = await authServices.refresh(refreshToken);

  res.status(200).json({
    success: true,
    data: tokens,
  });
};

const googleRedirect: RequestHandler = async (req, res) => {
  const state = randomBytes(16).toString("hex");

  await storeState(state);

  const url = authServices.googleRedirect(state);

  res.redirect(url);
};

const googleCallback: RequestHandler = async (req, res) => {
  const { code, state } = req.query;

  const ok = await consumeState(state as string);
  if (!ok) throw new UnauthorizedError("Invalid OAuth state");

  const result = await authServices.loginWithGoogle(code as string);
  res.status(200).json({ success: true, data: result });
};

const logout: RequestHandler = async (req, res) => {
  const { refreshToken } = req.body;

  await authServices.logout(refreshToken);

  res.status(200).json({
    success: true,
  });
};

export default {
  register,
  login,
  googleRedirect,
  googleCallback,
  refresh,
  logout,
};
