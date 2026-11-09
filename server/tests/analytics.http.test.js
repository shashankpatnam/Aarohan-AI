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
import SiteVisit, { VISIT_SLOTS } from "../models/SiteVisit.js";

const TEST_PROJECT = "Green Valley Phase 2";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("supertest").Agent} */
let agent;

function todayIsoLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isoOffset(days) {
  const [year, month, day] = todayIsoLocal().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

async function createLead(name, options = {}) {
  return Lead.create({
    name,
    phone: "9000000100",
    project: TEST_PROJECT,
    source: "Website",
    status: "Contacted",
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  });
}

async function createVisit(lead, { project = TEST_PROJECT, visitDate, status = "Scheduled" }) {
  return SiteVisit.create({
    lead: lead._id,
    buyerName: lead.name,
    project,
    visitDate,
    slot: VISIT_SLOTS[0],
    executive: "Sneha Rao",
    status,
    bookedAt: new Date(),
  });
}

describe("Analytics HTTP integration", () => {
  before(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    const app = createApp();
    const { token } = await seedCrmStaffToken();
    agent = attachStaffAuth(request(app), () => token);
  });

  afterEach(async () => {
    await SiteVisit.deleteMany({});
    await Lead.deleteMany({});
  });

  after(async () => {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("distinguishes total, active scheduled, overdue, completed, and cancelled visits", async () => {
    const future = await createLead("Analytics Future");
    const overdue = await createLead("Analytics Overdue");
    const cancelled = await createLead("Analytics Cancelled");
    const completed = await createLead("Analytics Completed");
    const now = new Date();

    await SiteVisit.create([
      {
        lead: future._id,
        buyerName: future.name,
        project: TEST_PROJECT,
        visitDate: isoOffset(3),
        slot: VISIT_SLOTS[0],
        executive: "Sneha Rao",
        status: "Scheduled",
        bookedAt: now,
      },
      {
        lead: overdue._id,
        buyerName: overdue.name,
        project: TEST_PROJECT,
        visitDate: isoOffset(-3),
        slot: VISIT_SLOTS[1],
        executive: "Sneha Rao",
        status: "Scheduled",
        bookedAt: now,
      },
      {
        lead: cancelled._id,
        buyerName: cancelled.name,
        project: TEST_PROJECT,
        visitDate: isoOffset(4),
        slot: VISIT_SLOTS[2],
        executive: "Sneha Rao",
        status: "Cancelled",
        bookedAt: now,
      },
      {
        lead: completed._id,
        buyerName: completed.name,
        project: TEST_PROJECT,
        visitDate: isoOffset(-1),
        slot: VISIT_SLOTS[3],
        executive: "Sneha Rao",
        status: "Completed",
        bookedAt: now,
      },
    ]);

    const response = await agent.get("/api/analytics").expect(200);
    const counts = response.body.visits.counts;
    assert.equal(counts.total, 4);
    assert.equal(counts.activeScheduled, 1);
    assert.equal(counts.overdueScheduled, 1);
    assert.equal(counts.completed, 1);
    assert.equal(counts.cancelled, 1);
    assert.equal(response.body.visits.byStatus.Cancelled, 1);
    assert.equal(response.body.visits.byStatus.Scheduled, 2);

    const ranged = await agent
      .get(`/api/analytics?from=${todayIsoLocal()}&to=${isoOffset(10)}`)
      .expect(200);
    assert.equal(ranged.body.visits.counts.activeScheduled, 1);
    assert.equal(ranged.body.visits.counts.cancelled, 1);
    assert.equal(ranged.body.visits.counts.overdueScheduled, 0);
  });

  it("includes both inclusive IST createdAt date boundaries", async () => {
    await createLead("Before IST day", { createdAt: new Date("2025-12-31T18:29:59.999Z") });
    await createLead("IST day start", { createdAt: new Date("2025-12-31T18:30:00.000Z") });
    await createLead("IST day end", { createdAt: new Date("2026-01-01T18:29:59.999Z") });
    await createLead("After IST day", { createdAt: new Date("2026-01-01T18:30:00.000Z") });

    const response = await agent.get("/api/analytics?from=2026-01-01&to=2026-01-01").expect(200);
    assert.equal(response.body.leads.totalUniqueLeads, 2);
    assert.match(response.body.filters.leadDateDescription, /Asia\/Kolkata/);
  });

  it("rejects invalid and reversed date ranges", async () => {
    await agent.get("/api/analytics?from=2026-02-30").expect(400);
    await agent.get("/api/analytics?from=2026-02-02&to=2026-02-01").expect(400);
  });

  it("uses the visit project and keeps a lead created outside the range", async () => {
    const lead = await createLead("Different visit project", { createdAt: new Date("2025-01-01T00:00:00Z") });
    await createVisit(lead, { project: "Palm Grove Villas", visitDate: "2026-01-15" });

    const response = await agent.get("/api/analytics?from=2026-01-15&to=2026-01-15").expect(200);
    assert.equal(response.body.leads.totalUniqueLeads, 0);
    assert.equal(response.body.visits.counts.total, 1);
    assert.equal(response.body.visits.byProject.find((row) => row.project === "Palm Grove Villas").count, 1);
    assert.equal(response.body.visits.byProject.find((row) => row.project === TEST_PROJECT).count, 0);
  });

  it("deduplicates repeated legacy interests and retains unexpected historical values", async () => {
    const leadId = new mongoose.Types.ObjectId();
    await Lead.collection.insertOne({
      _id: leadId,
      name: "Legacy lead",
      phone: "9000000101",
      email: "",
      project: "Unknown Legacy Project",
      source: "Legacy Source",
      status: "Legacy Status",
      interestedProjects: ["Palm Grove Villas", "Palm Grove Villas", "Legacy Interest"],
      createdAt: new Date("2026-01-15T06:30:00.000Z"),
      updatedAt: new Date("2026-01-15T06:30:00.000Z"),
    });

    const response = await agent.get("/api/analytics?from=2026-01-15&to=2026-01-15").expect(200);
    assert.equal(response.body.leads.totalUniqueLeads, 1);
    assert.equal(response.body.leads.byInterestedProject.find((row) => row.project === "Palm Grove Villas").count, 1);
    assert.equal(response.body.leads.byInterestedProject.find((row) => row.project === "Legacy Interest").count, 1);
    assert.equal(response.body.leads.byPrimaryProject.find((row) => row.project === "Unknown Legacy Project").count, 1);
    assert.equal(response.body.leads.bySource.find((row) => row.source === "Legacy Source").count, 1);
    assert.equal(response.body.leads.byStatus["Legacy Status"], 1);
  });

  it("returns zero metrics for empty and one-sided datasets", async () => {
    const empty = await agent.get("/api/analytics").expect(200);
    assert.equal(empty.body.leads.totalUniqueLeads, 0);
    assert.equal(empty.body.visits.counts.total, 0);

    const lead = await createLead("Lead only");
    const leadsOnly = await agent.get("/api/analytics").expect(200);
    assert.equal(leadsOnly.body.leads.totalUniqueLeads, 1);
    assert.equal(leadsOnly.body.visits.counts.total, 0);
    await Lead.deleteMany({});

    await createVisit(lead, { visitDate: todayIsoLocal() });
    const visitsOnly = await agent.get("/api/analytics").expect(200);
    assert.equal(visitsOnly.body.leads.totalUniqueLeads, 0);
    assert.equal(visitsOnly.body.visits.counts.total, 1);
  });
});
