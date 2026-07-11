import { ConflictError, UnauthorizedError } from "../errors/app-error";
import { Prisma } from "../generated/prisma/client";
import refreshRepository from "../repositories/refresh.repository";
import userRepository from "../repositories/user.repository";
import { signToken } from "../utils/access.token";
import { argonHash, argonVerify } from "../utils/hash";
import {
  generateRerfeshToken,
  hashRefreshToken,
  refreshTokenTtlMs,
} from "../utils/refresh.token";

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

  async login(data: { email: string; password: string }) {
    const { email, password } = data;

    const existingUser = await userRepository.findByEmail(email);

    if (!existingUser) {
      throw new UnauthorizedError("Invalid email or password");
    }

    if (!existingUser.passwordHash) {
      throw new UnauthorizedError();
    }

    const isPasswordRight = await argonVerify(
      password,
      existingUser.passwordHash,
    );

    if (!isPasswordRight) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const acessToken = signToken(existingUser);
    const rawRefreshToken = generateRerfeshToken();
    const refreshTokenHash = hashRefreshToken(rawRefreshToken);

    await refreshRepository.createRefresh({
      tokenHash: refreshTokenHash,
      userId: existingUser.id,
      expiresAt: refreshTokenTtlMs(),
    });

    const { passwordHash: _passwordHash, ...spread } = existingUser;

    return {
      user: spread,
      acessToken: acessToken,
      refreshToken: rawRefreshToken,
    };
  },
};

export default authServices;
