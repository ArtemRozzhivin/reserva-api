import { ConflictError } from "../errors/app-error";
import { Prisma } from "../generated/prisma/client";
import userRepository from "../repositories/user.repository";
import { argonHash } from "../utils/hash";

const authServices = {
  async register(data: { email: string; password: string }) {
    const { email, password } = data;

    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError("Email is already registered", "EMAIL_TAKEN");
    }

    const passwordHash = await argonHash(password);

    try {
      return await userRepository.createUser({ email, passwordHash });
    } catch (err) {
      // Unique-constraint backstop for a race between the check above and the insert.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictError("Email is already registered", "EMAIL_TAKEN");
      }
      throw err;
    }
  },
};

export default authServices;
