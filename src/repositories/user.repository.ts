import { prisma } from "../db/prisma";
import type { AuthProvider, Role } from "../generated/prisma/enums";

const userRepository = {
  async createUser(payload: {
    email: string;
    passwordHash: string | null;
    role?: Role;
    provider?: AuthProvider;
  }) {
    const user = await prisma.user.create({
      data: payload,
      omit: {
        passwordHash: true,
      },
    });

    return user;
  },

  async findByEmail(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    return user;
  },

  async findById(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });

    return user;
  },
};

export default userRepository;
