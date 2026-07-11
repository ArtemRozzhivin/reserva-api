import { prisma } from "../db/prisma";

const refreshRepository = {
  async createRefresh(payload: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }) {
    return await prisma.refreshToken.create({
      data: payload,
    });
  },
};

export default refreshRepository;
