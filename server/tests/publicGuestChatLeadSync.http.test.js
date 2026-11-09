import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import GuestSession from "../models/GuestSession.js";
import Lead from "../models/Lead.js";
import {
  __resetGenerateLeadChatTurnForTests,
  __setGenerateLeadChatTurnForTests,
} from "../services/leadChatTurnResolver.js";
import {
  __resetSyncGuestMessagesToLinkedLeadForTests,
  __setSyncGuestMessagesToLinkedLeadForTests,
  syncGuestMessagesToLinkedLead,
} from "../services/guestChatLeadSync.js";

const TEST_PROJECT = "Green Valley Phase 2";
const CONTACT = {
  name: "Meera Iyer",
  phone: "+91 90000 11122",
  email: "meera.phase5c@example.com",
};

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("supertest").Agent} */
let agent;

const trackedSessionIds = [];

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function mockChatTurn(reply) {
  __setGenerateLeadChatTurnForTests(async () => ({
    ok: true,
    data: {
      reply,
      preferredLanguage: null,
      qualification: null,
      buyerSummary: null,
      needsHumanHandoff: false,
      handoffReason: null,
      recommendQualified: false,
    },
  }));
}

async function createSessionViaApi() {
  const response = await agent
    .post("/api/public/sessions")
    .send({ intent: "project", project: TEST_PROJECT })
    .expect(201);

  trackedSessionIds.push(response.body.session.id);
  return {
    sessionId: response.body.session.id,
    sessionToken: response.body.sessionToken,
  };
}

function messageTexts(messages) {
  return (messages ?? []).map((msg) => msg.text);
}

function messageIds(messages) {
  return (messages ?? []).map((msg) => String(msg._id ?? msg.id));
}

describe("Guest chat transcript sync to CRM Lead", () => {
  before(async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    agent = request(
      createApp({
        authRateLimit: { disabled: true },
      }),
    );
  });

  afterEach(async () => {
    __resetGenerateLeadChatTurnForTests();
    __resetSyncGuestMessagesToLinkedLeadForTests();
    if (trackedSessionIds.length > 0) {
      await GuestSession.deleteMany({
        _id: {
          $in: trackedSessionIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      });
      trackedSessionIds.length = 0;
    }
    await Lead.deleteMany({});
  });

  after(async () => {
    __resetGenerateLeadChatTurnForTests();
    __resetSyncGuestMessagesToLinkedLeadForTests();
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("keeps pre-conversion chat on the GuestSession only, then copies it once at contact conversion", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    mockChatTurn("Amenities include a fitness studio.");

    await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "What amenities are available?" })
      .expect(200);

    const beforeContact = await GuestSession.findById(sessionId);
    assert.equal(beforeContact.messages.length, 2);
    assert.equal(beforeContact.leadId, null);
    assert.equal(await Lead.countDocuments(), 0);

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(CONTACT)
      .expect(201);

    const session = await GuestSession.findById(sessionId);
    const lead = await Lead.findById(session.leadId);
    assert.equal(session.messages.length, 2);
    assert.equal(lead.messages.length, 2);
    assert.deepEqual(messageTexts(lead.messages), messageTexts(session.messages));
    assert.deepEqual(messageIds(lead.messages), messageIds(session.messages));
  });

  it("gets an AI response before interactive booking while keeping visit-only turns out of project interest", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    let generatorCalls = 0;
    __setGenerateLeadChatTurnForTests(async () => {
      generatorCalls += 1;
      return { ok: true, data: {
        reply: "Project information.", preferredLanguage: null, qualification: null,
        buyerSummary: null, needsHumanHandoff: false, handoffReason: null, recommendQualified: false,
      } };
    });

    await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "I like Palm Grove Villas." }).expect(200);
    assert.equal(generatorCalls, 1);
    await agent.post(`/api/public/sessions/${sessionId}/contact`).set(authHeader(sessionToken))
      .send(CONTACT).expect(201);

    const visit = await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "I would like to have a visit." }).expect(200);
    assert.equal(generatorCalls, 2);
    assert.equal(visit.body.messages.at(-1).from, "ai");
    assert.equal(visit.body.messages.at(-1).text, "Project information.");
    assert.doesNotMatch(visit.body.messages.at(-1).text, /CRM|preferred day|sales executive/i);

    const dates = await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "Which dates are available?" }).expect(200);
    assert.equal(generatorCalls, 3);
    assert.equal(dates.body.messages.at(-1).from, "ai");
    assert.equal(dates.body.messages.at(-1).text, "Project information.");

    const details = await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "Where do I enter my details?" }).expect(200);
    assert.equal(generatorCalls, 4);
    assert.equal(details.body.messages.at(-1).from, "ai");
    assert.equal(details.body.messages.at(-1).text, "Project information.");

    const session = await GuestSession.findById(sessionId);
    assert.equal(session.project, null);
    assert.equal(session.initialProject, TEST_PROJECT);
    assert.deepEqual(session.interestedProjects, ["Palm Grove Villas"]);
    assert.equal(session.interestEvidence.length, 1);
    assert.equal(session.messages.filter((message) => message.from === "ai").length, 4);
    const lead = await Lead.findById(session.leadId);
    assert.deepEqual(messageIds(lead.messages), messageIds(session.messages));
  });

  it("records explicit buyer interest with buyer-message evidence and syncs it across conversion", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    mockChatTurn("Thanks for sharing your preference.");
    await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "I'm interested in Green Valley Phase 2. It is my first preference." }).expect(200);
    let session = await GuestSession.findById(sessionId);
    assert.equal(session.project, TEST_PROJECT);
    assert.deepEqual(session.interestedProjects, [TEST_PROJECT]);
    assert.equal(session.interestEvidence.length, 1);
    const evidence = session.interestEvidence[0];
    assert.equal(String(evidence.sourceBuyerMessageId), String(session.messages[0]._id));
    assert.equal(evidence.type, "explicit_buyer_statement");

    await agent.post(`/api/public/sessions/${sessionId}/contact`).set(authHeader(sessionToken)).send(CONTACT).expect(201);
    session = await GuestSession.findById(sessionId);
    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.project, TEST_PROJECT);
    assert.deepEqual(lead.interestedProjects, [TEST_PROJECT]);
    assert.equal(lead.interestEvidence.length, 1);

    mockChatTurn("Preference updated.");
    await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "I prefer Riverfront Heights." }).expect(200);
    session = await GuestSession.findById(sessionId);
    const updatedLead = await Lead.findById(session.leadId);
    assert.equal(session.project, "Riverfront Heights");
    assert.deepEqual(updatedLead.interestedProjects, [TEST_PROJECT, "Riverfront Heights"]);
    assert.equal(updatedLead.project, "Riverfront Heights");
    assert.equal(updatedLead.interestEvidence.length, 2);
    assert.deepEqual(messageIds(updatedLead.messages), messageIds(session.messages));
    await syncGuestMessagesToLinkedLead(session, session.messages.slice(-2), new Date());
    const replayedLead = await Lead.findById(session.leadId);
    assert.equal(replayedLead.interestEvidence.length, 2);
    assert.equal(replayedLead.messages.length, session.messages.length);
  });

  it("requires confirmation for ambiguous mentions and excludes them until buyer confirms", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    mockChatTurn("Here is a comparison of the two projects.");
    const first = await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "Compare Skyline Residences and Green Valley Phase 2." }).expect(200);
    assert.match(first.body.messages.at(-1).text, /Are you saying you are interested/i);
    let session = await GuestSession.findById(sessionId);
    assert.deepEqual(session.interestedProjects, []);

    mockChatTurn("Thank you for confirming.");
    await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "Yes, I am interested in both." }).expect(200);
    session = await GuestSession.findById(sessionId);
    assert.deepEqual(session.interestedProjects, ["Skyline Residences", "Green Valley Phase 2"]);
    assert.ok(session.interestEvidence.every((item) => item.type === "buyer_confirmation"));
    assert.ok(session.interestEvidence.every((item) => String(item.sourceBuyerMessageId) === String(session.messages.at(-2)._id)));
    assert.equal(session.project, null);
  });

  it("does not capture informational questions or AI generated project summaries", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    __setGenerateLeadChatTurnForTests(async () => ({ ok: true, data: {
      reply: "You may be interested in Skyline Residences.", preferredLanguage: null,
      qualification: null, buyerSummary: "Buyer is interested in Skyline Residences.",
      needsHumanHandoff: false, handoffReason: null, recommendQualified: false,
    } }));
    await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "What amenities does Skyline Residences have?" }).expect(200);
    await agent.post(`/api/public/sessions/${sessionId}/chat`).set(authHeader(sessionToken))
      .send({ message: "I am not interested in Skyline Residences." }).expect(200);
    const session = await GuestSession.findById(sessionId);
    assert.deepEqual(session.interestedProjects, []);
    assert.deepEqual(session.interestEvidence, []);
  });

  it("appends post-conversion guest turns to the Lead without duplicating earlier messages", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    mockChatTurn("Homes are priced by configuration.");

    await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "What is the price?" })
      .expect(200);

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(CONTACT)
      .expect(201);

    __setGenerateLeadChatTurnForTests(async () => ({
      ok: true,
      data: {
        reply: "Site visits are by appointment.",
        preferredLanguage: null,
        qualification: null,
        buyerSummary:
          "Interested in Green Valley Phase 2. Asked about price, then how site visits work. No budget stated.",
        needsHumanHandoff: false,
        handoffReason: null,
        recommendQualified: false,
      },
    }));
    await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "How do site visits work?" })
      .expect(200);

    const session = await GuestSession.findById(sessionId);
    const lead = await Lead.findById(session.leadId);
    assert.equal(session.messages.length, 4);
    assert.equal(lead.messages.length, 4);
    assert.deepEqual(messageTexts(lead.messages), messageTexts(session.messages));
    assert.deepEqual(messageIds(lead.messages), messageIds(session.messages));
    assert.equal(
      lead.messages.filter((msg) => msg.text === "How do site visits work?").length,
      1,
    );
    assert.equal(
      lead.messages.filter((msg) => msg.text === "What is the price?").length,
      1,
    );
    assert.equal(
      lead.buyerSummary,
      "Interested in Green Valley Phase 2. Asked about price, then how site visits work. No budget stated.",
    );
  });

  it("does not duplicate Lead messages when the same turn is synchronized twice", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    mockChatTurn("First reply");
    await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "Hello" })
      .expect(200);

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(CONTACT)
      .expect(201);

    mockChatTurn("Visit process reply");
    await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "Tell me about visits" })
      .expect(200);

    const session = await GuestSession.findById(sessionId);
    const newMessages = session.messages.slice(-2);
    const now = new Date();
    await syncGuestMessagesToLinkedLead(session, newMessages, now);
    await syncGuestMessagesToLinkedLead(session, newMessages, now);

    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.messages.length, 4);
    assert.deepEqual(messageIds(lead.messages), messageIds(session.messages));
  });

  it("keeps GuestSession as source of truth when Lead synchronization fails", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    mockChatTurn("Pre-conversion reply");
    await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "Hello before contact" })
      .expect(200);

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(CONTACT)
      .expect(201);

    const errors = [];
    const originalError = console.error;
    console.error = (...args) => {
      errors.push(args.map(String).join(" "));
    };

    __setSyncGuestMessagesToLinkedLeadForTests(async () => {
      throw new Error("simulated lead sync failure");
    });

    mockChatTurn("This must still persist on the guest session");
    const chat = await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "Post-conversion question" })
      .expect(200);

    console.error = originalError;

    assert.equal(chat.body.success, true);
    assert.equal(chat.body.session.leadId, undefined);

    const session = await GuestSession.findById(sessionId);
    const lead = await Lead.findById(session.leadId);
    assert.equal(session.messages.length, 4);
    assert.equal(lead.messages.length, 2);
    assert.equal(
      session.messages.some((msg) => msg.text === "Post-conversion question"),
      true,
    );
    assert.equal(
      lead.messages.some((msg) => msg.text === "Post-conversion question"),
      false,
    );
    assert.ok(
      errors.some((line) =>
        /guestChatLeadSync/.test(line) && /simulated lead sync failure/.test(line),
      ),
    );
    assert.ok(errors.some((line) => line.includes(String(session._id))));
  });
});
