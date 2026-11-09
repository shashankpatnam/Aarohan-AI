import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import GuestSession from "../models/GuestSession.js";
import Lead from "../models/Lead.js";
import SiteVisit, { VISIT_SLOTS } from "../models/SiteVisit.js";
import { hashGuestSessionToken } from "../utils/guestSessionToken.js";

const PROJECT = "Green Valley Phase 2";
const OTHER_PROJECT = "Palm Grove Villas";
const CONTACT = { name: "Guest Visit Buyer", phone: "9000000123", email: "visit@example.com" };
let memoryServer;
let app;
let agent;
const sessionIds = [];
const leadIds = [];

function futureDate(days = 3) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function auth(token) { return { Authorization: `Bearer ${token}` }; }

async function makeSession({ converted = false, project = null } = {}) {
  const token = `test-token-${new mongoose.Types.ObjectId()}`;
  const session = await GuestSession.create({
    project,
    initialProject: project,
    interestedProjects: [],
    tokenHash: hashGuestSessionToken(token),
    expiresAt: new Date(Date.now() + 60_000),
    contactCaptured: converted,
    leadId: null,
  });
  sessionIds.push(session._id);
  if (converted) {
    const lead = await Lead.create({
      ...CONTACT,
      name: CONTACT.name,
      project: null,
      initialProject: project,
      interestedProjects: [],
      source: "Website",
      status: "New",
      executive: "Assigned Executive",
    });
    session.leadId = lead._id;
    await session.save();
    leadIds.push(lead._id);
  }
  return { sessionId: String(session._id), token, session };
}

async function convertedSession(options = {}) {
  const { sessionId, token, session } = await makeSession({ ...options, converted: true });
  return { sessionId, token, session, leadId: String(session.leadId) };
}

function bookingBody(overrides = {}) {
  return { project: PROJECT, date: futureDate(), slot: VISIT_SLOTS[0], ...overrides };
}

describe("Public guest site visit APIs", () => {
  before(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    await Promise.all([SiteVisit.init(), GuestSession.init()]);
    app = createApp();
    agent = request(app);
  });

  afterEach(async () => {
    if (sessionIds.length) await GuestSession.deleteMany({ _id: { $in: sessionIds.splice(0) } });
    if (leadIds.length) {
      await SiteVisit.deleteMany({ lead: { $in: leadIds } });
      await Lead.deleteMany({ _id: { $in: leadIds.splice(0) } });
    }
  });

  after(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it("requires guest token authentication, rejects session mismatch and expired sessions", async () => {
    const guest = await convertedSession();
    const url = `/api/public/sessions/${guest.sessionId}/visits`;
    await agent.post(url).send(bookingBody()).expect(401);
    await agent.post(`/api/public/sessions/${new mongoose.Types.ObjectId()}/visits`).set(auth(guest.token)).send(bookingBody()).expect(401);
    await GuestSession.findByIdAndUpdate(guest.sessionId, { expiresAt: new Date(Date.now() - 1000) });
    await agent.post(url).set(auth(guest.token)).send(bookingBody()).expect(410);
  });

  it("requires conversion before availability or booking", async () => {
    const guest = await makeSession();
    await agent.get(`/api/public/sessions/${guest.sessionId}/visit-availability`)
      .set(auth(guest.token)).query({ project: PROJECT, from: futureDate(), to: futureDate(4) }).expect(422);
    const response = await agent.post(`/api/public/sessions/${guest.sessionId}/visits`)
      .set(auth(guest.token)).send(bookingBody()).expect(422);
    assert.equal(response.body.code, "contact_required");
  });

  it("books an explicit project for a General Inquiry without changing lead interest fields", async () => {
    const guest = await convertedSession({ project: null });
    const leadBefore = await Lead.findById(guest.leadId);
    const response = await agent.post(`/api/public/sessions/${guest.sessionId}/visits`)
      .set(auth(guest.token)).send(bookingBody()).expect(201);
    assert.deepEqual(response.body.booking, {
      id: response.body.booking.id,
      project: PROJECT,
      date: futureDate(),
      slot: VISIT_SLOTS[0],
      status: "Scheduled",
      confirmation: `Your site visit to ${PROJECT} is confirmed for ${futureDate()} at ${VISIT_SLOTS[0]}.`,
    });
    assert.equal(response.body.booking.executive, undefined);
    const [visit, leadAfter, sessionAfter] = await Promise.all([
      SiteVisit.findById(response.body.booking.id),
      Lead.findById(guest.leadId),
      GuestSession.findById(guest.sessionId),
    ]);
    assert.equal(String(visit.lead), guest.leadId);
    assert.equal(visit.project, PROJECT);
    assert.equal(visit.executive, "Assigned Executive");
    assert.equal(leadAfter.project, leadBefore.project);
    assert.equal(leadAfter.initialProject, leadBefore.initialProject);
    assert.deepEqual(leadAfter.interestedProjects, leadBefore.interestedProjects);
    assert.equal(sessionAfter.project, null);
    assert.equal(response.body.booking.notes, undefined);
  });

  it("rejects unapproved projects, invalid dates, slots and protected body fields", async () => {
    const guest = await convertedSession();
    const url = `/api/public/sessions/${guest.sessionId}/visits`;
    await agent.post(url).set(auth(guest.token)).send(bookingBody({ project: "Unknown Project" })).expect(400);
    await agent.post(url).set(auth(guest.token)).send(bookingBody({ date: "2026-02-31" })).expect(400);
    await agent.post(url).set(auth(guest.token)).send(bookingBody({ slot: "9:00 AM" })).expect(400);
    await agent.post(url).set(auth(guest.token)).send({ ...bookingBody(), leadId: new mongoose.Types.ObjectId().toString() }).expect(400);
    await agent.post(url).set(auth(guest.token)).send(bookingBody({ date: "2000-01-01" })).expect(400);
  });

  it("returns only free scheduled slots and cancelled/completed visits do not occupy slots", async () => {
    const guest = await convertedSession();
    const date = futureDate(6);
    const lead = await Lead.create({ ...CONTACT, name: "Occupancy Fixture", phone: "9000000999", source: "Website" });
    leadIds.push(lead._id);
    await SiteVisit.create([
      { lead: lead._id, buyerName: lead.name, project: PROJECT, visitDate: date, slot: VISIT_SLOTS[0], executive: "Private Staff Name", status: "Scheduled", bookedAt: new Date(), notes: "private" },
      { lead: lead._id, buyerName: lead.name, project: PROJECT, visitDate: date, slot: VISIT_SLOTS[1], executive: "Staff", status: "Cancelled", bookedAt: new Date() },
      { lead: lead._id, buyerName: lead.name, project: PROJECT, visitDate: date, slot: VISIT_SLOTS[2], executive: "Staff", status: "Completed", bookedAt: new Date() },
    ]);
    const response = await agent.get(`/api/public/sessions/${guest.sessionId}/visit-availability`)
      .set(auth(guest.token)).query({ project: PROJECT, from: date, to: futureDate(7) }).expect(200);
    assert.deepEqual(response.body.availability[0], { date, slots: [VISIT_SLOTS[1], VISIT_SLOTS[2], VISIT_SLOTS[3], VISIT_SLOTS[4]] });
    assert.equal(JSON.stringify(response.body).includes("Private Staff Name"), false);
    assert.equal(JSON.stringify(response.body).includes("private"), false);
  });

  it("bounds availability ranges and filters elapsed slots today", async () => {
    const guest = await convertedSession();
    const from = futureDate(1);
    await agent.get(`/api/public/sessions/${guest.sessionId}/visit-availability`)
      .set(auth(guest.token)).query({ project: PROJECT, from, to: futureDate(40) }).expect(400);
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const todayParts = Object.fromEntries(dateParts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
    const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    const response = await agent.get(`/api/public/sessions/${guest.sessionId}/visit-availability`)
      .set(auth(guest.token)).query({ project: PROJECT, from: today, to: today }).expect(200);
    const todaySlots = response.body.availability[0]?.slots ?? [];
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now));
    assert.equal(todaySlots.includes(VISIT_SLOTS[0]), hour < 10);
  });

  it("returns the persisted booking on an identical retry and conflicts on a different retry", async () => {
    const guest = await convertedSession();
    const url = `/api/public/sessions/${guest.sessionId}/visits`;
    const body = bookingBody();
    const first = await agent.post(url).set(auth(guest.token)).send(body).expect(201);
    const retry = await agent.post(url).set(auth(guest.token)).send(body).expect(200);
    assert.equal(retry.body.retry, true);
    assert.equal(retry.body.booking.id, first.body.booking.id);
    await agent.post(url).set(auth(guest.token)).send(bookingBody({ project: OTHER_PROJECT })).expect(409);
    assert.equal(await SiteVisit.countDocuments({ lead: guest.leadId, status: "Scheduled" }), 1);
  });

  it("allows only one concurrent booking for a slot and one active visit per lead", async () => {
    const one = await convertedSession();
    const two = await convertedSession();
    const body = bookingBody({ date: futureDate(8), slot: VISIT_SLOTS[3] });
    const responses = await Promise.all([
      agent.post(`/api/public/sessions/${one.sessionId}/visits`).set(auth(one.token)).send(body),
      agent.post(`/api/public/sessions/${two.sessionId}/visits`).set(auth(two.token)).send(body),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const lead = await convertedSession();
    const leadUrl = `/api/public/sessions/${lead.sessionId}/visits`;
    await agent.post(leadUrl).set(auth(lead.token)).send(bookingBody({ date: futureDate(9), slot: VISIT_SLOTS[4] })).expect(201);
    await agent.post(leadUrl).set(auth(lead.token)).send(bookingBody({ date: futureDate(10), slot: VISIT_SLOTS[4] })).expect(409);
  });

  it("reports persisted booking success if lead status synchronization fails", async () => {
    const guest = await convertedSession();
    const original = Lead.findByIdAndUpdate;
    Lead.findByIdAndUpdate = async () => { throw new Error("simulated status write failure"); };
    try {
      const response = await agent.post(`/api/public/sessions/${guest.sessionId}/visits`)
        .set(auth(guest.token)).send(bookingBody({ date: futureDate(11) })).expect(201);
      assert.equal(response.body.booking.status, "Scheduled");
      assert.equal(await SiteVisit.countDocuments({ lead: guest.leadId, status: "Scheduled" }), 1);
    } finally {
      Lead.findByIdAndUpdate = original;
    }
  });
});
