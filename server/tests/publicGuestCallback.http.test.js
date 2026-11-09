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

const TEST_PROJECT = "Palm Grove Villas";
const CONTACT = {
  name: "Rahul Mehta",
  phone: "+91 91234 56789",
  email: "rahul@example.com",
};

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("express").Express} */
let app;
/** @type {import("supertest").Agent} */
let agent;

const trackedSessionIds = [];
const trackedLeadIds = [];

async function createSessionViaApi(project = TEST_PROJECT) {
  const response = await agent
    .post("/api/public/sessions")
    .send({ intent: "project", project })
    .expect(201);

  trackedSessionIds.push(response.body.session.id);

  return {
    sessionId: response.body.session.id,
    sessionToken: response.body.sessionToken,
  };
}

async function createGeneralSessionViaApi() {
  const response = await agent
    .post("/api/public/sessions")
    .send({ intent: "general" })
    .expect(201);

  trackedSessionIds.push(response.body.session.id);
  return {
    sessionId: response.body.session.id,
    sessionToken: response.body.sessionToken,
  };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function captureContact(sessionId, sessionToken) {
  await agent
    .post(`/api/public/sessions/${sessionId}/contact`)
    .set(authHeader(sessionToken))
    .send(CONTACT)
    .expect(201);
}

describe("POST /api/public/sessions/:sessionId/callback", () => {
  before(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    app = createApp();
    agent = request(app);
  });

  afterEach(async () => {
    __resetGenerateLeadChatTurnForTests();
    if (trackedSessionIds.length > 0) {
      await GuestSession.deleteMany({
        _id: {
          $in: trackedSessionIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      });
      trackedSessionIds.length = 0;
    }
    if (trackedLeadIds.length > 0) {
      await Lead.deleteMany({
        _id: { $in: trackedLeadIds.map((id) => new mongoose.Types.ObjectId(id)) },
      });
      trackedLeadIds.length = 0;
    }
  });

  after(async () => {
    __resetGenerateLeadChatTurnForTests();
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("creates a buyer callback handoff on the linked Lead", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await captureContact(sessionId, sessionToken);

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({
        preferredContactMethod: "phone",
        message: "Please call after 6 pm.",
      })
      .expect(201);

    assert.equal(response.body.success, true);
    assert.equal(response.body.callbackRequested, true);
    assert.ok(response.body.confirmation?.message);
    assert.equal(response.body.session.callbackRequested, true);
    assert.equal(response.body.session.callbackPending, true);
    assert.equal(response.body.handoff, undefined);

    const session = await GuestSession.findById(sessionId);
    assert.ok(session.callbackRequestedAt);
    trackedLeadIds.push(session.leadId.toString());

    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.handoffStatus, "Pending");
    assert.equal(lead.handoffType, "buyer_callback");
    assert.equal(lead.handoffPreferredContactMethod, "phone");
    assert.match(lead.handoffCallbackNote, /after 6 pm/i);
    assert.equal(lead.status, "New");
    assert.equal(
      lead.timeline.some((e) => e.title === "Buyer callback requested"),
      true,
    );
  });

  it("uses General Inquiry wording for callbacks without a selected project", async () => {
    const { sessionId, sessionToken } = await createGeneralSessionViaApi();
    await captureContact(sessionId, sessionToken);

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ preferredContactMethod: "phone" })
      .expect(201);

    assert.match(response.body.confirmation.message, /General Inquiry/i);
    assert.doesNotMatch(response.body.confirmation.message, /null|Skyline Residences/i);
    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());
    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.project, null);
    assert.equal(lead.handoffType, "buyer_callback");
  });

  it("requires contact capture before callback", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ message: "Call me" })
      .expect(422);

    assert.equal(response.body.code, "contact_required");
    assert.equal(await Lead.countDocuments(), 0);
  });

  it("returns only a contact readiness summary and fills a missing phone without creating a second lead", async () => {
    const { sessionId, sessionToken } = await createGeneralSessionViaApi();
    const first = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({ name: CONTACT.name, email: CONTACT.email })
      .expect(201);

    assert.equal(first.body.session.contactName, CONTACT.name);
    assert.equal(first.body.session.hasPhone, false);
    assert.equal(first.body.session.leadId, undefined);
    assert.equal(first.body.session.phone, undefined);
    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());

    const completed = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({ name: CONTACT.name, phone: "+91 91234 56789", email: CONTACT.email })
      .expect(200);
    assert.equal(completed.body.session.hasPhone, true);
    assert.equal(completed.body.session.contactName, CONTACT.name);
    assert.equal(await Lead.countDocuments({ _id: session.leadId }), 1);
    assert.equal((await Lead.findById(session.leadId)).phone, "+91 91234 56789");
  });

  it("updates only the authenticated session's linked lead when adding a missing phone", async () => {
    const first = await createGeneralSessionViaApi();
    const second = await createGeneralSessionViaApi();
    const emailOnly = { name: CONTACT.name, email: CONTACT.email };
    await agent.post(`/api/public/sessions/${first.sessionId}/contact`)
      .set(authHeader(first.sessionToken)).send(emailOnly).expect(201);
    await agent.post(`/api/public/sessions/${second.sessionId}/contact`)
      .set(authHeader(second.sessionToken)).send(emailOnly).expect(201);
    const firstSession = await GuestSession.findById(first.sessionId);
    const secondSession = await GuestSession.findById(second.sessionId);
    trackedLeadIds.push(firstSession.leadId.toString(), secondSession.leadId.toString());

    await agent.post(`/api/public/sessions/${first.sessionId}/contact`)
      .set(authHeader(first.sessionToken))
      .send({ name: CONTACT.name, phone: "+91 90000 10001", email: CONTACT.email, leadId: secondSession.leadId.toString() })
      .expect(400);
    await agent.post(`/api/public/sessions/${first.sessionId}/contact`)
      .set(authHeader(first.sessionToken))
      .send({ name: CONTACT.name, phone: "+91 90000 10001", email: CONTACT.email })
      .expect(200);

    assert.equal((await Lead.findById(firstSession.leadId)).phone, "+91 90000 10001");
    assert.equal((await Lead.findById(secondSession.leadId)).phone, "Not provided");
    assert.equal(await Lead.countDocuments({ _id: { $in: [firstSession.leadId, secondSession.leadId] } }), 2);
  });

  it("does not overwrite an existing valid phone on repeated contact submission", async () => {
    const { sessionId, sessionToken } = await createGeneralSessionViaApi();
    await agent.post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({ name: CONTACT.name, phone: "+91 90000 20001", email: CONTACT.email })
      .expect(201);
    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());

    await agent.post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({ name: CONTACT.name, phone: "+91 90000 29999", email: CONTACT.email })
      .expect(200);
    assert.equal((await Lead.findById(session.leadId)).phone, "+91 90000 20001");
  });

  it("rejects invalid email-style validation on unsupported fields", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await captureContact(sessionId, sessionToken);

    await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ preferredContactMethod: "sms" })
      .expect(400);
  });

  it("rejects unexpected protected fields", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await captureContact(sessionId, sessionToken);

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({
        message: "Hello",
        executive: "Sneha Rao",
        handoffStatus: "Assigned",
        leadId: new mongoose.Types.ObjectId().toString(),
      })
      .expect(400);

    assert.ok(
      response.body.errors.some((e) => e.includes("Unexpected field")),
    );
  });

  it("preserves the original AI handoff reason when a buyer requests a callback", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    __setGenerateLeadChatTurnForTests(async () => ({
      ok: true,
      data: {
        reply: "A sales executive should confirm availability.",
        preferredLanguage: null,
        qualification: null,
        buyerSummary: null,
        needsHumanHandoff: true,
        handoffReason: "Verified inventory is not available yet",
        recommendQualified: false,
      },
    }));

    await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "How many 2 BHKs are left?" })
      .expect(200);

    await captureContact(sessionId, sessionToken);

    await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({
        preferredContactMethod: "phone",
        message: "Please call after 6 pm.",
      })
      .expect(200);

    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());
    const lead = await Lead.findById(session.leadId);

    assert.equal(lead.handoffStatus, "Pending");
    assert.equal(lead.handoffType, "buyer_callback");
    assert.match(lead.handoffReason, /inventory is not available/i);
    assert.match(lead.handoffAiReason, /inventory is not available/i);
    assert.match(lead.handoffCallbackNote, /after 6 pm/i);
    assert.equal(lead.handoffPreferredContactMethod, "phone");
    assert.equal(
      lead.timeline.filter((e) => e.title === "Human handoff requested").length,
      1,
    );
    assert.equal(
      lead.timeline.filter((e) => e.title === "Buyer callback requested").length,
      1,
    );
  });

  it("does not create duplicate open handoffs on repeat callback requests", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await captureContact(sessionId, sessionToken);

    await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ message: "First request" })
      .expect(201);

    await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ message: "Second request" })
      .expect(200);

    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());
    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.handoffStatus, "Pending");
    assert.equal(
      lead.timeline.filter((e) => e.title === "Buyer callback requested").length,
      1,
    );
    assert.match(lead.handoffCallbackNote, /First request/i);
    assert.doesNotMatch(lead.handoffCallbackNote, /Second request/i);
    assert.doesNotMatch(lead.handoffReason ?? "", /Second request/i);
  });

  it("rejects callback on expired session", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await captureContact(sessionId, sessionToken);

    await GuestSession.findByIdAndUpdate(sessionId, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ message: "Too late" })
      .expect(410);
  });

  it("reopens a buyer callback after a resolved handoff", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await captureContact(sessionId, sessionToken);

    await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ message: "Initial callback" })
      .expect(201);

    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());

    await Lead.findByIdAndUpdate(session.leadId, {
      handoffStatus: "Resolved",
      handoffResolvedAt: new Date(),
    });

    await agent
      .post(`/api/public/sessions/${sessionId}/callback`)
      .set(authHeader(sessionToken))
      .send({ message: "Need help again" })
      .expect(201);

    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.handoffStatus, "Pending");
    assert.equal(lead.handoffType, "buyer_callback");
    assert.equal(lead.handoffResolvedAt, null);
    assert.equal(
      lead.timeline.filter((e) => e.title === "Buyer callback requested").length,
      2,
    );
  });
});
