import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import GuestSession from "../models/GuestSession.js";
import Lead from "../models/Lead.js";
import { GUEST_LEAD_SOURCE } from "../services/guestSessionConversionService.js";

const TEST_PROJECT = "Riverfront Heights";

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

const VALID_CONTACT = {
  name: "Priya Sharma",
  phone: "+91 98765 43210",
  email: "priya@example.com",
};

describe("POST /api/public/sessions/:sessionId/contact", () => {
  before(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    app = createApp();
    agent = request(app);
  });

  afterEach(async () => {
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
    await Lead.deleteMany({ phone: VALID_CONTACT.phone });
  });

  after(async () => {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  async function seedGuestMessages(sessionId) {
    await GuestSession.findByIdAndUpdate(sessionId, {
      $push: {
        messages: {
          $each: [
            {
              from: "buyer",
              text: "What configurations are available?",
              time: "3:00 pm",
              at: new Date(),
            },
            {
              from: "ai",
              text: "I can help with configuration questions.",
              time: "3:01 pm",
              at: new Date(),
            },
          ],
        },
      },
    });
  }

  it("preserves initial project context without promoting it to primary interest", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await seedGuestMessages(sessionId);

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(VALID_CONTACT)
      .expect(201);

    assert.equal(response.body.success, true);
    assert.equal(response.body.contactCaptured, true);
    assert.ok(response.body.confirmation?.message);
    assert.equal(response.body.confirmation.project, TEST_PROJECT);
    assert.equal(response.body.session.contactCaptured, true);
    assert.equal(response.body.lead, undefined);
    assert.equal(response.body.leadId, undefined);

    const session = await GuestSession.findById(sessionId);
    assert.ok(session.leadId);
    trackedLeadIds.push(session.leadId.toString());

    const lead = await Lead.findById(session.leadId);
    assert.ok(lead);
    assert.equal(lead.project, null);
    assert.equal(lead.initialProject, TEST_PROJECT);
    assert.deepEqual(lead.interestedProjects, []);
    assert.deepEqual(lead.interestEvidence, []);
    assert.equal(lead.source, GUEST_LEAD_SOURCE);
    assert.equal(lead.name, VALID_CONTACT.name);
    assert.equal(lead.phone, VALID_CONTACT.phone);
    assert.equal(lead.email, VALID_CONTACT.email);
    assert.notEqual(lead.status, "Qualified");
    assert.equal(lead.status, "Contacted");
    assert.equal(lead.messages.length, 2);
    assert.equal(lead.messages[0].text, "What configurations are available?");

    const conversionEvent = lead.timeline.find(
      (event) => event.title === "Guest contact captured",
    );
    assert.ok(conversionEvent);
  });

  it("converts a General Chat session without a primary project", async () => {
    const { sessionId, sessionToken } = await createGeneralSessionViaApi();
    await seedGuestMessages(sessionId);

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(VALID_CONTACT)
      .expect(201);

    assert.equal(response.body.confirmation.project, null);
    assert.doesNotMatch(response.body.confirmation.message, /null|Skyline Residences/i);
    assert.match(response.body.confirmation.message, /Aarohan enquiry/i);

    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());
    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.project, null);
    assert.equal(lead.initialProject, null);
    assert.deepEqual(lead.interestedProjects, []);
    assert.deepEqual(lead.interestEvidence, []);
    assert.deepEqual(
      lead.messages.map((message) => message.toObject()),
      session.messages.map((message) => message.toObject()),
    );
  });

  it("copies structured session interests and evidence without assigning a primary", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    await seedGuestMessages(sessionId);
    const session = await GuestSession.findById(sessionId);
    const buyerMessageId = session.messages.find((message) => message.from === "buyer")._id;
    const evidenceTime = new Date("2026-01-02T03:04:05.000Z");
    session.interestedProjects = ["Palm Grove Villas"];
    session.interestEvidence = [{
      project: "Palm Grove Villas",
      sourceBuyerMessageId: buyerMessageId,
      type: "explicit_buyer_statement",
      recordedAt: evidenceTime,
    }];
    await session.save();

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(VALID_CONTACT)
      .expect(201);

    const convertedSession = await GuestSession.findById(sessionId);
    trackedLeadIds.push(convertedSession.leadId.toString());
    const lead = await Lead.findById(convertedSession.leadId);
    assert.equal(lead.project, null);
    assert.equal(lead.initialProject, TEST_PROJECT);
    assert.deepEqual(lead.interestedProjects, ["Palm Grove Villas"]);
    assert.equal(lead.interestEvidence.length, 1);
    assert.equal(String(lead.interestEvidence[0].sourceBuyerMessageId), String(buyerMessageId));
    assert.equal(lead.interestEvidence[0].type, "explicit_buyer_statement");
    assert.equal(lead.interestEvidence[0].recordedAt.toISOString(), evidenceTime.toISOString());
  });

  it("continues to validate existing project-valued CRM leads", async () => {
    const lead = await Lead.create({
      name: "Existing Project Lead",
      phone: "+91 90000 00001",
      project: TEST_PROJECT,
      source: GUEST_LEAD_SOURCE,
    });
    trackedLeadIds.push(lead._id.toString());

    assert.equal(lead.project, TEST_PROJECT);
    assert.equal(lead.initialProject, null);
    assert.deepEqual(lead.interestedProjects, []);
  });

  it("rejects duplicate or unapproved interested projects", async () => {
    const lead = new Lead({
      name: "Interest Validation Buyer",
      phone: "+91 90000 00002",
      source: GUEST_LEAD_SOURCE,
      interestedProjects: [TEST_PROJECT, TEST_PROJECT],
    });
    await assert.rejects(lead.validate(), (error) => {
      assert.equal(error.name, "ValidationError");
      assert.match(error.errors.interestedProjects.message, /duplicate/);
      return true;
    });

    lead.interestedProjects = ["Unknown Project"];
    await assert.rejects(lead.validate(), (error) => {
      assert.equal(error.name, "ValidationError");
      return true;
    });
  });

  it("rejects missing name and missing contact methods", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    const missingName = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({ phone: "9876543210" })
      .expect(400);

    assert.ok(
      missingName.body.errors.some((e) => e.includes("name is required")),
    );

    const missingContact = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({ name: "Test Buyer" })
      .expect(400);

    assert.ok(
      missingContact.body.errors.some((e) =>
        e.includes("phone or email is required"),
      ),
    );

    assert.equal(await Lead.countDocuments(), 0);
  });

  it("rejects invalid email", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({
        name: "Test Buyer",
        email: "not-an-email",
      })
      .expect(400);

    assert.ok(
      response.body.errors.some((e) => e.includes("valid email")),
    );
    assert.equal(await Lead.countDocuments(), 0);
  });

  it("rejects expired session before conversion", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    await GuestSession.findByIdAndUpdate(sessionId, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(VALID_CONTACT)
      .expect(410);

    assert.equal(await Lead.countDocuments(), 0);
  });

  it("does not create a second Lead on repeated submission", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send(VALID_CONTACT)
      .expect(201);

    const repeat = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({
        name: "Different Name",
        phone: "9999999999",
      })
      .expect(200);

    assert.equal(repeat.body.contactCaptured, true);
    assert.equal(await Lead.countDocuments(), 1);

    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());
    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.name, VALID_CONTACT.name);
    assert.equal(lead.phone, VALID_CONTACT.phone);
  });

  it("creates only one Lead when contact conversion requests race", async () => {
    const { sessionId, sessionToken } = await createGeneralSessionViaApi();
    const [first, second] = await Promise.all([
      agent
        .post(`/api/public/sessions/${sessionId}/contact`)
        .set(authHeader(sessionToken))
        .send(VALID_CONTACT),
      agent
        .post(`/api/public/sessions/${sessionId}/contact`)
        .set(authHeader(sessionToken))
        .send(VALID_CONTACT),
    ]);

    assert.ok([200, 201].includes(first.status));
    assert.ok([200, 201].includes(second.status));
    assert.equal(await Lead.countDocuments(), 1);
    const session = await GuestSession.findById(sessionId);
    assert.equal(session.contactCaptured, true);
    assert.ok(session.leadId);
    trackedLeadIds.push(session.leadId.toString());
    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.project, null);
    assert.equal(lead.initialProject, null);
  });

  it("rejects protected and unexpected fields on contact capture", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({
        ...VALID_CONTACT,
        project: "Skyline Residences",
        status: "Qualified",
        executive: "Sneha Rao",
        handoffStatus: "Pending",
        handoffType: "ai",
        role: "admin",
        leadId: new mongoose.Types.ObjectId().toString(),
      })
      .expect(400);

    assert.equal(response.body.success, false);
    assert.ok(response.body.errors.some((entry) => entry.includes("project")));
    assert.ok(response.body.errors.some((entry) => entry.includes("leadId")));
    assert.ok(response.body.errors.some((entry) => entry.includes("executive")));
    assert.ok(response.body.errors.some((entry) => entry.includes("status")));
    assert.equal(await Lead.countDocuments(), 0);
  });

  it("accepts email-only contact with placeholder phone on Lead", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    await agent
      .post(`/api/public/sessions/${sessionId}/contact`)
      .set(authHeader(sessionToken))
      .send({
        name: "Email Only Buyer",
        email: "buyer@example.com",
      })
      .expect(201);

    const session = await GuestSession.findById(sessionId);
    trackedLeadIds.push(session.leadId.toString());
    const lead = await Lead.findById(session.leadId);
    assert.equal(lead.email, "buyer@example.com");
    assert.equal(lead.phone, "Not provided");
  });
});
