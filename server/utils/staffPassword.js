import bcrypt from "bcryptjs";

const DEFAULT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

/** @type {Promise<string>|null} */
let dummyPasswordHashPromise = null;

export function getBcryptRounds() {
  const raw = process.env.STAFF_BCRYPT_ROUNDS?.trim();
  if (!raw) {
    return DEFAULT_ROUNDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 4 || parsed > 15) {
    return DEFAULT_ROUNDS;
  }
  return parsed;
}

export function validateStaffPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return "Password is too long";
  }
  return null;
}

/**
 * Valid bcrypt hash used only to equalize login timing when no account exists.
 * The plaintext used to generate it is never a real credential.
 */
export function getDummyPasswordHash() {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = bcrypt.hash(
      "aarohan-login-dummy-not-a-credential",
      getBcryptRounds(),
    );
  }
  return dummyPasswordHashPromise;
}

export function isUsableLoginPassword(password) {
  return (
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

export async function hashStaffPassword(password) {
  return bcrypt.hash(password, getBcryptRounds());
}

export async function verifyStaffPassword(password, passwordHash) {
  if (typeof password !== "string" || typeof passwordHash !== "string") {
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}
