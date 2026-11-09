import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import {
  attachStaffAuth,
  seedCrmStaffToken,
} from "./helpers/staffAuth.js";
import Lead from "../models/Lead.js";
import ProjectFacts from "../models/ProjectFacts.js";
import {
  applyPropertyClaimSafeguard,
} from "../services/chatPropertyClaimGuard.js";
import { createEmptyApprovedFactsDto } from "../config/projectFacts.js";
import {
  CHAT_FAILURE_REASON,
} from "../services/leadChatGracefulFallback.js";
import {
  GEMINI_CHAT_ERROR,
  generateLeadChatTurn,
} from "../services/geminiLeadChat.js";
import {
  __resetGenerateLeadChatTurnForTests,
  __setGenerateLeadChatTurnForTests,
} from "../services/leadChatTurnResolver.js";

const EN_FALLBACK =
  "Thanks for your message. A member of our team will confirm the details and get back to you shortly.";

const TEST_PROJECT = "Green Valley Phase 2";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("express").Express} */
let app;
/** @type {import("supertest").Agent} */
let agent;

const trackedLeadIds = [];

async function createTestLead(overrides = {}) {
  const lead = await Lead.create({
    name: "HTTP Test Buyer",
    phone: "9000000001",
    project: TEST_PROJECT,
    source: "Website",
    status: "New",
    ...overrides,
  });
  trackedLeadIds.push(lead._id);
  return lead;
}

async function upsertProjectFacts(projectName, patch) {
  await ProjectFacts.updateOne(
    { projectName },
    {
      $set: {
        projectName,
        location: null,
        propertyConfigurations: [],
        amenities: [],
        possessionTimeline: null,
        reraInformation: null,
        visitProcess: null,
        priceInformation: null,
        inventoryInformation: null,
        approvalStatus: "draft",
        ...patch,
      },
    },
    { upsert: true },
  );
}

async function loadLead(id) {
  return Lead.findById(id);
}

function countHandoffTimelineEvents(lead) {
  return (lead.timeline ?? []).filter(
    (event) => event.title === "Human handoff requested",
  ).length;
}

function useRealGenerateLeadChatTurnWithRetrySpy() {
  const spy = { count: 0 };
  __setGenerateLeadChatTurnForTests(async (input) =>
    generateLeadChatTurn({
      ...input,
      _geminiRetryDeps: {
        executeWithPrimaryAndFallback: async () => {
          spy.count += 1;
          return {
            outcome: "success",
            result: {
              response: {
                text: () =>
                  JSON.stringify({
                    reply: "Let me help with your questions.",
                    needsHumanHandoff: false,
                    handoffReason: null,
                    recommendQualified: false,
                  }),
                candidates: [{ finishReason: "STOP" }],
              },
            },
          };
        },
      },
    }),
  );
  return spy;
}

describe("POST /api/leads/:id/chat HTTP integration", () => {
  before(async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";

    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());

    app = createApp();
    const { token } = await seedCrmStaffToken();
    agent = attachStaffAuth(request(app), () => token);
  });

  afterEach(async () => {
    __resetGenerateLeadChatTurnForTests();
    if (trackedLeadIds.length > 0) {
      await Lead.deleteMany({ _id: { $in: trackedLeadIds } });
      trackedLeadIds.length = 0;
    }
    await ProjectFacts.deleteMany({
      projectName: TEST_PROJECT,
    });
  });

  after(async () => {
    __resetGenerateLeadChatTurnForTests();
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("persists a successful Gemini turn with guard, qualification, and handoff rules", async () => {
    await upsertProjectFacts(TEST_PROJECT, {
      approvalStatus: "approved",
      location: "Approved test location",
    });

    let geminiRetryInvokeCount = 0;

    __setGenerateLeadChatTurnForTests(async (input) => {
      return generateLeadChatTurn({
        ...input,
        _geminiRetryDeps: {
          executeWithPrimaryAndFallback: async () => {
            geminiRetryInvokeCount += 1;
            return {
              outcome: "success",
              result: {
                response: {
                  text: () =>
                    JSON.stringify({
                      reply:
                        "Thank you. What timeline are you considering for your purchase?",
                      preferredLanguage: "English",
                      qualification: {
                        buyingTimeline: "Within 3 months",
                        budgetFit: "Fits approved range",
                        locationPreference: "Near Bopal",
                        score: 72,
                      },
                      buyerSummary: "Buyer exploring timeline and location.",
                      needsHumanHandoff: true,
                      handoffReason: "Buyer asked for a callback.",
                      recommendQualified: true,
                    }),
                  candidates: [{ finishReason: "STOP" }],
                },
              },
            };
          },
        },
      });
    });

    const lead = await createTestLead();
    const buyerMessage = "I want to understand the project and my budget fit.";

    const response = await agent
      .post(`/api/leads/${lead._id.toString()}/chat`)
      .send({ message: buyerMessage })
      .expect(200);

    assert.equal(response.body.success, true);
    assert.equal(response.body.needsHumanHandoff, true);
    assert.equal(response.body.handoffReason, "Buyer asked for a callback.");
    assert.equal(response.body.chatFailureReason, undefined);

    assert.ok(Array.isArray(response.body.messages));
    assert.equal(response.body.messages.length, 2);
    assert.equal(response.body.messages[0].from, "buyer");
    assert.equal(response.body.messages[0].text, buyerMessage);
    assert.equal(response.body.messages[1].from, "ai");
    assert.match(
      response.body.messages[1].text,
      /timeline are you considering/i,
    );

    assert.equal(geminiRetryInvokeCount, 1);
    assert.doesNotMatch(
      response.body.messages[1].text,
      /don't have verified/i,
    );

    const saved = await loadLead(lead._id);
    assert.ok(saved);
    assert.equal(saved.status, "Qualified");
    assert.equal(saved.qualification.buyingTimeline, "Within 3 months");
    assert.equal(saved.qualification.budgetFit, "Fits approved range");
    assert.equal(saved.qualification.locationPreference, "Near Bopal");
    assert.equal(saved.handoffStatus, "Pending");
    assert.equal(countHandoffTimelineEvents(saved), 1);
  });

  it("returns graceful fallback for draft facts without calling Gemini API", async () => {
    await upsertProjectFacts(TEST_PROJECT, { approvalStatus: "draft" });

    let geminiApiInvokeCount = 0;

    __setGenerateLeadChatTurnForTests(async (input) =>
      generateLeadChatTurn({
        ...input,
        _geminiRetryDeps: {
          executeWithPrimaryAndFallback: async () => {
            geminiApiInvokeCount += 1;
            throw new Error("Gemini API should not be invoked");
          },
        },
      }),
    );

    const lead = await createTestLead();
    const response = await agent
      .post(`/api/leads/${lead._id.toString()}/chat`)
      .send({ message: "What is the price?" })
      .expect(200);

    assert.equal(geminiApiInvokeCount, 0);
    assert.equal(response.body.chatFailureReason, CHAT_FAILURE_REASON.NO_APPROVED_FACTS);
    assert.equal(response.body.messages[1].text, EN_FALLBACK);
    assert.equal(response.body.needsHumanHandoff, true);

    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Pending");
    assert.equal(countHandoffTimelineEvents(saved), 1);
  });

  it("returns graceful fallback on Gemini outage without qualifying the lead", async () => {
    await upsertProjectFacts(TEST_PROJECT, { approvalStatus: "approved" });

    __setGenerateLeadChatTurnForTests(async () => ({
      ok: false,
      error: {
        code: GEMINI_CHAT_ERROR.MODEL_UNAVAILABLE,
        message: "The AI assistant is temporarily unavailable.",
      },
    }));

    const lead = await createTestLead({
      qualification: {
        buyingTimeline: "Soon",
        budgetFit: "Good",
        locationPreference: "West",
      },
    });

    const response = await agent
      .post(`/api/leads/${lead._id.toString()}/chat`)
      .send({ message: "Are you there?" })
      .expect(200);

    assert.equal(
      response.body.chatFailureReason,
      CHAT_FAILURE_REASON.MODEL_UNAVAILABLE,
    );
    assert.equal(response.body.messages.length, 2);
    assert.equal(response.body.messages.filter((m) => m.from === "ai").length, 1);

    const saved = await loadLead(lead._id);
    assert.notEqual(saved.status, "Qualified");
    assert.equal(saved.qualification.buyingTimeline, "Soon");
    assert.equal(countHandoffTimelineEvents(saved), 1);
  });

  it("replaces unsafe property claims via the guard before persisting", async () => {
    await upsertProjectFacts(TEST_PROJECT, {
      approvalStatus: "approved",
      priceInformation: null,
    });

    __setGenerateLeadChatTurnForTests(async (input) => {
      const approvedFacts = createEmptyApprovedFactsDto(input.projectName);
      approvedFacts.projectName = input.projectName;

      const riskyTurn = {
        reply: "Homes start from ₹85 lakh for this project.",
        preferredLanguage: null,
        qualification: null,
        buyerSummary: null,
        needsHumanHandoff: false,
        handoffReason: null,
        recommendQualified: false,
      };

      return {
        ok: true,
        data: applyPropertyClaimSafeguard(
          riskyTurn,
          approvedFacts,
          input.projectName,
        ),
      };
    });

    const lead = await createTestLead();
    const response = await agent
      .post(`/api/leads/${lead._id.toString()}/chat`)
      .send({ message: "Share pricing." })
      .expect(200);

    assert.match(response.body.messages[1].text, /don't have verified/i);
    assert.equal(response.body.needsHumanHandoff, true);
    assert.ok(response.body.handoffReason);

    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Pending");
    assert.match(saved.messages.at(-1).text, /don't have verified/i);
  });

  it("returns 400 for invalid lead id and 404 for missing lead without chat writes", async () => {
    const lead = await createTestLead();
    const beforeCount = (await loadLead(lead._id)).messages.length;

    const invalid = await agent
      .post("/api/leads/not-an-id/chat")
      .send({ message: "Hello" })
      .expect(400);

    assert.equal(invalid.body.success, false);
    assert.match(invalid.body.message, /Invalid lead id/i);

    const missingId = new mongoose.Types.ObjectId().toString();
    const missing = await agent
      .post(`/api/leads/${missingId}/chat`)
      .send({ message: "Hello" })
      .expect(404);

    assert.equal(missing.body.success, false);
    assert.match(missing.body.message, /Lead not found/i);

    const unchanged = await loadLead(lead._id);
    assert.equal(unchanged.messages.length, beforeCount);
  });

  it("documents duplicate messages when the same buyer sends two successful POSTs", async () => {
    await upsertProjectFacts(TEST_PROJECT, { approvalStatus: "approved" });

    __setGenerateLeadChatTurnForTests(async (input) => ({
      ok: true,
      data: {
        reply: "Thanks for writing. How can I help next?",
        preferredLanguage: null,
        qualification: null,
        buyerSummary: null,
        needsHumanHandoff: false,
        handoffReason: null,
        recommendQualified: false,
      },
    }));

    const lead = await createTestLead();

    await agent
      .post(`/api/leads/${lead._id.toString()}/chat`)
      .send({ message: "First message" })
      .expect(200);

    await agent
      .post(`/api/leads/${lead._id.toString()}/chat`)
      .send({ message: "Second message" })
      .expect(200);

    const saved = await loadLead(lead._id);
    assert.equal(saved.messages.length, 4);
    assert.deepEqual(
      saved.messages.map((m) => m.text),
      [
        "First message",
        "Thanks for writing. How can I help next?",
        "Second message",
        "Thanks for writing. How can I help next?",
      ],
    );
  });

  describe("question-aware property fact-gap routing", () => {
    it("calls Gemini when the buyer asks about an approved fact category", async () => {
      await upsertProjectFacts(TEST_PROJECT, {
        approvalStatus: "approved",
        priceInformation: {
          summary: "Approved summary",
          startingFrom: "From ₹58 lakh",
          note: null,
        },
      });

      const spy = useRealGenerateLeadChatTurnWithRetrySpy();
      const lead = await createTestLead();

      const response = await agent
        .post(`/api/leads/${lead._id.toString()}/chat`)
        .send({ message: "What is the starting price for this project?" })
        .expect(200);

      assert.equal(spy.count, 1);
      assert.equal(response.body.chatFailureReason, undefined);
      assert.match(response.body.messages[1].text, /help with your questions/i);

      const saved = await loadLead(lead._id);
      assert.notEqual(saved.status, "Qualified");
    });

    it("skips Gemini for missing inventory and creates a handoff", async () => {
      await upsertProjectFacts(TEST_PROJECT, {
        approvalStatus: "approved",
        inventoryInformation: null,
      });

      const spy = useRealGenerateLeadChatTurnWithRetrySpy();
      const lead = await createTestLead();

      const response = await agent
        .post(`/api/leads/${lead._id.toString()}/chat`)
        .send({ message: "Are any units still available in this project?" })
        .expect(200);

      assert.equal(spy.count, 0);
      assert.equal(response.body.chatFailureReason, undefined);
      assert.match(response.body.messages[1].text, /don't have verified/i);
      assert.match(response.body.messages[1].text, /unit availability/i);
      assert.equal(response.body.needsHumanHandoff, true);

      const saved = await loadLead(lead._id);
      assert.notEqual(saved.status, "Qualified");
      assert.equal(saved.handoffStatus, "Pending");
      assert.equal(countHandoffTimelineEvents(saved), 1);
    });

    it("skips Gemini for another missing fact such as RERA", async () => {
      await upsertProjectFacts(TEST_PROJECT, {
        approvalStatus: "approved",
        reraInformation: null,
      });

      const spy = useRealGenerateLeadChatTurnWithRetrySpy();
      const lead = await createTestLead();

      await agent
        .post(`/api/leads/${lead._id.toString()}/chat`)
        .send({ message: "What is the RERA registration number?" })
        .expect(200);

      assert.equal(spy.count, 0);
    });

    it("does not fact-gap route a greeting", async () => {
      await upsertProjectFacts(TEST_PROJECT, {
        approvalStatus: "approved",
        inventoryInformation: null,
      });

      const spy = useRealGenerateLeadChatTurnWithRetrySpy();
      const lead = await createTestLead();

      await agent
        .post(`/api/leads/${lead._id.toString()}/chat`)
        .send({ message: "Hello there" })
        .expect(200);

      assert.equal(spy.count, 1);
    });

    it("does not fact-gap route an ambiguous interest message", async () => {
      await upsertProjectFacts(TEST_PROJECT, {
        approvalStatus: "approved",
        inventoryInformation: null,
      });

      const spy = useRealGenerateLeadChatTurnWithRetrySpy();
      const lead = await createTestLead();

      await agent
        .post(`/api/leads/${lead._id.toString()}/chat`)
        .send({ message: "I'm interested in this project" })
        .expect(200);

      assert.equal(spy.count, 1);
    });

    it("reuses an open handoff without duplicate handoff timeline entries", async () => {
      await upsertProjectFacts(TEST_PROJECT, {
        approvalStatus: "approved",
        inventoryInformation: null,
      });

      useRealGenerateLeadChatTurnWithRetrySpy();
      const lead = await createTestLead();

      await agent
        .post(`/api/leads/${lead._id.toString()}/chat`)
        .send({ message: "Are any units still available?" })
        .expect(200);

      await agent
        .post(`/api/leads/${lead._id.toString()}/chat`)
        .send({ message: "How many flats are left?" })
        .expect(200);

      const saved = await loadLead(lead._id);
      assert.equal(countHandoffTimelineEvents(saved), 1);
      assert.equal(saved.messages.length, 4);
    });
  });
});
