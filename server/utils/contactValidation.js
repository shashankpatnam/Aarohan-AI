const NAME_MAX_LENGTH = 120;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

/**
 * @param {string} phone
 * @returns {number}
 */
export function countPhoneDigits(phone) {
  return (phone.match(/\d/g) ?? []).length;
}

/**
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidContactPhone(phone) {
  if (typeof phone !== "string" || !phone.trim()) {
    return false;
  }
  const trimmed = phone.trim();
  if (trimmed.length > 40) {
    return false;
  }
  if (!/^[\d\s+\-().]+$/.test(trimmed)) {
    return false;
  }
  const digits = countPhoneDigits(trimmed);
  return digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS;
}

/**
 * @param {string} email
 * @returns {boolean}
 */
export function isValidContactEmail(email) {
  if (typeof email !== "string" || !email.trim()) {
    return false;
  }
  const trimmed = email.trim();
  if (trimmed.length > 254) {
    return false;
  }
  return EMAIL_PATTERN.test(trimmed);
}

const CONTACT_ALLOWED_KEYS = new Set(["name", "phone", "email"]);

/**
 * Validates guest contact capture body. Unexpected and protected fields are rejected.
 * @param {Record<string, unknown>} body
 * @returns {{ errors?: string[], data?: { name: string, phone: string, email: string } }}
 */
export function validateGuestContactBody(body) {
  const errors = [];
  for (const key of Object.keys(body ?? {})) {
    if (!CONTACT_ALLOWED_KEYS.has(key)) {
      errors.push(`Unexpected field: ${key}`);
    }
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (!name) {
    errors.push("name is required");
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.push(`name must be at most ${NAME_MAX_LENGTH} characters`);
  }

  if (!phone && !email) {
    errors.push("phone or email is required");
  }

  if (phone && !isValidContactPhone(phone)) {
    errors.push(
      "phone must contain 7–15 digits and only use numbers, spaces, +, -, ( )",
    );
  }

  if (email && !isValidContactEmail(email)) {
    errors.push("email must be a valid email address");
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      name,
      phone,
      email,
    },
  };
}
