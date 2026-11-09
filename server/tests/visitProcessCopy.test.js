import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPROVED_PUBLIC_VISIT_PROCESS,
  normalizeVisitProcessForAssistant,
} from "../config/projectFacts.js";
import { SYSTEM_INSTRUCTION } from "../services/geminiLeadChat.js";

describe("visit process copy", () => {
  it("rewrites misleading in-chat slot instructions", () => {
    const rewritten = normalizeVisitProcessForAssistant(
      "Site visits are by appointment. Choose a free slot in the chat and you will receive a location pin.",
    );
    assert.equal(rewritten, APPROVED_PUBLIC_VISIT_PROCESS);
    assert.equal(/choose a free slot/i.test(rewritten), false);
  });

  it("rewrites outdated CRM-only visit instructions", () => {
    const rewritten = normalizeVisitProcessForAssistant(
      "Site visits are confirmed by a sales executive in our CRM. Share a preferred visit time and the team will coordinate the tour.",
    );
    assert.equal(rewritten, APPROVED_PUBLIC_VISIT_PROCESS);
    assert.equal(/confirmed by a sales executive in our CRM/i.test(rewritten), false);
  });

  it("returns null for empty visit process", () => {
    assert.equal(normalizeVisitProcessForAssistant(null), null);
    assert.equal(normalizeVisitProcessForAssistant("  "), null);
  });

  it("instructs the model to support direct booking without claiming confirmation", () => {
    assert.match(SYSTEM_INSTRUCTION, /book site visits directly through this chat/i);
    assert.match(SYSTEM_INSTRUCTION, /interactive booking flow collects contact details/i);
    assert.match(SYSTEM_INSTRUCTION, /Only the booking API can confirm it/i);
    assert.match(SYSTEM_INSTRUCTION, /handoff does not replace self-service booking/i);
    assert.match(SYSTEM_INSTRUCTION, /whole conversation/i);
    assert.match(SYSTEM_INSTRUCTION, /Never infer a budget/i);
  });
});
