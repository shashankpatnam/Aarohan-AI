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
import { assertNoGuestInternalFields } from "./helpers/guestPublicResponse.js";

const TEST_PROJECT = "Skyline Residences";
const CONTACT = {
  name: "Aarav Patel",
  phone: "+91 99887 76655",
  email: "aarav@example.com",
};

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("supertest").Agent} */
let agent;

const trackedSessionIds = [];

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createSessionViaApi(testAgent = agent) {
  const response = await testAgent
    .post("/api/public/sessions")
    .send({ intent: "project", project: TEST_PROJECT })
    .expect(201);

  trackedSessionIds.push(response.body.session.id);
  return {
    sessionId: response.body.session.id,
    sessionToken: response.body.sessionToken,
    body: response.body,
  };
}

describe("Guest public API privacy and hardening", () => {
  before(async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    agent = request(
      createApp({
        authRateLimit: { disabled: true },
      }),
    );
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
    await Lead.deleteMany({});
  });

  after(async () => {
    __resetGenerateLeadChatTurnForTests();
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("omits internal fields from create, get, chat, contact, and callback JSON", async () => {
    const created = await createSessionViaApi();
    assertNoGuestInternalFields(created.body);
    assert.equal(created.body.session.needsHumanHandoff, false);
    assert.ok(created.body.sessionToken);

    const fetched = await agent
      .get(`/api/public/sessions/${created.sessionId}`)
      .set(authHeader(created.sessionToken))
      .expect(200);
    assertNoGuestInternalFields(fetched.body);
    assert.equal(typeof fetched.body.session.callbackRequested, "boolean");
    assert.equal(typeof fetched.body.session.callbackPending, "boolean");

    __setGenerateLeadChatTurnForTests(async () => ({
      ok: true,
      data: {
        reply: "A sales executive should confirm pricing.",
        preferredLanguage: null,
        qualification: { score: 40 },
        buyerSummary: "Asked about price",
        needsHumanHandoff: true,
        handoffReason: "Pricing needs executive confirmation",
        recommendQualified: false,
      },
    }));

    const chat = await agent
      .post(`/api/public/sessions/${created.sessionId}/chat`)
      .set(authHeader(created.sessionToken))
      .send({ message: "What is the price?" })
      .expect(200);

    assertNoGuestInternalFields(chat.body);
    assert.equal(chat.body.needsHumanHandoff, true);
    assert.equal(chat.body.handoffReason, undefined);
    assert.equal(chat.body.chatFailureReason, undefined);

    const stored = await GuestSession.findById(created.sessionId);
    assert.equal(stored.needsHumanHandoff, true);
    assert.match(stored.handoffReason, /executive confirmation/i);

    const contact = await agent
      .post(`/api/public/sessions/${created.sessionId}/contact`)
      .set(authHeader(created.sessionToken))
      .send(CONTACT)
      .expect(201);
    assertNoGuestInternalFields(contact.body);
    assert.equal(contact.body.contactCaptured, true);
    assert.equal(contact.body.session.leadId, undefined);

    const callback = await agent
      .post(`/api/public/sessions/${created.sessionId}/callback`)
      .set(authHeader(created.sessionToken))
      .send({ preferredContactMethod: "phone", message: "Please call." })
      .expect(200);
    assertNoGuestInternalFields(callback.body);
    assert.equal(callback.body.callbackRequested, true);
    assert.equal(callback.body.session.callbackPending, true);
    assert.equal(callback.body.session.executive, undefined);
  });

  it("returns the same 401 for a missing session and an invalid guest token", async () => {
    const created = await createSessionViaApi();
    const missingId = new mongoose.Types.ObjectId().toString();

    const missing = await agent
      .get(`/api/public/sessions/${missingId}`)
      .set(authHeader(created.sessionToken))
      .expect(401);

    const wrongToken = await agent
      .get(`/api/public/sessions/${created.sessionId}`)
      .set(authHeader("not-the-right-token"))
      .expect(401);

    const malformedId = await agent
      .get("/api/public/sessions/not-an-id")
      .set(authHeader(created.sessionToken))
      .expect(401);

    assert.equal(missing.body.message, wrongToken.body.message);
    assert.equal(malformedId.body.message, wrongToken.body.message);
    assert.equal(missing.body.message, "Invalid session credentials");
    assert.equal(missing.status, 401);
  });

  it("still returns 410 for an expired session when the token is valid", async () => {
    const created = await createSessionViaApi();
    await GuestSession.findByIdAndUpdate(created.sessionId, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const response = await agent
      .get(`/api/public/sessions/${created.sessionId}`)
      .set(authHeader(created.sessionToken))
      .expect(410);

    assert.match(response.body.message, /expired/i);
  });

  it("rejects unexpected contact fields such as role", async () => {
    const created = await createSessionViaApi();
    const response = await agent
      .post(`/api/public/sessions/${created.sessionId}/contact`)
      .set(authHeader(created.sessionToken))
      .send({ ...CONTACT, role: "staff" })
      .expect(400);

    assert.ok(response.body.errors.some((entry) => /role/i.test(entry)));
  });

  describe("guest session create rate limiting", () => {
    /** @type {import("supertest").Agent} */
    let rateAgent;

    before(() => {
      rateAgent = request(
        createApp({
          authRateLimit: {
            disabled: false,
            windowMs: 60_000,
            guestSessionCreateIpMax: 2,
          },
        }),
      );
    });

    it("allows create requests under the limit and returns 429 after", async () => {
      const first = await rateAgent
        .post("/api/public/sessions")
        .send({ intent: "project", project: TEST_PROJECT })
        .expect(201);
      trackedSessionIds.push(first.body.session.id);

      const second = await rateAgent
        .post("/api/public/sessions")
        .send({ intent: "project", project: TEST_PROJECT })
        .expect(201);
      trackedSessionIds.push(second.body.session.id);

      const limited = await rateAgent
        .post("/api/public/sessions")
        .send({ intent: "project", project: TEST_PROJECT })
        .expect(429);

      assert.match(limited.body.message, /too many attempts/i);
      assert.equal(limited.body.sessionToken, undefined);
    });

    it("does not rate-limit authenticated guest chat under the create limiter", async () => {
      const chatAgent = request(
        createApp({
          authRateLimit: {
            disabled: false,
            windowMs: 60_000,
            guestSessionCreateIpMax: 2,
          },
        }),
      );
      const created = await chatAgent
        .post("/api/public/sessions")
        .send({ intent: "project", project: TEST_PROJECT })
        .expect(201);
      trackedSessionIds.push(created.body.session.id);

      __setGenerateLeadChatTurnForTests(async () => ({
        ok: true,
        data: {
          reply: "Hello.",
          preferredLanguage: null,
          qualification: null,
          buyerSummary: null,
          needsHumanHandoff: false,
          handoffReason: null,
          recommendQualified: false,
        },
      }));

      await chatAgent
        .post(`/api/public/sessions/${created.body.session.id}/chat`)
        .set(authHeader(created.body.sessionToken))
        .send({ message: "Hello" })
        .expect(200);

      await chatAgent
        .post(`/api/public/sessions/${created.body.session.id}/chat`)
        .set(authHeader(created.body.sessionToken))
        .send({ message: "Hello again" })
        .expect(200);

      await chatAgent
        .post(`/api/public/sessions/${created.body.session.id}/chat`)
        .set(authHeader(created.body.sessionToken))
        .send({ message: "Still chatting" })
        .expect(200);
    });
  });
});

describe("HTTP payload and security headers", () => {
  /** @type {import("supertest").Agent} */
  let headerAgent;

  before(() => {
    headerAgent = request(
      createApp({
        authRateLimit: { disabled: true },
      }),
    );
  });

  it("returns 413 with a generic message for oversized JSON bodies", async () => {
    const response = await headerAgent
      .post("/api/public/sessions")
      .send({ intent: "project", project: TEST_PROJECT, pad: "a".repeat(40_000) })
      .expect(413);

    assert.equal(response.body.success, false);
    assert.match(response.body.message, /too large/i);
    assert.equal(response.body.stack, undefined);
  });

  it("sets a restrictive Content-Security-Policy on API responses", async () => {
    const response = await headerAgent.get("/api/health").expect(200);
    const csp = response.headers["content-security-policy"];
    assert.ok(csp);
    assert.match(csp, /default-src 'none'/);
    assert.equal(response.headers["strict-transport-security"], undefined);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  });
});
