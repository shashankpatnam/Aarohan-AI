import { HANDOFF_CONTACT_METHODS } from "../models/Lead.js";

const CALLBACK_NOTE_MAX = 500;

/**
 * @param {Record<string, unknown>} body
 * @returns {{ errors?: string[], data?: { note: string, preferredContactMethod: string } }}
 */
export function validateGuestCallbackBody(body) {
  const errors = [];
  const allowedKeys = new Set(["preferredContactMethod", "message"]);
  for (const key of Object.keys(body ?? {})) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected field: ${key}`);
    }
  }

  const message =
    typeof body?.message === "string" ? body.message.trim() : "";
  const preferredContactMethod =
    typeof body?.preferredContactMethod === "string"
      ? body.preferredContactMethod.trim().toLowerCase()
      : "";

  if (message.length > CALLBACK_NOTE_MAX) {
    errors.push(`message must be at most ${CALLBACK_NOTE_MAX} characters`);
  }

  if (
    preferredContactMethod &&
    !HANDOFF_CONTACT_METHODS.includes(preferredContactMethod)
  ) {
    errors.push(
      `preferredContactMethod must be one of: ${HANDOFF_CONTACT_METHODS.join(", ")}`,
    );
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      note: message,
      preferredContactMethod,
    },
  };
}
