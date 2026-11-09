import crypto from "crypto";

/**
 * Constant-time comparison for secrets of possibly different lengths.
 * @param {string} provided
 * @param {string} expected
 * @returns {boolean}
 */
export function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  if (provided.length === 0 || expected.length === 0) {
    return false;
  }

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  const maxLen = Math.max(providedBuf.length, expectedBuf.length);
  const a = Buffer.alloc(maxLen);
  const b = Buffer.alloc(maxLen);
  providedBuf.copy(a);
  expectedBuf.copy(b);

  const lengthMismatch = providedBuf.length !== expectedBuf.length;
  const contentMismatch = !crypto.timingSafeEqual(a, b);
  return !lengthMismatch && !contentMismatch;
}
