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
import StaffUser from "../models/StaffUser.js";
import { applyBuyerCallbackHandoff } from "../services/leadHandoffService.js";
import ProjectFacts from "../models/ProjectFacts.js";
import {
  __resetGenerateLeadChatTurnForTests,
  __setGenerateLeadChatTurnForTests,
} from "../services/leadChatTurnResolver.js";

const TEST_PROJECT = "Green Valley Phase 2";
let ASSIGN_EXECUTIVE_ID;
let ASSIGN_EXECUTIVE_NAME;

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("express").Express} */
let app;
/** @type {import("supertest").Agent} */
let agent;

const trackedLeadIds = [];
const trackedStaffIds = [];

function mockChatHandoffTurn(handoffReason = "Buyer requested human follow-up") {
  __setGenerateLeadChatTurnForTests(async () => ({
    ok: true,
    data: {
      reply: "Thanks — our team will follow up with verified details.",
      preferredLanguage: null,
      qualification: null,
      buyerSummary: null,
      needsHumanHandoff: true,
      handoffReason,
      recommendQualified: false,
    },
  }));
}

async function upsertApprovedFacts() {
  await ProjectFacts.updateOne(
    { projectName: TEST_PROJECT },
    {
      $set: {
        projectName: TEST_PROJECT,
        approvalStatus: "approved",
        location: "Demo location",
        propertyConfigurations: [],
        amenities: [],
        possessionTimeline: null,
        reraInformation: null,
        visitProcess: null,
        priceInformation: null,
        inventoryInformation: null,
      },
    },
    { upsert: true },
  );
}

async function createTestLead(overrides = {}) {
  const lead = await Lead.create({
    name: "Handoff Test Buyer",
    phone: "9000000088",
    project: TEST_PROJECT,
    source: "Website",
    status: "Contacted",
    ...overrides,
  });
  trackedLeadIds.push(lead._id);
  return lead;
}

async function loadLead(id) {
  return Lead.findById(id);
}

function countTimelineByTitle(lead, title) {
  return (lead?.timeline ?? []).filter((event) => event.title === title).length;
}

function postChat(leadId, message = "Please have someone call me.", expectedStatus = 200) {
  const chain = agent
    .post(`/api/leads/${leadId.toString()}/chat`)
    .send({ message });
  return expectedStatus == null ? chain : chain.expect(expectedStatus);
}

describe("Handoff HTTP integration", () => {
  before(async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    app = createApp();
    const { token, user } = await seedCrmStaffToken();
    ASSIGN_EXECUTIVE_ID = user.id;
    ASSIGN_EXECUTIVE_NAME = user.name;
    agent = attachStaffAuth(request(app), () => token);
  });

  afterEach(async () => {
    __resetGenerateLeadChatTurnForTests();
    if (trackedLeadIds.length > 0) {
      await Lead.deleteMany({ _id: { $in: trackedLeadIds } });
      trackedLeadIds.length = 0;
    }
    if (trackedStaffIds.length > 0) {
      await StaffUser.deleteMany({ _id: { $in: trackedStaffIds } });
      trackedStaffIds.length = 0;
    }
    await ProjectFacts.deleteMany({ projectName: TEST_PROJECT });
  });

  after(async () => {
    __resetGenerateLeadChatTurnForTests();
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("lists pending handoffs with expected lead and handoff fields", async () => {
    const lead = await createTestLead();
    mockChatHandoffTurn("Pricing needs executive confirmation");
    await upsertApprovedFacts();

    await postChat(lead._id, "Please have someone call me.", 200);

    const list = await agent.get("/api/handoffs?status=pending").expect(200);

    assert.equal(list.body.success, true);
    assert.ok(list.body.summary.pending >= 1);
    const row = list.body.handoffs.find((item) => item.leadId === lead._id.toString());
    assert.ok(row);
    assert.equal(row.handoffStatus, "Pending");
    assert.equal(row.buyerName, "Handoff Test Buyer");
    assert.equal(row.phone, "9000000088");
    assert.equal(row.email, "");
    assert.equal(row.project, TEST_PROJECT);
    assert.match(row.handoffReason, /executive confirmation/i);
    assert.ok(row.handoffRequestedAt);
  });

  it("assigns a pending handoff to an executive", async () => {
    const lead = await createTestLead({
      handoffStatus: "Pending",
      handoffReason: "Demo pending handoff",
      handoffRequestedAt: new Date(),
    });

    const response = await agent
      .patch(`/api/handoffs/${lead._id.toString()}/assign`)
      .send({ executiveId: ASSIGN_EXECUTIVE_ID })
      .expect(200);

    assert.equal(response.body.success, true);
    assert.equal(response.body.handoff.handoffStatus, "Assigned");
    assert.equal(response.body.handoff.executive, ASSIGN_EXECUTIVE_NAME);

    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Assigned");
    assert.equal(saved.executive, ASSIGN_EXECUTIVE_NAME);
    assert.equal(countTimelineByTitle(saved, "Handoff assigned"), 1);
  });

  it("rejects invalid executive assignment payloads", async () => {
    const lead = await createTestLead({
      handoffStatus: "Pending",
      handoffReason: "Needs assign validation",
      handoffRequestedAt: new Date(),
    });

    await agent
      .patch(`/api/handoffs/${lead._id.toString()}/assign`)
      .send({ executiveId: "" })
      .expect(400);

    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Pending");
    assert.equal(countTimelineByTitle(saved, "Handoff assigned"), 0);
  });

  it("rejects inactive and non-staff assignment targets", async () => {
    const inactive = await StaffUser.create({ name: "Inactive Staff", email: "inactive@handoff.test", passwordHash: "hash", role: "staff", isActive: false });
    trackedStaffIds.push(inactive._id);
    const admin = await StaffUser.create({ name: "Handoff Admin", email: "admin@handoff.test", passwordHash: "hash", role: "admin", isActive: true });
    trackedStaffIds.push(admin._id);
    const lead = await createTestLead({ handoffStatus: "Pending", handoffRequestedAt: new Date() });
    await agent.patch(`/api/handoffs/${lead.id}/assign`).send({ executiveId: inactive.id }).expect(400);
    await agent.patch(`/api/handoffs/${lead.id}/assign`).send({ executiveId: admin.id }).expect(400);
    assert.equal((await loadLead(lead._id)).handoffStatus, "Pending");
  });

  it("reassigns an assigned handoff to another active staff account", async () => {
    const replacement = await StaffUser.create({ name: "Replacement Staff", email: "replacement@handoff.test", passwordHash: "hash", role: "staff", isActive: true });
    trackedStaffIds.push(replacement._id);
    const lead = await createTestLead({ handoffStatus: "Assigned", executive: ASSIGN_EXECUTIVE_NAME, handoffRequestedAt: new Date() });
    const response = await agent.patch(`/api/handoffs/${lead.id}/assign`).send({ executiveId: replacement.id }).expect(200);
    assert.equal(response.body.handoff.executive, replacement.name);
    assert.equal(countTimelineByTitle(await loadLead(lead._id), "Handoff assigned"), 1);
  });

  it("rejects assignment to resolved handoffs", async () => {
    const lead = await createTestLead({ handoffStatus: "Resolved", executive: ASSIGN_EXECUTIVE_NAME, handoffRequestedAt: new Date(), handoffResolvedAt: new Date() });
    await agent.patch(`/api/handoffs/${lead.id}/assign`).send({ executiveId: ASSIGN_EXECUTIVE_ID }).expect(409);
  });

  it("resolves an assigned handoff and records resolution", async () => {
    const lead = await createTestLead({
      handoffStatus: "Assigned",
      handoffReason: "Assigned for demo",
      handoffRequestedAt: new Date(),
      executive: ASSIGN_EXECUTIVE_NAME,
    });

    const response = await agent
      .patch(`/api/handoffs/${lead._id.toString()}/resolve`)
      .send({})
      .expect(200);

    assert.equal(response.body.handoff.handoffStatus, "Resolved");
    assert.ok(response.body.handoff.handoffResolvedAt);

    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Resolved");
    assert.ok(saved.handoffResolvedAt);
    assert.equal(countTimelineByTitle(saved, "Handoff resolved"), 1);
  });

  it("rejects repeated resolution without duplicating timeline events", async () => {
    const lead = await createTestLead({
      handoffStatus: "Assigned",
      handoffReason: "Resolve once",
      handoffRequestedAt: new Date(),
      executive: ASSIGN_EXECUTIVE_NAME,
    });

    await agent
      .patch(`/api/handoffs/${lead._id.toString()}/resolve`)
      .expect(200);

    const repeat = await agent
      .patch(`/api/handoffs/${lead._id.toString()}/resolve`)
      .expect(409);

    assert.match(repeat.body.message, /already resolved/i);

    const saved = await loadLead(lead._id);
    assert.equal(countTimelineByTitle(saved, "Handoff resolved"), 1);
  });

  it("allows only one of two concurrent resolution requests to transition the handoff", async () => {
    const lead = await createTestLead({ handoffStatus: "Pending", handoffRequestedAt: new Date() });
    const results = await Promise.all([
      agent.patch(`/api/handoffs/${lead.id}/resolve`).send({}),
      agent.patch(`/api/handoffs/${lead.id}/resolve`).send({}),
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    assert.equal(countTimelineByTitle(await loadLead(lead._id), "Handoff resolved"), 1);
  });

  it("lists resolved handoffs with resolved counts and pagination metadata", async () => {
    const lead = await createTestLead({ handoffStatus: "Resolved", handoffRequestedAt: new Date(), handoffResolvedAt: new Date() });
    const response = await agent.get("/api/handoffs?status=resolved&page=1&pageSize=1").expect(200);
    assert.ok(response.body.handoffs.some((item) => item.leadId === lead.id));
    assert.ok(response.body.summary.resolved >= 1);
    assert.equal(response.body.pagination.pageSize, 1);
    assert.ok(response.body.pagination.total >= 1);
  });

  it("opens a new pending handoff after chat following a resolved handoff", async () => {
    const lead = await createTestLead({
      handoffStatus: "Resolved",
      handoffReason: "Old resolved handoff",
      handoffRequestedAt: new Date(Date.now() - 86_400_000),
      handoffResolvedAt: new Date(),
      executive: ASSIGN_EXECUTIVE_NAME,
    });

    mockChatHandoffTurn("New issue after resolution");
    await upsertApprovedFacts();

    await postChat(lead._id, "I still need help with inventory.", 200);

    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Pending");
    assert.match(saved.handoffReason, /New issue after resolution/i);
    assert.equal(saved.handoffResolvedAt, null);
    assert.equal(countTimelineByTitle(saved, "Human handoff requested"), 1);
  });

  it("reuses an open pending handoff across repeated chat turns without duplicate timeline entries", async () => {
    const lead = await createTestLead();
    mockChatHandoffTurn("First chat handoff");
    await upsertApprovedFacts();

    await postChat(lead._id, "First message", 200);
    await postChat(lead._id, "Second message", 200);

    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Pending");
    assert.equal(countTimelineByTitle(saved, "Human handoff requested"), 1);
    assert.equal(saved.messages.length, 4);
  });

  it("assigns and resolves after a buyer callback upgrades an open AI handoff", async () => {
    const lead = await createTestLead();
    mockChatHandoffTurn("Inventory is not in approved facts");
    await upsertApprovedFacts();
    await postChat(lead._id, "How many units are left?", 200);

    const afterChat = await loadLead(lead._id);
    applyBuyerCallbackHandoff(
      afterChat,
      { note: "Please call this afternoon.", preferredContactMethod: "phone" },
      new Date(),
    );
    await afterChat.save();

    assert.equal(afterChat.handoffType, "buyer_callback");
    assert.match(afterChat.handoffReason, /approved facts/i);
    assert.match(afterChat.handoffAiReason, /approved facts/i);
    assert.match(afterChat.handoffCallbackNote, /this afternoon/i);

    const assigned = await agent
      .patch(`/api/handoffs/${lead._id.toString()}/assign`)
      .send({ executiveId: ASSIGN_EXECUTIVE_ID })
      .expect(200);

    assert.equal(assigned.body.handoff.handoffStatus, "Assigned");
    assert.match(assigned.body.handoff.handoffAiReason, /approved facts/i);
    assert.equal(assigned.body.handoff.handoffCallbackNote, afterChat.handoffCallbackNote);

    const resolved = await agent
      .patch(`/api/handoffs/${lead._id.toString()}/resolve`)
      .expect(200);

    assert.equal(resolved.body.handoff.handoffStatus, "Resolved");
    const saved = await loadLead(lead._id);
    assert.equal(saved.handoffStatus, "Resolved");
    assert.match(saved.handoffAiReason, /approved facts/i);
    assert.equal(countTimelineByTitle(saved, "Handoff assigned"), 1);
    assert.equal(countTimelineByTitle(saved, "Handoff resolved"), 1);
  });
});
