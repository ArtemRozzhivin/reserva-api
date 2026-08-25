import { redis } from "./redis";

export const storeState = async (state: string) => {
  await redis.set("oauth:state:" + state, "1", "EX", 300);
};

export const consumeState = async (state: string) => {
  const key = "oauth:state:" + state;

  const existed = await redis.del(key);

  return existed === 1;
};
