import crypto from "crypto";

const TOKEN_BYTE_LENGTH = 32;

/**
 * @returns {string} Raw session token (return to client once only).
 */
export function generateGuestSessionToken() {
  return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

/**
 * @param {string} token
 * @returns {string} Hex-encoded SHA-256 digest for storage.
 */
export function hashGuestSessionToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of raw token against stored hash.
 * @param {string} token
 * @param {string} storedHashHex
 * @returns {boolean}
 */
export function verifyGuestSessionToken(token, storedHashHex) {
  if (typeof token !== "string" || typeof storedHashHex !== "string") {
    return false;
  }
  if (token.length === 0 || storedHashHex.length === 0) {
    return false;
  }

  const computedHex = hashGuestSessionToken(token);
  if (computedHex.length !== storedHashHex.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(computedHex, "utf8"),
    Buffer.from(storedHashHex, "utf8"),
  );
}
