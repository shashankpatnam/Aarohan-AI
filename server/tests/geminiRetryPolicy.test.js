import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyGeminiCallError,
  computeBackoffWithJitter,
  executeModelWithRetries,
  executeWithPrimaryAndFallback,
  extract429DelayMs,
  parseRetryAfterMs,
} from "../services/geminiRetryPolicy.js";
import { buildGeminiOutageHandoffTurn } from "../services/geminiLeadChat.js";

function makeHttpError(status, extra = {}) {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  error.name = "GoogleGenerativeAIFetchError";
  Object.assign(error, extra);
  return error;
}

describe("geminiRetryPolicy helpers", () => {
  it("parses Retry-After seconds", () => {
    assert.equal(parseRetryAfterMs("34"), 34000);
  });

  it("extracts Gemini retryDelay duration", () => {
    const delay = extract429DelayMs({
      status: 429,
      errorDetails: [{ retryDelay: "34s" }],
    });
    assert.equal(delay, 34000);
  });

  it("classifies 400 as fatal non-model-specific", () => {
    const c = classifyGeminiCallError(makeHttpError(400, { message: "Bad request" }));
    assert.equal(c.kind, "fatal");
    assert.equal(c.modelSpecific, false);
  });
});

describe("executeModelWithRetries", () => {
  let now;
  let sleeps;

  const baseConfig = {
    maxRetriesPerModel: 2,
    maxWaitMs: 8000,
    totalBudgetMs: 20000,
    perCallTimeoutMs: 15000,
    backoffBaseMs: 1000,
    backoffMaxMs: 8000,
  };

  function createRunner(config = baseConfig) {
    now = 1_000_000;
    sleeps = [];
    return {
      config,
      sleeps,
      runWithInvoke(invoke) {
        return executeModelWithRetries({
          modelName: "primary-model",
          config,
          deadlineMs: now + config.totalBudgetMs,
          invoke,
          sleepMs: async (ms) => {
            sleeps.push(ms);
            now += ms;
          },
          nowMs: () => now,
        });
      },
    };
  }

  it("waits the provider 429 delay before retrying", async () => {
    let calls = 0;
    const config = { ...baseConfig, maxWaitMs: 10000 };
    const { runWithInvoke, sleeps } = createRunner(config);

    const result = await runWithInvoke(async () => {
      calls += 1;
      if (calls === 1) {
        throw makeHttpError(429, {
          errorDetails: [{ retryDelay: "5s" }],
        });
      }
      return { ok: true };
    });

    assert.equal(result.outcome, "success");
    assert.deepEqual(sleeps, [5000]);
    assert.equal(calls, 2);
  });

  it("uses Retry-After header delay for 429", async () => {
    let calls = 0;
    const { runWithInvoke, sleeps } = createRunner();

    const result = await runWithInvoke(async () => {
      calls += 1;
      if (calls === 1) {
        throw makeHttpError(429, { retryAfterHeader: "5" });
      }
      return { ok: true };
    });

    assert.equal(result.outcome, "success");
    assert.deepEqual(sleeps, [5000]);
  });

  it("uses bounded backoff when 429 has no provider delay", async () => {
    let calls = 0;
    const { runWithInvoke, sleeps } = createRunner();

    const result = await runWithInvoke(async () => {
      calls += 1;
      if (calls < 3) {
        throw makeHttpError(429);
      }
      return { ok: true };
    });

    assert.equal(result.outcome, "success");
    assert.equal(sleeps.length, 2);
    for (const wait of sleeps) {
      assert.ok(wait >= 1);
      assert.ok(wait <= baseConfig.maxWaitMs);
    }
  });

  it("skips wait when 429 provider delay exceeds max wait", async () => {
    let calls = 0;
    const { runWithInvoke, sleeps } = createRunner();

    const result = await runWithInvoke(async () => {
      calls += 1;
      throw makeHttpError(429, {
        errorDetails: [{ retryDelay: "120s" }],
      });
    });

    assert.equal(result.outcome, "rate_limit_delay_exceeds_max");
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it("does not retry fatal 400 errors", async () => {
    let calls = 0;
    const { runWithInvoke, sleeps } = createRunner();

    const result = await runWithInvoke(async () => {
      calls += 1;
      throw makeHttpError(400, { message: "invalid payload" });
    });

    assert.equal(result.outcome, "fatal");
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it("stops after retry limit and returns retries_exhausted", async () => {
    let calls = 0;
    const { runWithInvoke, sleeps } = createRunner();

    const result = await runWithInvoke(async () => {
      calls += 1;
      throw makeHttpError(503);
    });

    assert.equal(result.outcome, "retries_exhausted");
    assert.equal(calls, 3);
    assert.equal(sleeps.length, 2);
  });

  it("runs side-effectful invoke only until success once", async () => {
    let calls = 0;
    let successPayloadWrites = 0;
    const { runWithInvoke } = createRunner();

    const result = await runWithInvoke(async () => {
      calls += 1;
      if (calls < 3) {
        throw makeHttpError(503);
      }
      successPayloadWrites += 1;
      return { value: "final" };
    });

    assert.equal(result.outcome, "success");
    assert.equal(successPayloadWrites, 1);
    assert.equal(calls, 3);
  });
});

describe("executeWithPrimaryAndFallback", () => {
  it("503 on primary backs off then succeeds on fallback", async () => {
    let now = 0;
    const sleeps = [];
    const attempts = [];

    const config = {
      maxRetriesPerModel: 1,
      maxWaitMs: 5000,
      totalBudgetMs: 60000,
      perCallTimeoutMs: 15000,
      backoffBaseMs: 500,
      backoffMaxMs: 5000,
    };

    const result = await executeWithPrimaryAndFallback({
      primaryModel: "primary",
      fallbackModel: "fallback",
      config,
      invokeForModel: async (modelName) => {
        attempts.push(modelName);
        if (modelName === "primary") {
          throw makeHttpError(503);
        }
        return { modelName, ok: true };
      },
      sleepMs: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      nowMs: () => now,
    });

    assert.equal(result.outcome, "success");
    assert.equal(result.modelName, "fallback");
    assert.ok(attempts.includes("primary"));
    assert.ok(attempts.includes("fallback"));
    assert.ok(sleeps.length >= 1);
  });

  it("fallback 429 uses the same exceed-max policy without waiting", async () => {
    const sleeps = [];
    const config = {
      maxRetriesPerModel: 1,
      maxWaitMs: 1000,
      totalBudgetMs: 60000,
      perCallTimeoutMs: 15000,
      backoffBaseMs: 500,
      backoffMaxMs: 5000,
    };

    const result = await executeWithPrimaryAndFallback({
      primaryModel: "primary",
      fallbackModel: "fallback",
      config,
      invokeForModel: async () => {
        throw makeHttpError(429, {
          errorDetails: [{ retryDelay: "90s" }],
        });
      },
      sleepMs: async (ms) => {
        sleeps.push(ms);
      },
      nowMs: () => Date.now(),
    });

    assert.notEqual(result.outcome, "success");
    assert.deepEqual(sleeps, []);
  });
});

describe("buildGeminiOutageHandoffTurn", () => {
  it("returns handoff reply for exhausted Gemini attempts", () => {
    const turn = buildGeminiOutageHandoffTurn("Skyline Residences");
    assert.match(turn.reply, /sales team/i);
    assert.equal(turn.needsHumanHandoff, true);
    assert.ok(turn.handoffReason);
  });

  it("uses portfolio wording when General Chat has no initial project", () => {
    const turn = buildGeminiOutageHandoffTurn(null);
    assert.match(turn.reply, /our Aarohan property portfolio/i);
    assert.equal(turn.needsHumanHandoff, true);
  });
});

describe("computeBackoffWithJitter bounds", () => {
  it("never exceeds configured max wait", () => {
    const config = {
      maxRetriesPerModel: 2,
      maxWaitMs: 8000,
      totalBudgetMs: 20000,
      perCallTimeoutMs: 15000,
      backoffBaseMs: 1000,
      backoffMaxMs: 8000,
    };
    const wait = computeBackoffWithJitter(5, config, () => 0.99);
    assert.ok(wait <= config.maxWaitMs);
  });
});
