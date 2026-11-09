import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, afterEach, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import GuestSession from "../models/GuestSession.js";
import Lead from "../models/Lead.js";
import ProjectFacts from "../models/ProjectFacts.js";
import {
  CHAT_MAX_MESSAGE_LENGTH,
} from "../services/leadChatShared.js";
import {
  generateLeadChatTurn,
} from "../services/geminiLeadChat.js";
import {
  __resetGenerateLeadChatTurnForTests,
  __setGenerateLeadChatTurnForTests,
} from "../services/leadChatTurnResolver.js";
import {
  hashGuestSessionToken,
  verifyGuestSessionToken,
} from "../utils/guestSessionToken.js";

const TEST_PROJECT = "Green Valley Phase 2";
const EN_FALLBACK =
  "Thanks for your message. A member of our team will confirm the details and get back to you shortly.";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;
/** @type {import("express").Express} */
let app;
/** @type {import("supertest").Agent} */
let agent;

const trackedSessionIds = [];

async function upsertProjectFacts(projectName, patch) {
  await ProjectFacts.updateOne(
    { projectName },
    {
      $set: {
        projectName,
        location: null,
        propertyConfigurations: [],
        amenities: [],
        possessionTimeline: null,
        reraInformation: null,
        visitProcess: null,
        priceInformation: null,
        inventoryInformation: null,
        approvalStatus: "draft",
        ...patch,
      },
    },
    { upsert: true },
  );
}

async function createSessionViaApi(project = TEST_PROJECT) {
  const response = await agent
    .post("/api/public/sessions")
    .send({ intent: "project", project })
    .expect(201);

  assert.equal(response.body.success, true);
  assert.ok(response.body.sessionToken);
  assert.ok(response.body.session?.id);

  trackedSessionIds.push(response.body.session.id);

  return {
    sessionId: response.body.session.id,
    sessionToken: response.body.sessionToken,
    session: response.body.session,
  };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function useRealGenerateLeadChatTurnWithRetrySpy() {
  const spy = { count: 0 };
  __setGenerateLeadChatTurnForTests(async (input) =>
    generateLeadChatTurn({
      ...input,
      _geminiRetryDeps: {
        executeWithPrimaryAndFallback: async () => {
          spy.count += 1;
          return {
            outcome: "success",
            result: {
              response: {
                text: () =>
                  JSON.stringify({
                    reply: "Let me help with your questions.",
                    needsHumanHandoff: false,
                    handoffReason: null,
                    recommendQualified: false,
                  }),
                candidates: [{ finishReason: "STOP" }],
              },
            },
          };
        },
      },
    }),
  );
  return spy;
}

describe("Public guest sessions HTTP integration", () => {
  before(async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-gemini-key";

    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());

    app = createApp();
    agent = request(app);
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
    await ProjectFacts.deleteMany({ projectName: TEST_PROJECT });
    await Lead.deleteMany({});
  });

  after(async () => {
    __resetGenerateLeadChatTurnForTests();
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  });

  it("creates a session with a valid project and returns a raw token once", async () => {
    const { sessionId, sessionToken, session } = await createSessionViaApi();

    assert.equal(session.project, TEST_PROJECT);
    assert.equal(session.contactCaptured, false);
    assert.deepEqual(session.messages, []);
    assert.ok(session.expiresAt);

    const stored = await GuestSession.findById(sessionId);
    assert.ok(stored);
    assert.notEqual(stored.tokenHash, sessionToken);
    assert.equal(stored.tokenHash, hashGuestSessionToken(sessionToken));
    assert.ok(verifyGuestSessionToken(sessionToken, stored.tokenHash));
    assert.equal(stored.leadId, null);

    const leadCount = await Lead.countDocuments();
    assert.equal(leadCount, 0);
  });

  it("creates and stores a General Chat session with a null project", async () => {
    const response = await agent
      .post("/api/public/sessions")
      .send({ intent: "general" })
      .expect(201);

    const { id, project } = response.body.session;
    trackedSessionIds.push(id);
    assert.equal(project, null);
    assert.equal((await GuestSession.findById(id)).project, null);
  });

  it("passes null or the selected project as the initial AI context", async () => {
    const initialProjects = [];
    __setGenerateLeadChatTurnForTests(async (input) => {
      initialProjects.push(input.initialProject);
      return {
        ok: true,
        data: {
          reply: "I can help explore the approved portfolio.",
          preferredLanguage: null,
          qualification: null,
          buyerSummary: null,
          needsHumanHandoff: false,
          handoffReason: null,
          recommendQualified: false,
        },
      };
    });

    const general = await agent
      .post("/api/public/sessions")
      .send({ intent: "general" })
      .expect(201);
    const project = await createSessionViaApi(TEST_PROJECT);
    trackedSessionIds.push(general.body.session.id);

    await agent
      .post(`/api/public/sessions/${general.body.session.id}/chat`)
      .set(authHeader(general.body.sessionToken))
      .send({ message: "What homes could suit me?" })
      .expect(200);
    await agent
      .post(`/api/public/sessions/${project.sessionId}/chat`)
      .set(authHeader(project.sessionToken))
      .send({ message: "Tell me about this project." })
      .expect(200);

    assert.deepEqual(initialProjects, [null, TEST_PROJECT]);
  });

  it("rejects an invalid project on session create", async () => {
    const response = await agent
      .post("/api/public/sessions")
      .send({ intent: "project", project: "Not A Real Project" })
      .expect(400);

    assert.equal(response.body.success, false);
    assert.match(response.body.message, /Validation failed/i);
    assert.ok(
      response.body.errors.some((e) => e.includes("project must be one of")),
    );
  });

  it("rejects project intent without a project", async () => {
    const response = await agent
      .post("/api/public/sessions")
      .send({ intent: "project" })
      .expect(400);
    assert.ok(response.body.errors.some((error) => /project is required/i.test(error)));
  });

  it("rejects an invalid or missing intent", async () => {
    for (const body of [{ intent: "other" }, { project: TEST_PROJECT }, {}]) {
      const response = await agent
        .post("/api/public/sessions")
        .send(body)
        .expect(400);
      assert.equal(response.body.success, false);
    }
  });

  it("rejects project fields and malformed extras for General Chat", async () => {
    await agent
      .post("/api/public/sessions")
      .send({ intent: "general", project: TEST_PROJECT })
      .expect(400);
    await agent
      .post("/api/public/sessions")
      .send({ intent: "general", unexpected: true })
      .expect(400);
  });

  it("allows a valid token to retrieve its session", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    const response = await agent
      .get(`/api/public/sessions/${sessionId}`)
      .set(authHeader(sessionToken))
      .expect(200);

    assert.equal(response.body.success, true);
    assert.equal(response.body.session.id, sessionId);
    assert.equal(response.body.session.project, TEST_PROJECT);
    assert.equal(response.body.sessionToken, undefined);
    assert.equal(response.body.session.executive, undefined);
    assert.equal(response.body.session.handoffStatus, undefined);
  });

  it("retrieves a General Chat session as null project with its own valid token", async () => {
    const created = await agent
      .post("/api/public/sessions")
      .send({ intent: "general" })
      .expect(201);
    const { id, project } = created.body.session;
    trackedSessionIds.push(id);
    assert.equal(project, null);

    await agent
      .get(`/api/public/sessions/${id}`)
      .set(authHeader("not-the-general-session-token"))
      .expect(401);

    const response = await agent
      .get(`/api/public/sessions/${id}`)
      .set(authHeader(created.body.sessionToken))
      .expect(200);

    assert.equal(response.body.session.project, null);
    assert.equal(response.body.sessionToken, undefined);
    assert.equal(response.body.session.tokenHash, undefined);
  });

  it("retains access to existing project-specific session records", async () => {
    const sessionToken = "legacy-session-token-for-compatibility";
    const stored = await GuestSession.create({
      project: TEST_PROJECT,
      tokenHash: hashGuestSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    trackedSessionIds.push(stored._id.toString());

    const response = await agent
      .get(`/api/public/sessions/${stored._id}`)
      .set(authHeader(sessionToken))
      .expect(200);

    assert.equal(response.body.session.project, TEST_PROJECT);
    assert.equal(response.body.session.tokenHash, undefined);
  });

  it("rejects missing or invalid Bearer token", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    await agent.get(`/api/public/sessions/${sessionId}`).expect(401);

    await agent
      .get(`/api/public/sessions/${sessionId}`)
      .set({ Authorization: "Bearer not-the-right-token" })
      .expect(401);

    await agent
      .get(`/api/public/sessions/${sessionId}`)
      .set(authHeader(sessionToken.slice(0, -1) + "x"))
      .expect(401);
  });

  it("rejects a token from another session", async () => {
    const first = await createSessionViaApi();
    const second = await createSessionViaApi();

    await agent
      .get(`/api/public/sessions/${second.sessionId}`)
      .set(authHeader(first.sessionToken))
      .expect(401);
  });

  it("rejects an expired session", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    await GuestSession.findByIdAndUpdate(sessionId, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const response = await agent
      .get(`/api/public/sessions/${sessionId}`)
      .set(authHeader(sessionToken))
      .expect(410);

    assert.match(response.body.message, /expired/i);
  });

  it("persists guest and assistant messages without creating a Lead", async () => {
    await upsertProjectFacts(TEST_PROJECT, { approvalStatus: "approved" });

    __setGenerateLeadChatTurnForTests(async () => ({
      ok: true,
      data: {
        reply: "Hello from the assistant.",
        preferredLanguage: null,
        qualification: null,
        buyerSummary: null,
        needsHumanHandoff: false,
        handoffReason: null,
        recommendQualified: false,
      },
    }));

    const { sessionId, sessionToken } = await createSessionViaApi();
    const buyerMessage = "Hi, tell me about the project.";

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: buyerMessage })
      .expect(200);

    assert.equal(response.body.success, true);
    assert.equal(response.body.messages.length, 2);
    assert.equal(response.body.messages[0].from, "buyer");
    assert.equal(response.body.messages[0].text, buyerMessage);
    assert.equal(response.body.messages[1].from, "ai");
    assert.equal(response.body.messages[1].text, "Hello from the assistant.");

    const stored = await GuestSession.findById(sessionId);
    assert.equal(stored.messages.length, 2);
    assert.equal(await Lead.countDocuments(), 0);
  });

  it("uses approved facts and fact-gap routing without calling Gemini for missing inventory", async () => {
    await upsertProjectFacts(TEST_PROJECT, {
      approvalStatus: "approved",
      inventoryInformation: null,
    });

    const spy = useRealGenerateLeadChatTurnWithRetrySpy();
    const { sessionId, sessionToken } = await createSessionViaApi();

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "Are any units still available in this project?" })
      .expect(200);

    assert.equal(spy.count, 0);
    assert.match(response.body.messages[1].text, /don't have verified/i);
    assert.equal(response.body.needsHumanHandoff, true);

    const stored = await GuestSession.findById(sessionId);
    assert.equal(stored.needsHumanHandoff, true);
    assert.equal(await Lead.countDocuments(), 0);
  });

  it("returns graceful fallback for draft facts without creating a Lead", async () => {
    await upsertProjectFacts(TEST_PROJECT, { approvalStatus: "draft" });

    let geminiApiInvokeCount = 0;
    __setGenerateLeadChatTurnForTests(async (input) =>
      generateLeadChatTurn({
        ...input,
        _geminiRetryDeps: {
          executeWithPrimaryAndFallback: async () => {
            geminiApiInvokeCount += 1;
            throw new Error("Gemini API should not be invoked");
          },
        },
      }),
    );

    const { sessionId, sessionToken } = await createSessionViaApi();

    const response = await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "What is the price?" })
      .expect(200);

    assert.equal(geminiApiInvokeCount, 0);
    assert.equal(response.body.chatFailureReason, undefined);
    assert.equal(response.body.handoffReason, undefined);
    assert.equal(response.body.messages[1].text, EN_FALLBACK);
    assert.equal(await Lead.countDocuments(), 0);
  });

  it("rejects empty and oversized chat messages", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    const empty = await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "   " })
      .expect(400);

    assert.match(empty.body.message, /Validation failed/i);

    const oversized = await agent
      .post(`/api/public/sessions/${sessionId}/chat`)
      .set(authHeader(sessionToken))
      .send({ message: "x".repeat(CHAT_MAX_MESSAGE_LENGTH + 1) })
      .expect(400);

    assert.ok(
      oversized.body.errors.some((e) => e.includes(String(CHAT_MAX_MESSAGE_LENGTH))),
    );

    const stored = await GuestSession.findById(sessionId);
    assert.equal(stored.messages.length, 0);
  });

  it("does not expose a session token on GET after create", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();

    const response = await agent
      .get(`/api/public/sessions/${sessionId}`)
      .set(authHeader(sessionToken))
      .expect(200);

    assert.equal(response.body.sessionToken, undefined);
    assert.ok(
      !Object.values(response.body.session ?? {}).some(
        (value) => value === sessionToken,
      ),
    );
  });

  it("stores only a hash of the token (never the raw token in MongoDB)", async () => {
    const { sessionId, sessionToken } = await createSessionViaApi();
    const stored = await GuestSession.findById(sessionId).lean();

    assert.ok(stored.tokenHash);
    assert.notEqual(stored.tokenHash, sessionToken);
    assert.equal(stored.tokenHash.length, 64);
    assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(
      stored.tokenHash,
      crypto.createHash("sha256").update(sessionToken, "utf8").digest("hex"),
    );
  });
});
