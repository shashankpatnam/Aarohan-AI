/**
 * Retry, backoff, and primary/fallback orchestration for Gemini generateContent calls.
 * Injectable sleep/clock for tests.
 */

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_WAIT_MS = 8000;
const DEFAULT_TOTAL_BUDGET_MS = 20000;
const DEFAULT_CALL_TIMEOUT_MS = 15000;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 8000;

/**
 * @typedef {Object} GeminiRetryConfig
 * @property {number} maxRetriesPerModel
 * @property {number} maxWaitMs
 * @property {number} totalBudgetMs
 * @property {number} perCallTimeoutMs
 * @property {number} backoffBaseMs
 * @property {number} backoffMaxMs
 */

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {GeminiRetryConfig}
 */
export function readGeminiRetryConfig(env = process.env) {
  return {
    maxRetriesPerModel: readPositiveInt(env.GEMINI_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    maxWaitMs: readPositiveInt(env.GEMINI_MAX_WAIT_MS, DEFAULT_MAX_WAIT_MS),
    totalBudgetMs: readPositiveInt(
      env.GEMINI_TOTAL_BUDGET_MS,
      DEFAULT_TOTAL_BUDGET_MS,
    ),
    perCallTimeoutMs: readPositiveInt(
      env.GEMINI_CALL_TIMEOUT_MS,
      DEFAULT_CALL_TIMEOUT_MS,
    ),
    backoffBaseMs: readPositiveInt(
      env.GEMINI_BACKOFF_BASE_MS,
      DEFAULT_BACKOFF_BASE_MS,
    ),
    backoffMaxMs: readPositiveInt(
      env.GEMINI_BACKOFF_MAX_MS,
      DEFAULT_BACKOFF_MAX_MS,
    ),
  };
}

function readPositiveInt(raw, fallback) {
  if (raw == null || typeof raw !== "string") {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

/**
 * @param {string|null|undefined} headerValue
 * @param {number} [nowMs]
 * @returns {number|null} milliseconds to wait
 */
export function parseRetryAfterMs(headerValue, nowMs = Date.now()) {
  if (headerValue == null || typeof headerValue !== "string") {
    return null;
  }
  const trimmed = headerValue.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  const delta = dateMs - nowMs;
  return delta > 0 ? delta : 0;
}

/**
 * @param {string} value
 * @returns {number|null}
 */
export function parseDurationToMs(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const secondsMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.ceil(seconds * 1000);
  }
  const msMatch = trimmed.match(/^(\d+)ms$/i);
  if (msMatch) {
    const ms = Number(msMatch[1]);
    if (!Number.isFinite(ms) || ms < 0) {
      return null;
    }
    return ms;
  }
  return null;
}

/**
 * @param {unknown} error
 * @param {number} [nowMs]
 * @returns {number|null}
 */
export function extract429DelayMs(error, nowMs = Date.now()) {
  if (error == null || typeof error !== "object") {
    return null;
  }

  const retryAfterHeader =
    error.retryAfterHeader ?? error.retryAfter ?? null;
  if (retryAfterHeader != null) {
    const fromHeader = parseRetryAfterMs(String(retryAfterHeader), nowMs);
    if (fromHeader != null) {
      return fromHeader;
    }
  }

  const details = error.errorDetails;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (detail?.retryDelay != null) {
        const fromDetail = parseDurationToMs(String(detail.retryDelay));
        if (fromDetail != null) {
          return fromDetail;
        }
      }
    }
  }

  if (typeof error.message === "string") {
    const match = error.message.match(/retry(?:\s+delay)?[^\d]*(\d+(?:\.\d+)?)s/i);
    if (match) {
      return parseDurationToMs(`${match[1]}s`);
    }
  }

  return null;
}

/**
 * @param {number} retryIndex zero-based retry wait (0 = first wait after failure)
 * @param {GeminiRetryConfig} config
 * @param {() => number} [random]
 * @returns {number}
 */
export function computeBackoffWithJitter(retryIndex, config, random = Math.random) {
  const exponential = Math.min(
    config.backoffMaxMs,
    config.backoffBaseMs * 2 ** retryIndex,
  );
  const jitterCap = Math.min(1000, Math.floor(exponential * 0.25));
  const jitter = jitterCap > 0 ? Math.floor(random() * jitterCap) : 0;
  return Math.min(config.maxWaitMs, exponential + jitter);
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isModelSpecificError(error) {
  const status = error?.status;
  if (status === 404) {
    return true;
  }
  if (status !== 400) {
    return false;
  }
  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return (
    message.includes("model") &&
    (message.includes("not found") ||
      message.includes("invalid") ||
      message.includes("does not exist"))
  );
}

/**
 * @param {unknown} error
 * @returns {{ kind: 'success'|'rate_limit'|'transient'|'fatal'|'blocked', status: number|null, modelSpecific: boolean }}
 */
export function classifyGeminiCallError(error) {
  const status =
    typeof error?.status === "number" && Number.isFinite(error.status)
      ? error.status
      : null;

  if (error?.name === "GoogleGenerativeAIAbortError") {
    return { kind: "transient", status: null, modelSpecific: false };
  }

  if (status === 429) {
    return { kind: "rate_limit", status, modelSpecific: false };
  }

  if (status === 500 || status === 503) {
    return { kind: "transient", status, modelSpecific: false };
  }

  if (status === 400 || status === 401 || status === 403) {
    const modelSpecific = isModelSpecificError(error);
    return { kind: "fatal", status, modelSpecific };
  }

  if (status === 404) {
    return { kind: "fatal", status, modelSpecific: true };
  }

  if (status != null) {
    return { kind: "fatal", status, modelSpecific: false };
  }

  if (error instanceof Error) {
    return { kind: "transient", status: null, modelSpecific: false };
  }

  return { kind: "fatal", status: null, modelSpecific: false };
}

/**
 * @param {number} requestedWaitMs
 * @param {GeminiRetryConfig} config
 * @param {number} deadlineMs
 * @param {() => number} nowMs
 * @returns {{ action: 'wait', waitMs: number }|{ action: 'exceeds_max' }|{ action: 'deadline' }}
 */
export function resolveWaitBeforeRetry(
  requestedWaitMs,
  config,
  deadlineMs,
  nowMs,
) {
  if (requestedWaitMs > config.maxWaitMs) {
    return { action: "exceeds_max" };
  }

  const remaining = deadlineMs - nowMs();
  if (remaining <= 0) {
    return { action: "deadline" };
  }

  const waitMs = Math.max(1, Math.min(requestedWaitMs, remaining, config.maxWaitMs));
  return { action: "wait", waitMs };
}

/**
 * @typedef {Object} RetryLogPayload
 * @property {string} modelName
 * @property {number} attempt
 * @property {number|null} status
 * @property {number|null} waitMs
 * @property {string} event
 */

/**
 * @typedef {Object} ExecuteModelWithRetriesOptions
 * @property {string} modelName
 * @property {GeminiRetryConfig} config
 * @property {number} deadlineMs
 * @property {() => Promise<unknown>} invoke
 * @property {(ms: number) => Promise<void>} sleepMs
 * @property {() => number} nowMs
 * @property {(payload: RetryLogPayload) => void} [logRetry]
 */

/**
 * @param {ExecuteModelWithRetriesOptions} options
 * @returns {Promise<{ outcome: string, result?: unknown, error?: unknown, classification?: ReturnType<classifyGeminiCallError> }>}
 */
export async function executeModelWithRetries(options) {
  const { modelName, config, deadlineMs, invoke, sleepMs, nowMs, logRetry } =
    options;

  let retriesUsed = 0;

  while (true) {
    if (nowMs() >= deadlineMs) {
      return { outcome: "deadline_exceeded" };
    }

    const attempt = retriesUsed + 1;

    try {
      const result = await invoke();
      return { outcome: "success", result };
    } catch (error) {
      const classification = classifyGeminiCallError(error);

      if (classification.kind === "fatal" && !classification.modelSpecific) {
        return { outcome: "fatal", error, classification };
      }

      if (classification.modelSpecific) {
        return { outcome: "model_failed", error, classification };
      }

      if (retriesUsed >= config.maxRetriesPerModel) {
        return { outcome: "retries_exhausted", error, classification };
      }

      let requestedWaitMs;

      if (classification.kind === "rate_limit") {
        const providerDelay = extract429DelayMs(error, nowMs());
        if (providerDelay != null && providerDelay > config.maxWaitMs) {
          logRetry?.({
            modelName,
            attempt,
            status: classification.status,
            waitMs: providerDelay,
            event: "429_delay_exceeds_max",
          });
          return {
            outcome: "rate_limit_delay_exceeds_max",
            error,
            classification,
          };
        }

        requestedWaitMs =
          providerDelay != null && providerDelay > 0
            ? providerDelay
            : computeBackoffWithJitter(retriesUsed, config);
      } else if (classification.kind === "transient") {
        requestedWaitMs = computeBackoffWithJitter(retriesUsed, config);
      } else {
        return { outcome: "fatal", error, classification };
      }

      const waitPlan = resolveWaitBeforeRetry(
        requestedWaitMs,
        config,
        deadlineMs,
        nowMs,
      );

      if (waitPlan.action === "exceeds_max") {
        return {
          outcome: "rate_limit_delay_exceeds_max",
          error,
          classification,
        };
      }
      if (waitPlan.action === "deadline") {
        return { outcome: "deadline_exceeded", error, classification };
      }

      logRetry?.({
        modelName,
        attempt,
        status: classification.status ?? error?.status ?? null,
        waitMs: waitPlan.waitMs,
        event: "retry_wait",
      });

      await sleepMs(waitPlan.waitMs);
      retriesUsed += 1;
    }
  }
}

/**
 * @typedef {Object} ExecutePrimaryFallbackOptions
 * @property {string} primaryModel
 * @property {string} fallbackModel
 * @property {GeminiRetryConfig} config
 * @property {(modelName: string) => Promise<unknown>} invokeForModel
 * @property {(ms: number) => Promise<void>} sleepMs
 * @property {() => number} nowMs
 * @property {(payload: RetryLogPayload) => void} [logRetry]
 */

/**
 * @param {ExecutePrimaryFallbackOptions} options
 * @returns {Promise<{ outcome: string, result?: unknown, error?: unknown, modelName?: string }>}
 */
export async function executeWithPrimaryAndFallback(options) {
  const {
    primaryModel,
    fallbackModel,
    config,
    invokeForModel,
    sleepMs,
    nowMs,
    logRetry,
  } = options;

  const deadlineMs = nowMs() + config.totalBudgetMs;

  const primaryResult = await executeModelWithRetries({
    modelName: primaryModel,
    config,
    deadlineMs,
    invoke: () => invokeForModel(primaryModel),
    sleepMs,
    nowMs,
    logRetry,
  });

  if (primaryResult.outcome === "success") {
    return { ...primaryResult, modelName: primaryModel };
  }

  if (primaryResult.outcome === "fatal") {
    return { ...primaryResult, modelName: primaryModel };
  }

  const shouldTryFallback =
    primaryModel !== fallbackModel &&
    [
      "retries_exhausted",
      "rate_limit_delay_exceeds_max",
      "model_failed",
      "deadline_exceeded",
    ].includes(primaryResult.outcome);

  if (!shouldTryFallback) {
    return { ...primaryResult, modelName: primaryModel };
  }

  if (nowMs() >= deadlineMs) {
    return { ...primaryResult, modelName: primaryModel };
  }

  logRetry?.({
    modelName: fallbackModel,
    attempt: 0,
    status: null,
    waitMs: null,
    event: "fallback_start",
  });

  const fallbackResult = await executeModelWithRetries({
    modelName: fallbackModel,
    config,
    deadlineMs,
    invoke: () => invokeForModel(fallbackModel),
    sleepMs,
    nowMs,
    logRetry,
  });

  if (fallbackResult.outcome === "success") {
    return { ...fallbackResult, modelName: fallbackModel };
  }

  return { ...fallbackResult, modelName: fallbackModel };
}

export const defaultSleepMs = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
