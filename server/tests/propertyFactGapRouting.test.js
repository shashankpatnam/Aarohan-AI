import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyApprovedFactsDto } from "../config/projectFacts.js";
import {
  detectRequestedFactCategories,
  findUnavailableRequestedFactCategories,
  isBareGreetingOrSmallTalk,
  tryBuildFactGapHandoffTurn,
} from "../services/propertyFactGapRouting.js";

describe("propertyFactGapRouting", () => {
  const emptyFacts = createEmptyApprovedFactsDto("Green Valley Phase 2");

  it("does not treat bare greetings as fact questions", () => {
    assert.equal(isBareGreetingOrSmallTalk("Hello there"), true);
    assert.deepEqual(detectRequestedFactCategories("Hello there"), []);
  });

  it("detects inventory questions when inventory is unavailable", () => {
    const message = "Are any units still available in this project?";
    assert.ok(detectRequestedFactCategories(message).includes("inventory"));
    const gaps = findUnavailableRequestedFactCategories(message, emptyFacts);
    assert.deepEqual(gaps, ["inventory"]);
  });

  it("does not gap-route when approved inventory exists", () => {
    const facts = {
      ...emptyFacts,
      inventoryInformation: "Limited 2 BHK units available this month.",
    };
    const message = "Are any units still available?";
    assert.deepEqual(
      findUnavailableRequestedFactCategories(message, facts),
      [],
    );
  });

  it("detects missing RERA questions", () => {
    const message = "What is the RERA registration number?";
    assert.ok(detectRequestedFactCategories(message).includes("rera"));
    assert.deepEqual(
      findUnavailableRequestedFactCategories(message, emptyFacts),
      ["rera"],
    );
  });

  it("leaves ambiguous interest statements for Gemini", () => {
    assert.deepEqual(
      detectRequestedFactCategories("I'm interested in this project"),
      [],
    );
  });

  it("builds a safe handoff turn without qualification", () => {
    const turn = tryBuildFactGapHandoffTurn(
      "Are any units still available?",
      emptyFacts,
      emptyFacts.projectName,
    );
    assert.ok(turn);
    assert.match(turn.reply, /don't have verified/i);
    assert.equal(turn.needsHumanHandoff, true);
    assert.equal(turn.recommendQualified, false);
    assert.equal(turn.qualification, null);
  });

  it("routes a portfolio fact gap only when no scoped project has that fact", () => {
    const portfolio = {
      projects: [
        { projectName: "Green Valley Phase 2", facts: emptyFacts },
        { projectName: "Skyline Residences", facts: null },
      ],
    };
    assert.ok(
      tryBuildFactGapHandoffTurn(
        "Are any units still available?",
        portfolio,
        null,
      ),
    );
    assert.equal(
      tryBuildFactGapHandoffTurn(
        "Are any units still available at Skyline Residences?",
        {
          projects: [
            {
              projectName: "Skyline Residences",
              facts: {
                ...emptyFacts,
                inventoryInformation: "Approved inventory statement",
              },
            },
            { projectName: "Green Valley Phase 2", facts: null },
          ],
        },
        null,
      ),
      null,
    );
  });

  it("uses portfolio wording for a General Chat fact gap", () => {
    const turn = tryBuildFactGapHandoffTurn(
      "Are any units still available?",
      { projects: [{ projectName: "Green Valley Phase 2", facts: emptyFacts }] },
      null,
    );
    assert.match(turn.reply, /Aarohan property portfolio/i);
  });
});
