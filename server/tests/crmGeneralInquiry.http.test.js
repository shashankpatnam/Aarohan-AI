import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import Lead from "../models/Lead.js";
import {
  __resetGenerateLeadChatTurnForTests,
  __setGenerateLeadChatTurnForTests,
} from "../services/leadChatTurnResolver.js";
import {
  attachStaffAuth,
  seedCrmStaffToken,
} from "./helpers/staffAuth.js";

const PROJECT_A = "Skyline Residences";
const PROJECT_B = "Green Valley Phase 2";
let memoryServer;
let agent;
let publicAgent;

describe("CRM APIs for General Inquiry leads", () => {
  before(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    const app = createApp();
    const { token } = await seedCrmStaffToken();
    agent = attachStaffAuth(request(app), () => token);
    publicAgent = request(app);
  });

  afterEach(async () => {
    __resetGenerateLeadChatTurnForTests();
    await Lead.deleteMany({});
  });

  after(async () => {
    __resetGenerateLeadChatTurnForTests();
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  async function makeLead(overrides = {}) {
    return Lead.create({ name: "CRM Buyer", phone: "9000000011", source: "Website", ...overrides });
  }

  it("lists general inquiries, filters primary and interested project independently, and searches the General Inquiry label", async () => {
    const general = await makeLead({ name: "General Search Buyer", project: null, interestedProjects: [PROJECT_B] });
    await makeLead({ name: "Primary Buyer", project: PROJECT_A, interestedProjects: [PROJECT_A, PROJECT_B] });
    await makeLead({ name: "Other Project Buyer", project: PROJECT_B, interestedProjects: [PROJECT_B] });

    const generalFilter = await agent.get("/api/leads?project=General%20Inquiry").expect(200);
    assert.deepEqual(generalFilter.body.leads.map((lead) => lead.id), [String(general._id)]);
    assert.equal(generalFilter.body.leads[0].projectLabel, "General Inquiry");

    const primary = await agent.get(`/api/leads?project=${encodeURIComponent(PROJECT_A)}`).expect(200);
    assert.equal(primary.body.leads.length, 1);
    assert.equal(primary.body.leads[0].project, PROJECT_A);

    const interested = await agent.get(`/api/leads?interestedProject=${encodeURIComponent(PROJECT_B)}`).expect(200);
    assert.equal(interested.body.leads.length, 3);

    const search = await agent.get("/api/leads?search=General%20Inquiry").expect(200);
    assert.equal(search.body.leads.length, 1);
    assert.equal(search.body.leads[0].id, String(general._id));
    await agent.get(`/api/leads?project=${encodeURIComponent(PROJECT_A)}&interestedProject=${encodeURIComponent(PROJECT_B)}`).expect(200);
  });

  it("creates a General Inquiry without a project and preserves existing project lead creation", async () => {
    const general = await agent.post("/api/leads").send({ name: "No Project", phone: "9000000012", source: "Referral" }).expect(201);
    assert.equal(general.body.lead.project, null);
    assert.equal(general.body.lead.projectLabel, "General Inquiry");
    assert.deepEqual(general.body.lead.interestedProjects, []);
    assert.match(general.body.lead.timeline[0].detail, /General Inquiry/);

    const project = await agent.post("/api/leads").send({ name: "With Project", phone: "9000000013", project: PROJECT_A, source: "Website" }).expect(201);
    assert.equal(project.body.lead.project, PROJECT_A);
    assert.deepEqual(project.body.lead.interestedProjects, [PROJECT_A]);
    await agent.post("/api/leads").send({ name: "Invalid Project", phone: "9000000014", project: "Unapproved", source: "Website" }).expect(400);
  });

  it("returns structured fields to staff and supports explicit primary-project updates", async () => {
    const buyerMessageId = new mongoose.Types.ObjectId();
    const lead = await makeLead({
      name: "Structured General Buyer",
      project: null,
      initialProject: PROJECT_B,
      interestedProjects: [PROJECT_A, PROJECT_B],
      interestEvidence: [{ project: PROJECT_A, sourceBuyerMessageId: buyerMessageId, type: "explicit_buyer_statement", recordedAt: new Date() }],
    });
    const detail = await agent.get(`/api/leads/${lead._id}`).expect(200);
    assert.equal(detail.body.lead.project, null);
    assert.equal(detail.body.lead.projectLabel, "General Inquiry");
    assert.equal(detail.body.lead.initialProject, PROJECT_B);
    assert.deepEqual(detail.body.lead.interestedProjects, [PROJECT_A, PROJECT_B]);
    assert.equal(detail.body.lead.interestEvidence.length, 1);

    const updated = await agent.patch(`/api/leads/${lead._id}`).send({ project: PROJECT_A }).expect(200);
    assert.equal(updated.body.lead.project, PROJECT_A);
    assert.ok(updated.body.lead.interestedProjects.includes(PROJECT_A));
    assert.equal(updated.body.lead.initialProject, PROJECT_B);
    await agent.patch(`/api/leads/${lead._id}`).send({ project: "Bad Project" }).expect(400);
  });

  it("labels General Inquiry handoffs and retains authorization boundaries", async () => {
    const lead = await makeLead({ project: null, handoffStatus: "Pending", handoffReason: "Needs follow-up", handoffRequestedAt: new Date() });
    const list = await agent.get("/api/handoffs?status=pending").expect(200);
    const row = list.body.handoffs.find((item) => item.leadId === String(lead._id));
    assert.equal(row.project, null);
    assert.equal(row.projectLabel, "General Inquiry");
    assert.deepEqual(row.interestedProjects, []);

    await publicAgent.get("/api/leads").expect(401);
    await publicAgent.get(`/api/leads/${lead._id}`).expect(401);
    await publicAgent.get("/api/analytics").expect(401);
    await publicAgent.get("/api/handoffs").expect(401);
  });

  it("passes distinct initial, primary and interested context to staff CRM chat", async () => {
    const lead = await makeLead({ project: null, initialProject: PROJECT_A, interestedProjects: [PROJECT_A, PROJECT_B] });
    let captured;
    __setGenerateLeadChatTurnForTests(async (input) => {
      captured = input;
      return { ok: true, data: { reply: "How can I help?", preferredLanguage: null, qualification: null, buyerSummary: null, needsHumanHandoff: false, handoffReason: null, recommendQualified: false } };
    });
    await agent.post(`/api/leads/${lead._id}/chat`).send({ message: "Can you help?" }).expect(200);
    assert.equal(captured.initialProject, PROJECT_A);
    assert.equal(captured.leadContext.initialProject, PROJECT_A);
    assert.equal(captured.leadContext.primaryProject, null);
    assert.deepEqual(captured.leadContext.interestedProjects, [PROJECT_A, PROJECT_B]);
  });

  it("reports unique lead totals, General Inquiry, primary and non-exclusive interest counts", async () => {
    await makeLead({ project: null, interestedProjects: [PROJECT_A, PROJECT_B] });
    await makeLead({ project: PROJECT_A, interestedProjects: [PROJECT_A, PROJECT_B] });
    await makeLead({ project: PROJECT_A, interestedProjects: [PROJECT_A] });

    const result = await agent.get("/api/analytics").expect(200);
    assert.equal(result.body.leads.totalUniqueLeads, 3);
    assert.equal(result.body.leads.totalInRange, 3);
    assert.equal(result.body.leads.generalInquiryCount, 1);
    assert.equal(result.body.leads.byPrimaryProject.find((row) => row.project === PROJECT_A).count, 2);
    assert.equal(result.body.leads.byInterestedProject.find((row) => row.project === PROJECT_A).count, 3);
    assert.equal(result.body.leads.byInterestedProject.find((row) => row.project === PROJECT_B).count, 2);
  });
});
