import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import StaffUser from "../models/StaffUser.js";
import {
  applyTestAuthEnv,
  createTestStaffUser,
  staffBearerHeader,
  TEST_STAFF_JWT_SECRET,
  TEST_STAFF_PASSWORD,
  TEST_STAFF_SETUP_SECRET,
} from "./helpers/staffAuth.js";
import { MAX_PASSWORD_LENGTH } from "../utils/staffPassword.js";
import {
  STAFF_JWT_ALGORITHM,
  STAFF_TOKEN_TYP,
  signStaffToken,
} from "../utils/staffJwt.js";
import { SETUP_ALREADY_COMPLETED_MESSAGE } from "../controllers/authController.js";

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

describe("Staff authentication hardening", () => {
  before(async () => {
    applyTestAuthEnv();
    memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(memoryServer.getUri());
    await StaffUser.createIndexes();
    app = createApp();
    agent = request(app);
  });

  afterEach(async () => {
    await StaffUser.deleteMany({});
  });

  after(async () => {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("returns indistinguishable 409s after bootstrap for correct and incorrect setup secrets", async () => {
    await agent.post("/api/auth/setup").send(setupBody()).expect(201);

    const withValidSecret = await agent
      .post("/api/auth/setup")
      .send(
        setupBody({
          email: "another@aarohan.test",
          name: "Another",
        }),
      )
      .expect(409);

    const withInvalidSecret = await agent
      .post("/api/auth/setup")
      .send(
        setupBody({
          setupSecret: "definitely-not-the-setup-secret",
          email: "third@aarohan.test",
          name: "Third",
        }),
      )
      .expect(409);

    const withMissingSecret = await agent
      .post("/api/auth/setup")
      .send({
        name: "Fourth",
        email: "fourth@aarohan.test",
        password: "AdminPass12",
      })
      .expect(409);

    assert.equal(withValidSecret.body.message, SETUP_ALREADY_COMPLETED_MESSAGE);
    assert.equal(withInvalidSecret.body.message, SETUP_ALREADY_COMPLETED_MESSAGE);
    assert.equal(withMissingSecret.body.message, SETUP_ALREADY_COMPLETED_MESSAGE);
    assert.deepEqual(withValidSecret.body, withInvalidSecret.body);
    assert.deepEqual(withValidSecret.body, withMissingSecret.body);
    assert.equal(await StaffUser.countDocuments({ role: "admin" }), 1);
  });

  it("rejects empty, non-string, and oversized login passwords with a generic 401", async () => {
    await createTestStaffUser({
      email: "length@aarohan.test",
      role: "staff",
    });

    const empty = await agent
      .post("/api/auth/login")
      .send({ email: "length@aarohan.test", password: "" })
      .expect(401);

    const missing = await agent
      .post("/api/auth/login")
      .send({ email: "length@aarohan.test" })
      .expect(401);

    const nonString = await agent
      .post("/api/auth/login")
      .send({ email: "length@aarohan.test", password: { value: TEST_STAFF_PASSWORD } })
      .expect(401);

    const oversized = await agent
      .post("/api/auth/login")
      .send({
        email: "length@aarohan.test",
        password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
      })
      .expect(401);

    for (const response of [empty, missing, nonString, oversized]) {
      assert.match(response.body.message, /invalid email or password/i);
      assert.equal(response.body.token, undefined);
    }
  });

  it("uses the same generic 401 for unknown email, wrong password, and inactive staff", async () => {
    await createTestStaffUser({
      email: "known@aarohan.test",
      role: "staff",
    });
    await createTestStaffUser({
      email: "inactive.harden@aarohan.test",
      role: "staff",
      isActive: false,
    });

    const unknown = await agent
      .post("/api/auth/login")
      .send({ email: "missing@aarohan.test", password: TEST_STAFF_PASSWORD })
      .expect(401);

    const wrongPassword = await agent
      .post("/api/auth/login")
      .send({ email: "known@aarohan.test", password: "WrongPass12" })
      .expect(401);

    const inactive = await agent
      .post("/api/auth/login")
      .send({
        email: "inactive.harden@aarohan.test",
        password: TEST_STAFF_PASSWORD,
      })
      .expect(401);

    assert.equal(unknown.body.message, wrongPassword.body.message);
    assert.equal(unknown.body.message, inactive.body.message);
    assert.equal(unknown.body.success, false);
    assert.equal(inactive.body.token, undefined);
    assert.doesNotMatch(String(inactive.body.message), /inactive/i);
  });

  it("rejects expired, tampered, missing-typ, wrong-typ, and HS384 staff tokens on CRM routes", async () => {
    const staff = await createTestStaffUser({
      email: "jwt@aarohan.test",
      role: "staff",
    });
    const subject = staff._id.toString();

    const expired = signStaffToken(staff, { expiresIn: "-1s" });
    await agent.get("/api/auth/me").set(staffBearerHeader(expired)).expect(401);

    const valid = signStaffToken(staff);
    const parts = valid.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    payload.tv = 99;
    parts[1] = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    await agent
      .get("/api/auth/me")
      .set(staffBearerHeader(parts.join(".")))
      .expect(401);

    const missingTyp = jwt.sign(
      { tv: 0 },
      TEST_STAFF_JWT_SECRET,
      { algorithm: STAFF_JWT_ALGORITHM, subject, expiresIn: "8h" },
    );
    await agent.get("/api/auth/me").set(staffBearerHeader(missingTyp)).expect(401);

    const wrongTyp = jwt.sign(
      { typ: "guest", tv: 0 },
      TEST_STAFF_JWT_SECRET,
      { algorithm: STAFF_JWT_ALGORITHM, subject, expiresIn: "8h" },
    );
    await agent.get("/api/auth/me").set(staffBearerHeader(wrongTyp)).expect(401);

    const hs384 = jwt.sign(
      { typ: STAFF_TOKEN_TYP, tv: 0 },
      TEST_STAFF_JWT_SECRET,
      { algorithm: "HS384", subject, expiresIn: "8h" },
    );
    await agent.get("/api/auth/me").set(staffBearerHeader(hs384)).expect(401);
  });

  it("prevents deactivating the last active administrator", async () => {
    const admin = await createTestStaffUser({
      email: "only.admin@aarohan.test",
      role: "admin",
    });
    const staff = await createTestStaffUser({
      email: "only.staff@aarohan.test",
      role: "staff",
    });

    const blocked = await agent
      .patch(`/api/staff/${admin._id.toString()}`)
      .set(staffBearerHeader(admin))
      .send({ isActive: false })
      .expect(409);

    assert.match(blocked.body.message, /cannot deactivate your own account/i);

    const stillAdmin = await StaffUser.findById(admin._id);
    assert.equal(stillAdmin.isActive, true);

    const staffOff = await agent
      .patch(`/api/staff/${staff._id.toString()}`)
      .set(staffBearerHeader(admin))
      .send({ isActive: false })
      .expect(200);

    assert.equal(staffOff.body.user.isActive, false);
  });

  it("allows deactivating an admin when another active admin remains", async () => {
    const adminA = await createTestStaffUser({
      email: "admin.a@aarohan.test",
      role: "admin",
    });
    const adminB = await createTestStaffUser({
      email: "admin.b@aarohan.test",
      role: "admin",
    });

    const response = await agent
      .patch(`/api/staff/${adminB._id.toString()}`)
      .set(staffBearerHeader(adminA))
      .send({ isActive: false })
      .expect(200);

    assert.equal(response.body.user.isActive, false);

    const remaining = await StaffUser.countDocuments({
      role: "admin",
      isActive: true,
    });
    assert.equal(remaining, 1);
  });

  describe("rate limiting", () => {
    /** @type {import("supertest").Agent} */
    let rateAgent;

    before(() => {
      const rateApp = createApp({
        authRateLimit: {
          disabled: false,
          windowMs: 60_000,
          loginIpMax: 2,
          loginEmailMax: 10,
          setupIpMax: 3,
        },
      });
      rateAgent = request(rateApp);
    });

    it("returns 429 with a generic message after too many login attempts", async () => {
    await createTestStaffUser({
      email: "rate.login@aarohan.test",
      role: "staff",
    });

    await rateAgent
      .post("/api/auth/login")
      .send({ email: "rate.login@aarohan.test", password: "WrongPass12" })
      .expect(401);
    await rateAgent
      .post("/api/auth/login")
      .send({ email: "rate.login@aarohan.test", password: "WrongPass12" })
      .expect(401);

    const limited = await rateAgent
      .post("/api/auth/login")
      .send({ email: "rate.login@aarohan.test", password: "WrongPass12" })
      .expect(429);

    assert.equal(limited.body.success, false);
    assert.match(limited.body.message, /too many attempts/i);
    assert.equal(limited.body.token, undefined);
  });

  it("returns 429 after too many setup attempts from one IP", async () => {
    await rateAgent
      .post("/api/auth/setup")
      .send(setupBody({ setupSecret: "wrong-secret-value-1" }))
      .expect(403);
    await rateAgent
      .post("/api/auth/setup")
      .send(setupBody({ setupSecret: "wrong-secret-value-2" }))
      .expect(403);
    await rateAgent
      .post("/api/auth/setup")
      .send(setupBody({ setupSecret: "wrong-secret-value-3" }))
      .expect(403);

    const limited = await rateAgent
      .post("/api/auth/setup")
      .send(setupBody({ setupSecret: "wrong-secret-value-4" }))
      .expect(429);

    assert.match(limited.body.message, /too many attempts/i);
    assert.equal(await StaffUser.countDocuments({}), 0);
    });
  });
});
