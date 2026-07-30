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

  async findByToken(tokenHash: string) {
    return await prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  async revokeRefresh(payload: { tokenHash: string }) {
    return await prisma.refreshToken.update({
      where: { tokenHash: payload.tokenHash },
      data: { revokedAt: new Date() },
    });
  },
};

export default refreshRepository;
