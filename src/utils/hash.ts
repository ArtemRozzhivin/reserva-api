import { env } from "../config/env";

export const argonHash = async (password: string) => {
  return await Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: env.ARGONID_MEMORY_COST,
    timeCost: env.ARGONID_TIME_COST,
  });
};

export const argonVerify = async (password: string, hash: string) => {
  return await Bun.password.verify(password, hash);
};
