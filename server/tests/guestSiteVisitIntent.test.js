import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasExplicitBuyerInterestLanguage,
  isGuestSiteVisitBookingIntent,
} from "../services/guestSiteVisitIntent.js";

describe("guest site visit booking intent", () => {
  it("recognizes direct visit requests and live date or slot questions", () => {
    for (const text of [
      "I would like to have a visit.",
      "I want to visit Palm Grove Villas.",
      "Which dates are available?",
      "What slots are available?",
      "Show available dates.",
      "Where do I enter my details?",
      "How do I share my details?",
      "Open the contact form.",
      "Show me the booking form.",
      "I want to continue booking.",
      "Can I visit this weekend?",
      "I want to schedule a site visit.",
    ]) assert.equal(isGuestSiteVisitBookingIntent(text), true, text);
  });

  it("does not treat informational visit-process questions as booking intent", () => {
    for (const text of [
      "How does a site visit work?",
      "Do you provide site visits?",
      "What happens during a site visit?",
    ]) assert.equal(isGuestSiteVisitBookingIntent(text), false, text);
  });

  it("keeps booking-project selection distinct from explicit buyer-interest language", () => {
    assert.equal(hasExplicitBuyerInterestLanguage("I want to visit Palm Grove Villas."), false);
    assert.equal(hasExplicitBuyerInterestLanguage("I'm interested in Palm Grove Villas and want to visit."), true);
    assert.equal(hasExplicitBuyerInterestLanguage("I like Palm Grove Villas and want to visit."), true);
  });
});
