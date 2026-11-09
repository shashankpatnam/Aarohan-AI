import jwt from "jsonwebtoken";

export const STAFF_TOKEN_TYP = "staff";
export const STAFF_TOKEN_EXPIRES_IN = "8h";
export const STAFF_JWT_ALGORITHM = "HS256";
const MIN_SECRET_LENGTH = 32;

export function getStaffJwtSecret() {
  const secret = process.env.STAFF_JWT_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return null;
  }
  return secret;
}

/**
 * @param {{ _id: unknown, tokenVersion?: number }} staffUser
 * @param {import("jsonwebtoken").SignOptions} [signOptions]
 * @returns {string}
 */
export function signStaffToken(staffUser, signOptions = {}) {
  const secret = getStaffJwtSecret();
  if (!secret) {
    throw new Error("STAFF_JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      typ: STAFF_TOKEN_TYP,
      tv: staffUser.tokenVersion ?? 0,
    },
    secret,
    {
      subject: String(staffUser._id),
      expiresIn: STAFF_TOKEN_EXPIRES_IN,
      ...signOptions,
      algorithm: STAFF_JWT_ALGORITHM,
    },
  );
}

/**
 * @param {string} token
 * @returns {{ sub: string, tv: number } | null}
 */
export function verifyStaffToken(token) {
  const secret = getStaffJwtSecret();
  if (!secret || typeof token !== "string" || token.length === 0) {
    return null;
  }

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: [STAFF_JWT_ALGORITHM],
    });
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (payload.typ !== STAFF_TOKEN_TYP) {
      return null;
    }
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    const tv = typeof payload.tv === "number" ? payload.tv : 0;
    return { sub: payload.sub, tv };
  } catch {
    return null;
  }
}
