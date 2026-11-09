import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import Lead from "../models/Lead.js";
import StaffUser, { INITIAL_ADMIN_BOOTSTRAP_SLOT } from "../models/StaffUser.js";
import GuestSession from "../models/GuestSession.js";
import {
  applyTestAuthEnv,
  createTestStaffUser,
  staffBearerHeader,
  TEST_STAFF_PASSWORD,
  TEST_STAFF_SETUP_SECRET,
} from "./helpers/staffAuth.js";
import { signStaffToken } from "../utils/staffJwt.js";
import { hashGuestSessionToken } from "../utils/guestSessionToken.js";

const TEST_PROJECT = "Green Valley Phase 2";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("express").Express} */
let app;
/** @type {import("supertest").Agent} */
let agent;

function setupBody(overrides = {}) {
  return {
    setupSecret: TEST_STAFF_SETUP_SECRET,
    name: "First Admin",
    email: "admin@aarohan.test",
    password: "AdminPass12",
    ...overrides,
  };
}

describe("Staff authentication HTTP integration", () => {
  before(async () => {
    applyTestAuthEnv();
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    await StaffUser.createIndexes();
    app = createApp();
    agent = request(app);
  });

  afterEach(async () => {
    await Lead.deleteMany({});
    await GuestSession.deleteMany({});
    await StaffUser.deleteMany({});
  });

  after(async () => {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("creates the first admin once via setup secret", async () => {
    const response = await agent.post("/api/auth/setup").send(setupBody()).expect(201);

    assert.equal(response.body.success, true);
    assert.ok(response.body.token);
    assert.equal(response.body.user.email, "admin@aarohan.test");
    assert.equal(response.body.user.role, "admin");
    assert.equal(response.body.user.passwordHash, undefined);
    assert.equal(response.body.user.password, undefined);

    const stored = await StaffUser.findOne({ email: "admin@aarohan.test" }).select(
      "+passwordHash",
    );
    assert.ok(stored);
    assert.equal(stored.bootstrapSlot, INITIAL_ADMIN_BOOTSTRAP_SLOT);
    assert.notEqual(stored.passwordHash, "AdminPass12");
    assert.equal(await StaffUser.countDocuments({ role: "admin" }), 1);
  });

  it("rejects repeated setup after an admin exists", async () => {
    await agent.post("/api/auth/setup").send(setupBody()).expect(201);

    const repeat = await agent
      .post("/api/auth/setup")
      .send(
        setupBody({
          email: "second.admin@aarohan.test",
          name: "Second Admin",
        }),
      )
      .expect(409);

    assert.match(repeat.body.message, /already been created/i);
    assert.equal(await StaffUser.countDocuments({ role: "admin" }), 1);
  });

  it("rejects setup with an invalid secret", async () => {
    await agent
      .post("/api/auth/setup")
      .send(setupBody({ setupSecret: "wrong-secret-value" }))
      .expect(403);

    assert.equal(await StaffUser.countDocuments({}), 0);
  });

  it("does not create multiple admins under concurrent setup", async () => {
    const results = await Promise.all([
      agent.post("/api/auth/setup").send(
        setupBody({
          email: "admin-a@aarohan.test",
          name: "Admin A",
        }),
      ),
      agent.post("/api/auth/setup").send(
        setupBody({
          email: "admin-b@aarohan.test",
          name: "Admin B",
        }),
      ),
    ]);

    const statuses = results.map((result) => result.status).sort();
    assert.ok(statuses.includes(201));
    assert.ok(statuses.includes(409));
    assert.equal(await StaffUser.countDocuments({ role: "admin" }), 1);
    assert.equal(
      await StaffUser.countDocuments({ bootstrapSlot: INITIAL_ADMIN_BOOTSTRAP_SLOT }),
      1,
    );
  });

  it("logs in with valid credentials and rejects invalid ones", async () => {
    await createTestStaffUser({
      email: "login@aarohan.test",
      role: "staff",
    });

    const success = await agent
      .post("/api/auth/login")
      .send({ email: "login@aarohan.test", password: TEST_STAFF_PASSWORD })
      .expect(200);

    assert.equal(success.body.success, true);
    assert.ok(success.body.token);
    assert.equal(success.body.user.email, "login@aarohan.test");
    assert.equal(success.body.user.passwordHash, undefined);

    const invalid = await agent
      .post("/api/auth/login")
      .send({ email: "login@aarohan.test", password: "not-the-password" })
      .expect(401);

    assert.match(invalid.body.message, /invalid email or password/i);
    assert.equal(invalid.body.token, undefined);
  });

  it("blocks inactive staff from login and CRM access", async () => {
    const inactive = await createTestStaffUser({
      email: "inactive@aarohan.test",
      role: "staff",
      isActive: false,
    });

    const inactiveLogin = await agent
      .post("/api/auth/login")
      .send({ email: "inactive@aarohan.test", password: TEST_STAFF_PASSWORD })
      .expect(401);

    assert.match(inactiveLogin.body.message, /invalid email or password/i);
    assert.equal(inactiveLogin.body.token, undefined);

    const token = signStaffToken(inactive);
    await agent
      .get("/api/leads")
      .set(staffBearerHeader(token))
      .expect(403);

    await agent
      .get("/api/analytics")
      .set(staffBearerHeader(token))
      .expect(403);
  });

  it("rejects unauthenticated CRM requests", async () => {
    await agent.get("/api/leads").expect(401);
    await agent.post("/api/leads").send({}).expect(401);
    await agent.get("/api/analytics").expect(401);
    await agent.get("/api/visits").expect(401);
    await agent.get("/api/handoffs").expect(401);
    await agent.get("/api/availability?project=Green%20Valley%20Phase%202&date=2099-01-01").expect(401);
    await agent.get("/api/staff").expect(401);
  });

  it("allows authenticated staff to access permitted CRM routes", async () => {
    const staff = await createTestStaffUser({
      email: "crm@aarohan.test",
      role: "staff",
    });
    const auth = staffBearerHeader(staff);

    const lead = await Lead.create({
      name: "Auth CRM Buyer",
      phone: "9000000100",
      project: TEST_PROJECT,
      source: "Website",
      status: "New",
    });

    await agent.get("/api/leads").set(auth).expect(200);
    await agent.get(`/api/leads/${lead._id.toString()}`).set(auth).expect(200);
    await agent.get("/api/analytics").set(auth).expect(200);
    await agent.get("/api/visits").set(auth).expect(200);
    await agent.get("/api/handoffs").set(auth).expect(200);
    await agent.get("/api/auth/me").set(auth).expect(200);
  });

  it("forbids staff from admin-only operations and allows admins", async () => {
    const staff = await createTestStaffUser({
      email: "normal@aarohan.test",
      role: "staff",
    });
    const admin = await createTestStaffUser({
      email: "boss@aarohan.test",
      role: "admin",
    });

    const createBody = {
      name: "New Hire",
      email: "hire@aarohan.test",
      password: "NewHirePass1",
      role: "staff",
    };

    await agent.post("/api/staff").set(staffBearerHeader(staff)).send(createBody).expect(403);
    await agent.get("/api/staff").set(staffBearerHeader(staff)).expect(403);

    const created = await agent
      .post("/api/staff")
      .set(staffBearerHeader(admin))
      .send(createBody)
      .expect(201);

    assert.equal(created.body.user.email, "hire@aarohan.test");
    assert.equal(created.body.user.role, "staff");
    assert.equal(created.body.user.passwordHash, undefined);

    const listed = await agent.get("/api/staff").set(staffBearerHeader(admin)).expect(200);
    assert.ok(listed.body.staff.some((row) => row.email === "hire@aarohan.test"));

    const deactivated = await agent
      .patch(`/api/staff/${created.body.user.id}`)
      .set(staffBearerHeader(admin))
      .send({ isActive: false })
      .expect(200);

    assert.equal(deactivated.body.user.isActive, false);
  });

  it("keeps guest endpoints public when guest token requirements are met", async () => {
    const created = await agent
      .post("/api/public/sessions")
      .send({ intent: "project", project: TEST_PROJECT })
      .expect(201);

    const sessionId = created.body.session.id;
    const sessionToken = created.body.sessionToken;

    await agent
      .get(`/api/public/sessions/${sessionId}`)
      .set({ Authorization: `Bearer ${sessionToken}` })
      .expect(200);

    await agent.get("/api/health").expect(200);
    await agent.get("/").expect(200);
  });

  it("does not accept a guest token as staff authentication", async () => {
    const created = await agent
      .post("/api/public/sessions")
      .send({ intent: "project", project: TEST_PROJECT })
      .expect(201);

    await agent
      .get("/api/leads")
      .set({ Authorization: `Bearer ${created.body.sessionToken}` })
      .expect(401);

    const raw = "guest-looking-token";
    await GuestSession.create({
      project: TEST_PROJECT,
      tokenHash: hashGuestSessionToken(raw),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await agent
      .get("/api/handoffs")
      .set({ Authorization: `Bearer ${raw}` })
      .expect(401);
  });

  it("invalidates tokens after logout", async () => {
    const staff = await createTestStaffUser({
      email: "logout@aarohan.test",
      role: "staff",
    });
    const token = signStaffToken(staff);

    await agent.get("/api/auth/me").set(staffBearerHeader(token)).expect(200);
    await agent.post("/api/auth/logout").set(staffBearerHeader(token)).expect(200);
    await agent.get("/api/leads").set(staffBearerHeader(token)).expect(401);
  });
});
