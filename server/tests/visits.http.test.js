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
const TEST_EXECUTIVE = "Demo Executive";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("express").Express} */
let app;
/** @type {import("supertest").Agent} */
let agent;

const trackedLeadIds = [];

function futureVisitDate(daysFromNow = 2) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function pastVisitDate() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - 2);
  return date.toISOString().slice(0, 10);
}

function validBookingBody(overrides = {}) {
  return {
    visitDate: futureVisitDate(3),
    slot: VISIT_SLOTS[0],
    executive: TEST_EXECUTIVE,
    notes: "",
    ...overrides,
  };
}

async function createTestLead(overrides = {}) {
  const lead = await Lead.create({
    name: "Visit Test Buyer",
    phone: "9000000099",
    project: TEST_PROJECT,
    source: "Website",
    status: "New",
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

describe("Site visit HTTP integration", () => {
  before(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    app = createApp();
    const { token } = await seedCrmStaffToken();
    agent = attachStaffAuth(request(app), () => token);
  });

  afterEach(async () => {
    if (trackedLeadIds.length > 0) {
      await SiteVisit.deleteMany({ lead: { $in: trackedLeadIds } });
      await Lead.deleteMany({ _id: { $in: trackedLeadIds } });
      trackedLeadIds.length = 0;
    }
  });

  after(async () => {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("books a visit successfully and sets lead status to Visit booked", async () => {
    const lead = await createTestLead({ status: "Qualified" });
    const body = validBookingBody();

    const response = await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(body)
      .expect(201);

    assert.equal(response.body.success, true);
    assert.equal(response.body.visit.project, TEST_PROJECT);
    assert.equal(response.body.visit.status, "Scheduled");
    assert.equal(response.body.visit.slot, body.slot);
    assert.equal(response.body.visit.visitDate, body.visitDate);

    const savedLead = await loadLead(lead._id);
    assert.equal(savedLead.status, "Visit booked");
    assert.equal(savedLead.statusBeforeVisit, "Qualified");

    const visitCount = await SiteVisit.countDocuments({ lead: lead._id });
    assert.equal(visitCount, 1);
  });

  it("rejects a conflicting booking with 409 and does not create another visit", async () => {
    const leadA = await createTestLead({ status: "Contacted" });
    const leadB = await createTestLead({ status: "Contacted" });
    const body = validBookingBody();

    await agent
      .post(`/api/leads/${leadA._id.toString()}/visits`)
      .send(body)
      .expect(201);

    const conflict = await agent
      .post(`/api/leads/${leadB._id.toString()}/visits`)
      .send(body)
      .expect(409);

    assert.equal(conflict.body.success, false);
    assert.match(conflict.body.message, /slot|booked|conflict/i);

    const visitsForSlot = await SiteVisit.countDocuments({
      project: TEST_PROJECT,
      visitDate: body.visitDate,
      slot: body.slot,
      status: "Scheduled",
    });
    assert.equal(visitsForSlot, 1);

    const secondOnSameLead = await agent
      .post(`/api/leads/${leadA._id.toString()}/visits`)
      .send(validBookingBody({ slot: VISIT_SLOTS[1] }))
      .expect(409);

    assert.match(secondOnSameLead.body.message, /already has a scheduled/i);
    assert.equal(await SiteVisit.countDocuments({ lead: leadA._id }), 1);
  });

  it("rejects invalid or incomplete booking payloads with 400", async () => {
    const lead = await createTestLead();

    await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(validBookingBody({ executive: "" }))
      .expect(400);

    await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(validBookingBody({ slot: "9:99 AM" }))
      .expect(400);

    await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(validBookingBody({ visitDate: pastVisitDate() }))
      .expect(400);

    assert.equal(await SiteVisit.countDocuments({ lead: lead._id }), 0);
    const savedLead = await loadLead(lead._id);
    assert.notEqual(savedLead.status, "Visit booked");
  });

  it("cancels a scheduled visit and restores the lead prior status", async () => {
    const lead = await createTestLead({ status: "Qualified" });
    const book = await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(validBookingBody())
      .expect(201);

    const visitId = book.body.visit.id;

    const cancel = await agent
      .patch(`/api/visits/${visitId}/status`)
      .send({ status: "Cancelled" })
      .expect(200);

    assert.equal(cancel.body.visit.status, "Cancelled");

    const savedLead = await loadLead(lead._id);
    assert.equal(savedLead.status, "Qualified");
    assert.equal(savedLead.statusBeforeVisit, null);
    assert.equal(countTimelineByTitle(savedLead, "Site visit cancelled"), 1);
  });

  it("completes a visit without restoring the lead to an earlier pipeline status", async () => {
    const lead = await createTestLead({ status: "Qualified" });
    const book = await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(validBookingBody())
      .expect(201);

    const visitId = book.body.visit.id;

    await agent
      .patch(`/api/visits/${visitId}/status`)
      .send({ status: "Completed" })
      .expect(200);

    const savedLead = await loadLead(lead._id);
    assert.equal(savedLead.status, "Visit booked");
    assert.equal(savedLead.statusBeforeVisit, "Qualified");
    assert.equal(countTimelineByTitle(savedLead, "Site visit completed"), 1);
    assert.equal(countTimelineByTitle(savedLead, "Site visit cancelled"), 0);
  });

  it("blocks lead status PATCH while a scheduled visit exists", async () => {
    const lead = await createTestLead({ status: "Qualified" });
    await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(validBookingBody())
      .expect(201);

    const blocked = await agent
      .patch(`/api/leads/${lead._id.toString()}`)
      .send({ status: "Contacted" })
      .expect(409);

    assert.equal(blocked.body.success, false);
    assert.match(blocked.body.message, /site visit is scheduled/i);

    const savedLead = await loadLead(lead._id);
    assert.equal(savedLead.status, "Visit booked");
  });

  it("returns 409 on repeated cancel or complete without duplicate timeline events", async () => {
    const lead = await createTestLead({ status: "Contacted" });
    const book = await agent
      .post(`/api/leads/${lead._id.toString()}/visits`)
      .send(validBookingBody())
      .expect(201);

    const visitId = book.body.visit.id;

    await agent
      .patch(`/api/visits/${visitId}/status`)
      .send({ status: "Cancelled" })
      .expect(200);

    const repeatCancel = await agent
      .patch(`/api/visits/${visitId}/status`)
      .send({ status: "Cancelled" })
      .expect(409);

    assert.match(repeatCancel.body.message, /Only scheduled visits/i);

    const afterCancel = await loadLead(lead._id);
    assert.equal(countTimelineByTitle(afterCancel, "Site visit cancelled"), 1);

    const lead2 = await createTestLead({ status: "New" });
    const book2 = await agent
      .post(`/api/leads/${lead2._id.toString()}/visits`)
      .send(validBookingBody({ slot: VISIT_SLOTS[2] }))
      .expect(201);

    const visitId2 = book2.body.visit.id;

    await agent
      .patch(`/api/visits/${visitId2}/status`)
      .send({ status: "Completed" })
      .expect(200);

    await agent
      .patch(`/api/visits/${visitId2}/status`)
      .send({ status: "Completed" })
      .expect(409);

    const afterComplete = await loadLead(lead2._id);
    assert.equal(countTimelineByTitle(afterComplete, "Site visit completed"), 1);
  });

  it("visit summary counts active scheduled separately from past, completed, and cancelled", async () => {
    const futureLead = await createTestLead({ name: "Future Visit Buyer" });
    const todayLead = await createTestLead({ name: "Today Visit Buyer" });
    const pastLead = await createTestLead({ name: "Past Visit Buyer" });
    const cancelledLead = await createTestLead({ name: "Cancelled Visit Buyer" });
    const completedLead = await createTestLead({ name: "Completed Visit Buyer" });

    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const now = new Date();

    await SiteVisit.create([
      {
        lead: futureLead._id,
        buyerName: futureLead.name,
        project: TEST_PROJECT,
        visitDate: futureVisitDate(4),
        slot: VISIT_SLOTS[0],
        executive: TEST_EXECUTIVE,
        status: "Scheduled",
        bookedAt: now,
      },
      {
        lead: todayLead._id,
        buyerName: todayLead.name,
        project: TEST_PROJECT,
        visitDate: todayIso,
        slot: VISIT_SLOTS[1],
        executive: TEST_EXECUTIVE,
        status: "Scheduled",
        bookedAt: now,
      },
      {
        lead: pastLead._id,
        buyerName: pastLead.name,
        project: TEST_PROJECT,
        visitDate: pastVisitDate(),
        slot: VISIT_SLOTS[2],
        executive: TEST_EXECUTIVE,
        status: "Scheduled",
        bookedAt: now,
      },
      {
        lead: cancelledLead._id,
        buyerName: cancelledLead.name,
        project: TEST_PROJECT,
        visitDate: futureVisitDate(5),
        slot: VISIT_SLOTS[3],
        executive: TEST_EXECUTIVE,
        status: "Cancelled",
        bookedAt: now,
      },
      {
        lead: completedLead._id,
        buyerName: completedLead.name,
        project: TEST_PROJECT,
        visitDate: pastVisitDate(),
        slot: VISIT_SLOTS[4],
        executive: TEST_EXECUTIVE,
        status: "Completed",
        bookedAt: now,
      },
    ]);

    const listed = await agent.get("/api/visits").expect(200);
    const summary = listed.body.summary;
    assert.equal(summary.upcoming, 1);
    assert.equal(summary.today, 1);
    assert.equal(summary.activeScheduled, 2);
    assert.equal(summary.overdueScheduled, 1);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.total, 5);

    const upcoming = await agent.get("/api/visits?date=upcoming").expect(200);
    const upcomingIds = upcoming.body.visits.map((visit) => visit.buyer);
    assert.equal(upcomingIds.includes("Past Visit Buyer"), false);
    assert.equal(upcomingIds.includes("Cancelled Visit Buyer"), false);
    assert.equal(upcomingIds.includes("Completed Visit Buyer"), false);
    assert.equal(upcomingIds.includes("Future Visit Buyer"), true);
    assert.equal(upcomingIds.includes("Today Visit Buyer"), true);
  });
});
