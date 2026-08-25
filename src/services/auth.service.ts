import { ConflictError, UnauthorizedError } from "../errors/app-error";
import { Prisma } from "../generated/prisma/client";
import type { User } from "../generated/prisma/client";
import refreshRepository from "../repositories/refresh.repository";
import userRepository from "../repositories/user.repository";
import { signToken } from "../utils/access.token";
import { argonHash, argonVerify } from "../utils/hash";
import {
  generateRerfeshToken,
  hashRefreshToken,
  refreshTokenTtlMs,
} from "../utils/refresh.token";
import { env } from "../config/env";

// Google's responses cross an untyped network boundary, so we declare the
// contract ourselves from Google's docs.
type GoogleTokenResponse = {
  id_token: string;
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

type GoogleIdTokenPayload = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
};

const buildGoogleAuthUrl = (state: string) => {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

async function issueSession(user: Pick<User, "id" | "email" | "role">) {
  const accessToken = signToken(user as User);
  const rawRefreshToken = generateRerfeshToken();

  await refreshRepository.createRefresh({
    tokenHash: hashRefreshToken(rawRefreshToken),
    userId: user.id,
    expiresAt: refreshTokenTtlMs(),
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

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

    const { passwordHash: _passwordHash, ...spread } = existingUser;

    return { user: spread, ...(await issueSession(existingUser)) };
  },

  googleRedirect(state: string) {
    return buildGoogleAuthUrl(state);
  },

  async loginWithGoogle(code: string) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const { id_token } = (await res.json()) as GoogleTokenResponse;

    const payloadPart = id_token.split(".")[1];
    if (!payloadPart) {
      throw new UnauthorizedError("Invalid Google token");
    }

    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString(),
    ) as GoogleIdTokenPayload;

    if (!payload.email_verified) {
      throw new UnauthorizedError("Google email not verified");
    }
    const email = payload.email.trim().toLowerCase();

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      const { passwordHash: _passwordHash, ...safeUser } = existing;
      return { user: safeUser, ...(await issueSession(existing)) };
    }

    const created = await userRepository.createUser({
      email,
      provider: "GOOGLE",
      passwordHash: null,
    });

    return { user: created, ...(await issueSession(created)) };
  },

  async refresh(rawRefreshToken: string) {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const stored = await refreshRepository.findByToken(tokenHash);

    // Unknown, expired, or already-revoked tokens are all rejected the same way.
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedError();
    }

    const user = await userRepository.findById(stored.userId);
    if (!user) {
      throw new UnauthorizedError();
    }

    // Rotate: the presented token is single-use — revoke it, then issue a fresh pair.
    await refreshRepository.revokeRefresh({ tokenHash });

    const accessToken = signToken(user);
    const newRawRefreshToken = generateRerfeshToken();

    await refreshRepository.createRefresh({
      tokenHash: hashRefreshToken(newRawRefreshToken),
      userId: user.id,
      expiresAt: refreshTokenTtlMs(),
    });

    return { accessToken, refreshToken: newRawRefreshToken };
  },

  async logout(rawRefreshToken: string) {
    const tokenHash = hashRefreshToken(rawRefreshToken);

    try {
      await refreshRepository.revokeRefresh({ tokenHash });
    } catch (err) {
      // P2025 = row to update not found. Logout is idempotent, so a token that
      // was never issued / already gone is a no-op, not an error.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        return;
      }
      throw err;
    }
  },
};

export default authServices;
