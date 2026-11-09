import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GEMINI_CHAT_ERROR } from "../services/geminiLeadChat.js";
import {
  buildFallbackChatTurnData,
  buildFallbackHandoffSummary,
  CHAT_FAILURE_REASON,
  mapGeminiErrorToChatFailureReason,
  resolveFallbackReplyText,
} from "../services/leadChatGracefulFallback.js";
import { resolveLeadChatTurn } from "../services/leadChatTurnResolver.js";
import { applyHandoffFromChat } from "../services/leadHandoffService.js";

const EN_FALLBACK =
  "Thanks for your message. A member of our team will confirm the details and get back to you shortly.";

function sampleLead(overrides = {}) {
  return {
    name: "Riya Sharma",
    project: "Skyline Residences",
    budget: "₹1.2 Cr",
    status: "New",
    buyerSummary: "Interested in 3 BHK",
    preferredLanguage: "",
    handoffStatus: "None",
    timeline: [],
    messages: [],
    qualification: {},
    ...overrides,
  };
}

describe("leadChatGracefulFallback", () => {
  it("uses English, Hindi, and Gujarati fallback copy from lead language", () => {
    assert.equal(resolveFallbackReplyText(""), EN_FALLBACK);
    assert.equal(resolveFallbackReplyText("Hindi"), resolveFallbackReplyText("hi"));
    assert.notEqual(resolveFallbackReplyText("Hindi"), EN_FALLBACK);
    assert.equal(resolveFallbackReplyText("Gujarati"), resolveFallbackReplyText("gu"));
    assert.notEqual(resolveFallbackReplyText("Gujarati"), EN_FALLBACK);
  });

  it("maps Gemini error codes to chat failure reasons", () => {
    assert.equal(
      mapGeminiErrorToChatFailureReason(GEMINI_CHAT_ERROR.PROJECT_FACTS),
      CHAT_FAILURE_REASON.NO_APPROVED_FACTS,
    );
    assert.equal(
      mapGeminiErrorToChatFailureReason(GEMINI_CHAT_ERROR.MODEL_UNAVAILABLE),
      CHAT_FAILURE_REASON.MODEL_UNAVAILABLE,
    );
    assert.equal(
      mapGeminiErrorToChatFailureReason(GEMINI_CHAT_ERROR.API),
      CHAT_FAILURE_REASON.MODEL_UNAVAILABLE,
    );
    assert.equal(
      mapGeminiErrorToChatFailureReason(GEMINI_CHAT_ERROR.VALIDATION),
      CHAT_FAILURE_REASON.UNKNOWN_ERROR,
    );
  });

  it("builds handoff summaries from lead fields and buyer text only", () => {
    const lead = sampleLead({ preferredLanguage: "English" });
    const summary = buildFallbackHandoffSummary(
      lead,
      "What is the price for 3 BHK?",
      CHAT_FAILURE_REASON.NO_APPROVED_FACTS,
    );
    assert.match(summary, /approved project facts/i);
    assert.match(summary, /Riya Sharma/);
    assert.match(summary, /Skyline Residences/);
    assert.match(summary, /Latest buyer message:/);
    assert.match(summary, /3 BHK/);
    assert.doesNotMatch(summary, /GEMINI/i);
  });
});

describe("resolveLeadChatTurn graceful failures", () => {
  const baseInput = {
    projectName: "Skyline Residences",
    latestBuyerMessage: "Is RERA approved?",
    recentMessages: [],
    leadContext: {},
    lead: sampleLead(),
  };

  it("returns fallback, handoff, and no_approved_facts when facts are missing", async () => {
    const resolved = await resolveLeadChatTurn(baseInput, async () => ({
      ok: false,
      error: {
        code: GEMINI_CHAT_ERROR.PROJECT_FACTS,
        message: "No approved project facts are available for this lead's project.",
      },
    }));

    assert.equal(resolved.chatFailureReason, CHAT_FAILURE_REASON.NO_APPROVED_FACTS);
    assert.equal(resolved.data.reply, EN_FALLBACK);
    assert.equal(resolved.data.needsHumanHandoff, true);
    assert.ok(resolved.data.handoffReason);
  });

  it("returns fallback, handoff, and model_unavailable when Gemini fails", async () => {
    const resolved = await resolveLeadChatTurn(baseInput, async () => ({
      ok: false,
      error: {
        code: GEMINI_CHAT_ERROR.MODEL_UNAVAILABLE,
        message: "The AI assistant is temporarily unavailable.",
      },
    }));

    assert.equal(
      resolved.chatFailureReason,
      CHAT_FAILURE_REASON.MODEL_UNAVAILABLE,
    );
    assert.equal(resolved.data.reply, EN_FALLBACK);
    assert.equal(resolved.data.needsHumanHandoff, true);
  });

  it("returns fallback and unknown_error when the generator throws", async () => {
    const resolved = await resolveLeadChatTurn(baseInput, async () => {
      throw new Error("unexpected boom");
    });

    assert.equal(resolved.chatFailureReason, CHAT_FAILURE_REASON.UNKNOWN_ERROR);
    assert.equal(resolved.data.reply, EN_FALLBACK);
    assert.equal(resolved.data.needsHumanHandoff, true);
  });

  it("passes through successful model replies unchanged", async () => {
    const modelTurn = {
      reply: "Here is what we have verified about Skyline Residences.",
      preferredLanguage: "English",
      qualification: null,
      buyerSummary: "Wants verified facts only",
      needsHumanHandoff: false,
      handoffReason: null,
      recommendQualified: false,
    };

    const resolved = await resolveLeadChatTurn(baseInput, async () => ({
      ok: true,
      data: modelTurn,
    }));

    assert.equal(resolved.chatFailureReason, null);
    assert.deepEqual(resolved.data, modelTurn);
  });
});

describe("graceful chat handoff idempotency", () => {
  it("creates only one handoff timeline entry when fallback is applied twice", () => {
    const lead = sampleLead();
    const now = new Date("2026-01-15T10:00:00.000Z");
    const turn = buildFallbackChatTurnData(
      lead,
      "Need pricing details",
      CHAT_FAILURE_REASON.MODEL_UNAVAILABLE,
    );

    applyHandoffFromChat(lead, true, turn.handoffReason, now);
    applyHandoffFromChat(lead, true, turn.handoffReason, now);

    assert.equal(lead.handoffStatus, "Pending");
    const handoffEvents = lead.timeline.filter(
      (event) => event.title === "Human handoff requested",
    );
    assert.equal(handoffEvents.length, 1);
  });
});
