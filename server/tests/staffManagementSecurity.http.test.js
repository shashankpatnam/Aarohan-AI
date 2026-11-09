import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import Lead from "../models/Lead.js";
import StaffUser from "../models/StaffUser.js";
import {
  applyTestAuthEnv,
  createTestStaffUser,
  staffBearerHeader,
  TEST_STAFF_PASSWORD,
} from "./helpers/staffAuth.js";

let replSet;
let app;

async function createLead(overrides = {}) {
  return Lead.create({
    name: "Security Test Buyer",
    phone: "9000000011",
    project: "Green Valley Phase 2",
    source: "Website",
    status: "New",
    ...overrides,
  });
}

describe("staff management security", () => {
  before(async () => {
    applyTestAuthEnv();
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await StaffUser.createIndexes();
    app = createApp();
  });

  afterEach(async () => {
    await Promise.all([StaffUser.deleteMany({}), Lead.deleteMany({})]);
  });

  after(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  it("rejects an administrator's self-deactivation even when another admin exists", async () => {
    const admin = await createTestStaffUser({ email: "self@security.test", role: "admin" });
    await createTestStaffUser({ email: "other@security.test", role: "admin" });
    const response = await request(app)
      .patch(`/api/staff/${admin.id}`)
      .set(staffBearerHeader(admin))
      .send({ isActive: false })
      .expect(409);
    assert.match(response.body.message, /cannot deactivate your own/i);
    const unchanged = await StaffUser.findById(admin.id);
    assert.equal(unchanged.isActive, true);
    assert.equal(unchanged.tokenVersion, admin.tokenVersion);
  });

  it("prevents deactivating the last active administrator", async () => {
    const admin = await createTestStaffUser({ email: "last@security.test", role: "admin" });
    await request(app)
      .patch(`/api/staff/${admin.id}`)
      .set(staffBearerHeader(admin))
      .send({ isActive: false })
      .expect(409);
    assert.equal(await StaffUser.countDocuments({ role: "admin", isActive: true }), 1);
  });

  it("serializes concurrent admin deactivations so an active admin remains", async () => {
    const adminA = await createTestStaffUser({ email: "a@concurrency.test", role: "admin" });
    const adminB = await createTestStaffUser({ email: "b@concurrency.test", role: "admin" });
    const [resultA, resultB] = await Promise.all([
      request(app).patch(`/api/staff/${adminB.id}`).set(staffBearerHeader(adminA)).send({ isActive: false }),
      request(app).patch(`/api/staff/${adminA.id}`).set(staffBearerHeader(adminB)).send({ isActive: false }),
    ]);
    assert.deepEqual([resultA.status, resultB.status].sort(), [200, 409]);
    assert.equal(await StaffUser.countDocuments({ role: "admin", isActive: true }), 1);
  });

  it("invalidates an existing token on deactivation and supports reactivation and login", async () => {
    const admin = await createTestStaffUser({ email: "operator@security.test", role: "admin" });
    const staff = await createTestStaffUser({ email: "worker@security.test", role: "staff" });
    const oldToken = staffBearerHeader(staff);
    await request(app).get("/api/auth/me").set(oldToken).expect(200);
    await request(app).patch(`/api/staff/${staff.id}`).set(staffBearerHeader(admin)).send({ isActive: false }).expect(200);
    await request(app).get("/api/auth/me").set(oldToken).expect(403);
    await request(app).patch(`/api/staff/${staff.id}`).set(staffBearerHeader(admin)).send({ isActive: true }).expect(200);
    const login = await request(app).post("/api/auth/login").send({ email: staff.email, password: TEST_STAFF_PASSWORD }).expect(200);
    await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${login.body.token}` }).expect(200);
  });

  it("requires authentication for eligible staff and returns active staff IDs and names only", async () => {
    await request(app).get("/api/staff/eligible").expect(401);
    const admin = await createTestStaffUser({ email: "selector-admin@security.test", role: "admin" });
    await createTestStaffUser({ email: "active@security.test", name: "Active Executive", role: "staff" });
    await createTestStaffUser({ email: "inactive@security.test", name: "Inactive Executive", role: "staff", isActive: false });
    await createTestStaffUser({ email: "executive-admin@security.test", name: "Admin Executive", role: "admin" });
    const response = await request(app).get("/api/staff/eligible").set(staffBearerHeader(admin)).expect(200);
    assert.deepEqual(response.body.staff.map(({ name }) => name), ["Active Executive"]);
    assert.deepEqual(Object.keys(response.body.staff[0]).sort(), ["id", "name"]);
  });

  it("rejects arbitrary and inactive executive names while preserving valid and historical assignments", async () => {
    const admin = await createTestStaffUser({ email: "lead-admin@security.test", role: "admin" });
    await createTestStaffUser({ email: "eligible-exec@security.test", name: "Eligible Executive", role: "staff" });
    await createTestStaffUser({ email: "inactive-exec@security.test", name: "Inactive Executive", role: "staff", isActive: false });
    const arbitraryLead = await createLead();
    await request(app).patch(`/api/leads/${arbitraryLead.id}`).set(staffBearerHeader(admin)).send({ executive: "Made Up Person" }).expect(400);
    await request(app).patch(`/api/leads/${arbitraryLead.id}`).set(staffBearerHeader(admin)).send({ executive: "Inactive Executive" }).expect(400);
    const valid = await request(app).patch(`/api/leads/${arbitraryLead.id}`).set(staffBearerHeader(admin)).send({ executive: "Eligible Executive" }).expect(200);
    assert.equal(valid.body.lead.executive, "Eligible Executive");
    const historical = await createLead({ executive: "Former Executive", status: "Contacted" });
    const read = await request(app).get(`/api/leads/${historical.id}`).set(staffBearerHeader(admin)).expect(200);
    assert.equal(read.body.lead.executive, "Former Executive");
  });
});
