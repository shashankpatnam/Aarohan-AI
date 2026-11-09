import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getGuestBookingPhaseAfterContact,
  getInitialGuestBookingPhase,
  getGuestBookingPhaseForResume,
  hasRequiredGuestBookingContact,
  validateGuestBookingContact,
} from "../src/utils/guestBookingContact.js";

describe("guest booking contact requirements", () => {
  it("skips collection only when a converted guest has a phone", () => {
    assert.equal(hasRequiredGuestBookingContact({ contactCaptured: true, hasPhone: true }), true);
    assert.equal(hasRequiredGuestBookingContact({ contactCaptured: true, hasPhone: false }), false);
    assert.equal(hasRequiredGuestBookingContact({ contactCaptured: false, hasPhone: true }), false);
    assert.equal(hasRequiredGuestBookingContact({ captured: true, hasPhone: true }), true);
  });

  it("clarifies project before contact and opens the calendar after contact conversion", () => {
    assert.equal(getInitialGuestBookingPhase({ project: null, contactReady: false }), "selecting_project");
    assert.equal(getInitialGuestBookingPhase({ project: "Palm Grove Villas", contactReady: false }), "collecting_contact");
    assert.equal(getInitialGuestBookingPhase({ project: "Palm Grove Villas", contactReady: true }), "selecting_date");
    assert.equal(getInitialGuestBookingPhase({ project: "Palm Grove Villas", contactReady: true, draftDate: "2026-11-20" }), "restoring");
    assert.equal(getGuestBookingPhaseAfterContact({ restoringDraft: false }), "selecting_date");
    assert.equal(getGuestBookingPhaseAfterContact({ restoringDraft: true, selectedDate: "2026-11-20", selectedSlot: "11:30 AM" }), "restoring");
  });

  it("reopens the correct pending step based on project, contact and saved selection", () => {
    assert.equal(getGuestBookingPhaseForResume({ project: "Palm Grove Villas", contactReady: false }), "collecting_contact");
    assert.equal(getGuestBookingPhaseForResume({ project: "Palm Grove Villas", contactReady: true }), "selecting_date");
    assert.equal(getGuestBookingPhaseForResume({ project: "Palm Grove Villas", contactReady: true, selectedDate: "2026-11-20" }), "selecting_slot");
    assert.equal(getGuestBookingPhaseForResume({ project: "Palm Grove Villas", contactReady: true, selectedDate: "2026-11-20", selectedSlot: "11:30 AM" }), "review");
  });

  it("requires a non-empty name and a valid phone number", () => {
    assert.ok(validateGuestBookingContact({ name: " ", phone: "9876543210", email: "" }).errors.name);
    assert.ok(validateGuestBookingContact({ name: "A Buyer", phone: "12345", email: "" }).errors.phone);
    assert.ok(validateGuestBookingContact({ name: "A Buyer", phone: "9876543210x", email: "" }).errors.phone);
    assert.deepEqual(validateGuestBookingContact({ name: "  A Buyer  ", phone: "+91 98765-43210", email: "" }), {
      errors: {},
      value: { name: "A Buyer", phone: "+91 98765-43210", email: "" },
    });
  });

  it("allows an empty email and validates one when supplied", () => {
    assert.deepEqual(validateGuestBookingContact({ name: "A Buyer", phone: "9876543210", email: "" }).errors, {});
    assert.ok(validateGuestBookingContact({ name: "A Buyer", phone: "9876543210", email: "not-an-email" }).errors.email);
    assert.deepEqual(validateGuestBookingContact({ name: "A Buyer", phone: "9876543210", email: "buyer@example.com" }).errors, {});
  });
});
