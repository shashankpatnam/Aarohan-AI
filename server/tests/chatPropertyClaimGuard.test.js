import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyApprovedFactsDto } from "../config/projectFacts.js";
import {
  applyPropertyClaimSafeguard,
  buildSafeFallbackReply,
  detectUnsupportedClaimCategories,
} from "../services/chatPropertyClaimGuard.js";

describe("chatPropertyClaimGuard", () => {
  const emptyFacts = createEmptyApprovedFactsDto("Skyline Residences");

  it("does not flag qualification-only replies", () => {
    const reply =
      "Thank you for your interest. What is your preferred buying timeline?";
    assert.deepEqual(
      detectUnsupportedClaimCategories(reply, emptyFacts),
      [],
    );
  });

  it("detects unsupported price claims when priceInformation is missing", () => {
    const reply = "Homes start from ₹85 lakh for this project.";
    const violations = detectUnsupportedClaimCategories(reply, emptyFacts);
    assert.ok(violations.includes("price"));
  });

  it("detects unsupported amenity claims when amenities list is empty", () => {
    const reply = "The project includes a swimming pool and clubhouse.";
    const violations = detectUnsupportedClaimCategories(reply, emptyFacts);
    assert.ok(violations.includes("amenities"));
  });

  it("replaces risky reply and sets handoff fields", () => {
    const turn = {
      reply: "Pricing starts at 1.2 crore with possession in Dec 2026.",
      preferredLanguage: null,
      qualification: { buyingTimeline: "3 months" },
      buyerSummary: null,
      needsHumanHandoff: false,
      handoffReason: null,
      recommendQualified: false,
    };

    const result = applyPropertyClaimSafeguard(
      turn,
      emptyFacts,
      "Skyline Residences",
    );

    assert.notEqual(result.reply, turn.reply);
    assert.match(result.reply, /don't have verified/i);
    assert.match(result.reply, /approved project records/i);
    assert.equal(result.needsHumanHandoff, true);
    assert.ok(result.handoffReason);
    assert.equal(result.qualification.buyingTimeline, "3 months");
  });

  it("leaves safe replies unchanged", () => {
    const reply = buildSafeFallbackReply("Skyline Residences", ["price"]);
    const turn = {
      reply,
      preferredLanguage: null,
      qualification: null,
      buyerSummary: null,
      needsHumanHandoff: true,
      handoffReason: "Already safe",
      recommendQualified: false,
    };

    const result = applyPropertyClaimSafeguard(
      turn,
      emptyFacts,
      "Skyline Residences",
    );

    assert.equal(result.reply, reply);
    assert.equal(result.needsHumanHandoff, true);
  });

  it("allows inventory claims when inventoryInformation is approved", () => {
    const facts = {
      ...emptyFacts,
      inventoryInformation: "Limited 2 BHK units available this month.",
    };
    const reply = "We have limited units available in this project.";
    assert.deepEqual(detectUnsupportedClaimCategories(reply, facts), []);
  });

  it("checks portfolio claims against the facts for the named project", () => {
    const portfolio = {
      projects: [
        {
          projectName: "Skyline Residences",
          facts: { ...emptyFacts, amenities: ["Swimming pool"] },
        },
        { projectName: "Orchid Park Residences", facts: null },
      ],
    };

    assert.deepEqual(
      detectUnsupportedClaimCategories(
        "Skyline Residences includes a swimming pool.",
        portfolio,
      ),
      [],
    );
    assert.ok(
      detectUnsupportedClaimCategories(
        "Orchid Park Residences includes a swimming pool.",
        portfolio,
      ).includes("amenities"),
    );
  });

  it("uses portfolio wording when unsupported facts have no initial project", () => {
    assert.match(
      buildSafeFallbackReply(null, ["inventory"]),
      /Aarohan property portfolio/i,
    );
  });
});
