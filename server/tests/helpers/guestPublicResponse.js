import assert from "node:assert/strict";

export const GUEST_INTERNAL_RESPONSE_KEYS = [
  "handoffReason",
  "handoffAiReason",
  "chatFailureReason",
  "leadId",
  "tokenHash",
  "executive",
  "handoffStatus",
  "handoffType",
  "passwordHash",
  "tokenVersion",
  "bootstrapSlot",
  "qualification",
  "buyerSummary",
  "preferredLanguage",
  "role",
  "source",
  "status",
  "statusBeforeVisit",
];

const INTERNAL_VALUE_MARKERS = [
  "no_approved_facts",
  "model_unavailable",
];

/**
 * Recursively asserts that a public JSON payload does not contain CRM-internal keys.
 * @param {unknown} value
 * @param {string} [path]
 */
export function assertNoGuestInternalFields(value, path = "$") {
  if (value == null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoGuestInternalFields(item, `${path}[${index}]`);
    });
    return;
  }

  if (typeof value !== "object") {
    if (typeof value === "string") {
      for (const marker of INTERNAL_VALUE_MARKERS) {
        assert.notEqual(
          value,
          marker,
          `${path} must not equal internal code ${marker}`,
        );
      }
    }
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    assert.ok(
      !GUEST_INTERNAL_RESPONSE_KEYS.includes(key),
      `${path}.${key} must not appear on guest API responses`,
    );
    assertNoGuestInternalFields(nested, `${path}.${key}`);
  }
}
