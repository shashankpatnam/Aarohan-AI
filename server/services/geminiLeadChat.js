import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import {
  APPROVED_FACT_PROJECT_NAMES,
  NOT_PROVIDED,
} from "../config/projectFacts.js";
import { getApprovedPortfolioFacts } from "./projectFactsService.js";
import {
  applyPropertyClaimSafeguard,
  detectUnsupportedClaimCategories,
} from "./chatPropertyClaimGuard.js";
import { tryBuildFactGapHandoffTurn } from "./propertyFactGapRouting.js";
import {
  defaultSleepMs,
  executeWithPrimaryAndFallback,
  readGeminiRetryConfig,
} from "./geminiRetryPolicy.js";

/** @typedef {"buyer"|"ai"} MessageFrom */

/**
 * @typedef {Object} ConversationMessage
 * @property {MessageFrom} from
 * @property {string} text
 */

/**
 * @typedef {Object} LeadQualificationContext
 * @property {string} [buyingTimeline]
 * @property {string} [budgetFit]
 * @property {string} [locationPreference]
 * @property {number|null} [score]
 */

/**
 * @typedef {Object} LeadChatContext
 * @property {string|null} [primaryProject]
 * @property {string|null} [initialProject]
 * @property {string[]} [interestedProjects]
 * @property {string} [name]
 * @property {string} [budget]
 * @property {string} [preferredConfiguration]
 * @property {string} [preferredLanguage]
 * @property {string} [status]
 * @property {string} [buyerSummary]
 * @property {LeadQualificationContext} [qualification]
 */

/**
 * @typedef {Object} GenerateLeadChatTurnInput
 * @property {string|null} [initialProject]
 * @property {string} [projectName] Legacy alias used by CRM lead chat.
 * @property {ConversationMessage[]} [recentMessages]
 * @property {string} latestBuyerMessage
 * @property {LeadChatContext} [leadContext]
 */

/**
 * @typedef {Object} QualificationUpdates
 * @property {string} [buyingTimeline]
 * @property {string} [budgetFit]
 * @property {string} [locationPreference]
 * @property {number} [score]
 */

/**
 * @typedef {Object} LeadChatTurnData
 * @property {string} reply
 * @property {string|null} preferredLanguage
 * @property {QualificationUpdates|null} qualification
 * @property {string|null} buyerSummary
 * @property {boolean} needsHumanHandoff
 * @property {string|null} handoffReason
 * @property {boolean} recommendQualified
 */

/**
 * @typedef {Object} LeadChatTurnSuccess
 * @property {true} ok
 * @property {LeadChatTurnData} data
 */

/**
 * @typedef {Object} LeadChatTurnFailure
 * @property {false} ok
 * @property {{ code: string, message: string }} error
 */

/** @typedef {LeadChatTurnSuccess|LeadChatTurnFailure} LeadChatTurnResult */

export const GEMINI_CHAT_ERROR = {
  CONFIG: "GEMINI_CONFIG_ERROR",
  VALIDATION: "GEMINI_VALIDATION_ERROR",
  PROJECT_FACTS: "GEMINI_PROJECT_FACTS_ERROR",
  API: "GEMINI_API_ERROR",
  MODEL_UNAVAILABLE: "GEMINI_MODEL_UNAVAILABLE",
  EMPTY: "GEMINI_EMPTY_RESPONSE",
  PARSE: "GEMINI_PARSE_ERROR",
  BLOCKED: "GEMINI_BLOCKED_RESPONSE",
};

const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_FALLBACK_MODEL = "gemini-2.0-flash-lite";
const MAX_RECENT_MESSAGES = 24;
const MAX_BUYER_MESSAGE_LENGTH = 4000;

const RESPONSE_JSON_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    reply: {
      type: SchemaType.STRING,
      description: "Assistant reply to the buyer in their language when identifiable.",
    },
    preferredLanguage: {
      type: SchemaType.STRING,
      description:
        "Detected or confirmed language code or name, e.g. en, hi, gu, English, Hindi, Gujarati. Null if unknown.",
      nullable: true,
    },
    qualification: {
      type: SchemaType.OBJECT,
      nullable: true,
      description:
        "Only fields confidently extracted or updated from this turn; omit uncertain fields.",
      properties: {
        buyingTimeline: { type: SchemaType.STRING, nullable: true },
        budgetFit: { type: SchemaType.STRING, nullable: true },
        locationPreference: { type: SchemaType.STRING, nullable: true },
        score: { type: SchemaType.INTEGER, nullable: true },
      },
    },
    buyerSummary: {
      type: SchemaType.STRING,
      nullable: true,
      description:
        "Concise CRM summary of the FULL conversation so far (merge with existing leadContext.buyerSummary). Cover project interest; budget only if the buyer stated one; configuration if stated; questions/concerns; missing or unverified information they asked about; visit interest; callback or contact preference. Never invent budget or preferences. 2–6 short sentences. Null only if nothing can be said yet.",
    },
    needsHumanHandoff: {
      type: SchemaType.BOOLEAN,
      description: "True when a human should follow up (complex request, frustration, unknown facts).",
    },
    handoffReason: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Short reason when needsHumanHandoff is true; otherwise null.",
    },
    recommendQualified: {
      type: SchemaType.BOOLEAN,
      description:
        "True only when the buyer has clearly confirmed buying timeline, budget fit, and location preference in this conversation (all three). False otherwise. Never true based on score alone.",
    },
  },
  required: ["reply", "needsHumanHandoff", "recommendQualified"],
};

export const SYSTEM_INSTRUCTION = `You are Aarohan AI, Aarohan's portfolio-wide real estate concierge. You help buyers explore the six approved residential projects in the supplied portfolio facts.

Portfolio discovery:
- In General Chat (no initial project), welcome buyers exploring Aarohan's portfolio. Ask concise questions about configuration, budget, location, and preferences when they would help narrow options.
- When initialProject is provided, treat it only as the project context where the enquiry began. It is not a confirmed buyer interest or primary preference. Keep it in mind across turns, but never restrict the buyer to it.
- Treat primaryProject and interestedProjects as separately recorded lead fields. Do not infer a primary project from initialProject or from interestedProjects; if primaryProject is null, say the lead has no primary project recorded.
- Answer questions about any of the six projects in the same conversation. Compare or suggest alternatives only using facts supplied for the specific projects being discussed. Explain the verified basis for comparisons and ask a follow-up when the buyer's needs are unclear.
- Recommend a project only when the buyer's stated needs can be matched to that project's approved facts. Do not assume one project's facts apply to another.
- A portfolio entry with facts: null has no approved facts. Do not fill that gap from memory or from another project; say the details are not verified and offer human follow-up.

Grounding (mandatory):
- Use ONLY the approved portfolio facts JSON supplied in the user message for property-specific claims (location, configurations, amenities, possession, RERA, pricing, inventory, visit process).
- Treat null, empty arrays, and the string "${NOT_PROVIDED}" as unknown. Never infer, estimate, or fabricate missing details.
- Do not invent prices, discounts, inventory or availability, possession dates, RERA numbers, amenities, configurations, or locations.
- If information is unknown or unverified, say so clearly and offer human follow-up. Set needsHumanHandoff true with a brief handoffReason when appropriate.

Language:
- Reply in the buyer's language when reasonably identifiable (English, Hindi, Gujarati, or mixed). Mirror the latest buyer message when clear.

Site visits:
- Buyers can book site visits directly through this chat. The interactive booking flow collects contact details, shows live available dates and time slots, and submits the selected visit.
- When a buyer asks to visit, schedule a visit, or asks which dates or slots are available, acknowledge that they can continue in the interactive booking flow. Do not ask them to type a preferred date or time when the calendar is available, and do not describe the old CRM-only process.
- Never claim a visit is booked, confirmed, or scheduled. Only the booking API can confirm it after successful persistence. If a human needs to help, offer handoff as an additional option; handoff does not replace self-service booking.
- Explain the approved visitProcess fact when present only for informational questions. Do not let stale CRM-only or manual-booking language override the current interactive booking flow.

Buyer summary:
- Return buyerSummary that covers the whole conversation, merging LEAD CONTEXT.buyerSummary with new turns—not only the latest topic.
- Include only what the buyer stated or what is in approved facts: project interest; budget if stated; configuration if stated; questions and concerns; missing/unverified information they asked about; visit interest; callback/contact preference.
- Never infer a budget or preference. Omit unknown facets. Keep it concise (2–6 short sentences). Update it whenever the buyer adds information.

Qualification:
- Ask concise, natural qualification questions (timeline, budget fit, configuration, location preference) without repeating information already in lead context.
- Populate qualification in JSON only for fields you are confident about from this conversation turn.
- Set recommendQualified to true only when the buyer has clearly confirmed all three: buying timeline, budget fit, and location preference. Do not set recommendQualified true based on score alone or partial information.

Output:
- Return JSON matching the required schema only. No markdown outside JSON.`;

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function success(data) {
  return { ok: true, data };
}

function logServiceIssue(code, detail) {
  const suffix = detail ? `: ${detail}` : "";
  console.error(`geminiLeadChat ${code}${suffix}`);
}

function readApiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key || null;
}

function readModelName() {
  const model = process.env.GEMINI_MODEL?.trim();
  return model || DEFAULT_MODEL;
}

function readFallbackModelName() {
  const fallback = process.env.GEMINI_FALLBACK_MODEL?.trim();
  return fallback || DEFAULT_FALLBACK_MODEL;
}

/**
 * Handoff turn when Gemini is unavailable after retries (successful API contract).
 *
 * @param {string|null} [initialProject]
 * @returns {LeadChatTurnData}
 */
export function buildGeminiOutageHandoffTurn(initialProject = null) {
  const context =
    typeof initialProject === "string" && initialProject.trim()
      ? initialProject.trim()
      : "our Aarohan property portfolio";
  return {
    reply:
      "I'm unable to complete your request automatically right now. " +
      `A member of our sales team will follow up with you shortly about ${context}.`,
    preferredLanguage: null,
    qualification: null,
    buyerSummary: null,
    needsHumanHandoff: true,
    handoffReason:
      "AI assistant temporarily unavailable; sales executive follow-up recommended.",
    recommendQualified: false,
  };
}

function logGeminiRetryEvent(payload) {
  const { modelName, attempt, status, waitMs, event } = payload;
  console.error(
    `geminiLeadChat GEMINI_RETRY event=${event} status=${status ?? "n/a"} model=${modelName} attempt=${attempt} waitMs=${waitMs ?? 0}`,
  );
}

async function generateContentWithRetry(
  apiKey,
  userPrompt,
  retryConfig,
  deps = {},
) {
  deps.capturePrompt?.(userPrompt);
  const sleepMs = deps.sleepMs ?? defaultSleepMs;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const execute = deps.executeWithPrimaryAndFallback ?? executeWithPrimaryAndFallback;
  const primaryModel = deps.primaryModel ?? readModelName();
  const fallbackModel = deps.fallbackModel ?? readFallbackModelName();

  return execute({
    primaryModel,
    fallbackModel,
    config: retryConfig,
    invokeForModel: async (modelName) => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel(
        {
          model: modelName,
          systemInstruction: SYSTEM_INSTRUCTION,
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_JSON_SCHEMA,
          },
        },
        { timeout: retryConfig.perCallTimeoutMs },
      );
      return model.generateContent(userPrompt);
    },
    sleepMs,
    nowMs,
    logRetry: deps.logRetry ?? logGeminiRetryEvent,
  });
}

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateInput(input) {
  if (input == null || typeof input !== "object") {
    return { errors: ["input is required"] };
  }

  const rawInitialProject = Object.hasOwn(input, "initialProject")
    ? input.initialProject
    : input.projectName;
  const initialProject =
    typeof rawInitialProject === "string" ? rawInitialProject.trim() : null;
  const latestBuyerMessage =
    typeof input.latestBuyerMessage === "string"
      ? input.latestBuyerMessage.trim()
      : "";

  const errors = [];

  if (rawInitialProject != null && typeof rawInitialProject !== "string") {
    errors.push("initialProject must be a project name or null");
  } else if (
    initialProject &&
    !APPROVED_FACT_PROJECT_NAMES.includes(initialProject)
  ) {
    errors.push("initialProject must be one of the approved project names");
  }
  if (!latestBuyerMessage) {
    errors.push("latestBuyerMessage is required");
  } else if (latestBuyerMessage.length > MAX_BUYER_MESSAGE_LENGTH) {
    errors.push(
      `latestBuyerMessage must be at most ${MAX_BUYER_MESSAGE_LENGTH} characters`,
    );
  }

  if (input.recentMessages != null && !Array.isArray(input.recentMessages)) {
    errors.push("recentMessages must be an array when provided");
  }

  if (input.leadContext != null && typeof input.leadContext !== "object") {
    errors.push("leadContext must be an object when provided");
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: {
      initialProject,
      latestBuyerMessage,
      recentMessages: Array.isArray(input.recentMessages)
        ? input.recentMessages
        : [],
      leadContext: input.leadContext ?? {},
    },
  };
}

function sanitizeMessagesForPrompt(messages) {
  const slice = messages.slice(-MAX_RECENT_MESSAGES);
  const normalized = [];

  for (const msg of slice) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    const from = msg.from === "ai" || msg.from === "buyer" ? msg.from : null;
    const text = typeof msg.text === "string" ? msg.text.trim() : "";
    if (!from || !text) {
      continue;
    }
    normalized.push({ from, text });
  }

  return normalized;
}

function buildLeadContextForPrompt(leadContext) {
  const qualification = leadContext.qualification ?? {};
  return {
    primaryProject: normalizeOptionalString(leadContext.primaryProject),
    initialProject: normalizeOptionalString(leadContext.initialProject),
    interestedProjects: Array.isArray(leadContext.interestedProjects)
      ? leadContext.interestedProjects.filter((project) => APPROVED_FACT_PROJECT_NAMES.includes(project))
      : [],
    name: normalizeOptionalString(leadContext.name),
    budget: normalizeOptionalString(leadContext.budget),
    preferredConfiguration: normalizeOptionalString(
      leadContext.preferredConfiguration,
    ),
    preferredLanguage: normalizeOptionalString(leadContext.preferredLanguage),
    status: normalizeOptionalString(leadContext.status),
    buyerSummary: normalizeOptionalString(leadContext.buyerSummary),
    qualification: {
      buyingTimeline: normalizeOptionalString(qualification.buyingTimeline),
      budgetFit: normalizeOptionalString(qualification.budgetFit),
      locationPreference: normalizeOptionalString(
        qualification.locationPreference,
      ),
      score:
        typeof qualification.score === "number" &&
        Number.isFinite(qualification.score)
          ? qualification.score
          : null,
    },
  };
}

function formatTranscript(messages) {
  if (messages.length === 0) {
    return "(no prior messages)";
  }

  return messages
    .map((msg) => `${msg.from === "buyer" ? "Buyer" : "Assistant"}: ${msg.text}`)
    .join("\n");
}

function buildUserPrompt({
  initialProject,
  approvedFacts,
  leadContext,
  recentMessages,
  latestBuyerMessage,
}) {
  const prior = sanitizeMessagesForPrompt(recentMessages);
  const contextPayload = buildLeadContextForPrompt(leadContext);

  return [
    "=== APPROVED PORTFOLIO FACTS (only source for property claims) ===",
    JSON.stringify(approvedFacts, null, 2),
    "",
    "=== LEAD CONTEXT (do not ask for details already present) ===",
    JSON.stringify(
      { ...contextPayload, initialProject },
      null,
      2,
    ),
    "",
    "=== RECENT CONVERSATION ===",
    formatTranscript(prior),
    "",
    "=== LATEST BUYER MESSAGE ===",
    latestBuyerMessage,
    "",
    "Respond with JSON only.",
  ].join("\n");
}

function extractJsonCandidate(rawText) {
  if (typeof rawText !== "string") {
    return null;
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    const inner = fenceMatch[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      return null;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(slice);
      return slice;
    } catch {
      return null;
    }
  }

  return null;
}

function parseQualificationUpdates(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const updates = {};
  const buyingTimeline = normalizeOptionalString(raw.buyingTimeline);
  const budgetFit = normalizeOptionalString(raw.budgetFit);
  const locationPreference = normalizeOptionalString(raw.locationPreference);

  if (buyingTimeline) {
    updates.buyingTimeline = buyingTimeline;
  }
  if (budgetFit) {
    updates.budgetFit = budgetFit;
  }
  if (locationPreference) {
    updates.locationPreference = locationPreference;
  }

  if (raw.score != null && raw.score !== "") {
    const score = Number(raw.score);
    if (Number.isInteger(score) && score >= 0 && score <= 100) {
      updates.score = score;
    }
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

function normalizeModelPayload(parsed) {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Response JSON must be an object" };
  }

  const reply = normalizeOptionalString(parsed.reply);
  if (!reply) {
    return { error: "Response JSON must include a non-empty reply" };
  }

  const needsHumanHandoff = parsed.needsHumanHandoff === true;
  let handoffReason = normalizeOptionalString(parsed.handoffReason);
  if (!needsHumanHandoff) {
    handoffReason = null;
  } else if (!handoffReason) {
    handoffReason = "Human follow-up requested";
  }

  const preferredLanguage = normalizeOptionalString(parsed.preferredLanguage);
  const buyerSummary = normalizeOptionalString(parsed.buyerSummary);
  const qualification = parseQualificationUpdates(parsed.qualification);
  const recommendQualified = parsed.recommendQualified === true;

  return {
    data: {
      reply,
      preferredLanguage,
      qualification,
      buyerSummary,
      needsHumanHandoff,
      handoffReason,
      recommendQualified,
    },
  };
}

function parseModelResponseText(rawText) {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) {
    return { parseError: true };
  }

  try {
    const parsed = JSON.parse(candidate);
    const normalized = normalizeModelPayload(parsed);
    if (normalized.error) {
      return { parseError: true, detail: normalized.error };
    }
    return { data: normalized.data };
  } catch {
    return { parseError: true };
  }
}

function getBlockReason(response) {
  const candidate = response?.candidates?.[0];
  if (!candidate) {
    return "no candidates";
  }
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    return candidate.finishReason;
  }
  return null;
}

/**
 * Generates one grounded assistant turn for lead chat (no persistence).
 * Requires process.env.GEMINI_API_KEY (load dotenv before calling in scripts/tests).
 *
 * @param {GenerateLeadChatTurnInput} input
 * @returns {Promise<LeadChatTurnResult>}
 */
export async function generateLeadChatTurn(input) {
  const validated = validateInput(input);
  if (validated.errors) {
    logServiceIssue(GEMINI_CHAT_ERROR.VALIDATION, validated.errors.join("; "));
    return failure(
      GEMINI_CHAT_ERROR.VALIDATION,
      validated.errors.join(". "),
    );
  }

  const { initialProject, latestBuyerMessage, recentMessages, leadContext } =
    validated.data;

  const approvedFacts = await getApprovedPortfolioFacts();
  if (!approvedFacts.projects.some((entry) => entry.facts)) {
    logServiceIssue(
      GEMINI_CHAT_ERROR.PROJECT_FACTS,
      "No approved facts for the portfolio",
    );
    return failure(
      GEMINI_CHAT_ERROR.PROJECT_FACTS,
      "No approved project facts are available for the Aarohan portfolio.",
    );
  }

  const factGapTurn = tryBuildFactGapHandoffTurn(
    latestBuyerMessage,
    approvedFacts,
    initialProject,
  );
  if (factGapTurn) {
    logServiceIssue("PROPERTY_FACT_GAP", "unavailable requested categories");
    return success(factGapTurn);
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    logServiceIssue(GEMINI_CHAT_ERROR.CONFIG, "GEMINI_API_KEY missing or blank");
    return failure(
      GEMINI_CHAT_ERROR.CONFIG,
      "Gemini is not configured. Set GEMINI_API_KEY in server/.env.",
    );
  }

  const userPrompt = buildUserPrompt({
    initialProject,
    approvedFacts,
    leadContext,
    recentMessages,
    latestBuyerMessage,
  });

  try {
    const retryConfig = readGeminiRetryConfig();
    const retryOutcome = await generateContentWithRetry(
      apiKey,
      userPrompt,
      retryConfig,
      input._geminiRetryDeps,
    );

    if (retryOutcome.outcome === "fatal") {
      logServiceIssue(
        GEMINI_CHAT_ERROR.API,
        `status=${retryOutcome.error?.status ?? "n/a"}`,
      );
      return failure(
        GEMINI_CHAT_ERROR.API,
        "Gemini request failed. Please try again later.",
      );
    }

    if (retryOutcome.outcome !== "success") {
      logServiceIssue(
        GEMINI_CHAT_ERROR.MODEL_UNAVAILABLE,
        `outcome=${retryOutcome.outcome} model=${retryOutcome.modelName ?? "n/a"}`,
      );
      return failure(
        GEMINI_CHAT_ERROR.MODEL_UNAVAILABLE,
        "The AI assistant is temporarily unavailable.",
      );
    }

    const result = retryOutcome.result;
    const response = result.response;

    const blockReason = getBlockReason(response);
    if (blockReason) {
      logServiceIssue(GEMINI_CHAT_ERROR.BLOCKED, blockReason);
      return failure(
        GEMINI_CHAT_ERROR.BLOCKED,
        "The model could not produce a safe response for this message.",
      );
    }

    let rawText = "";
    try {
      rawText = response.text();
    } catch (textError) {
      logServiceIssue(
        GEMINI_CHAT_ERROR.EMPTY,
        textError instanceof Error ? textError.message : "text() failed",
      );
      return failure(
        GEMINI_CHAT_ERROR.EMPTY,
        "Gemini returned an empty response.",
      );
    }

    if (!rawText.trim()) {
      logServiceIssue(GEMINI_CHAT_ERROR.EMPTY, "empty text");
      return failure(
        GEMINI_CHAT_ERROR.EMPTY,
        "Gemini returned an empty response.",
      );
    }

    const parsed = parseModelResponseText(rawText);
    if (parsed.parseError) {
      logServiceIssue(
        GEMINI_CHAT_ERROR.PARSE,
        parsed.detail ?? "invalid JSON shape",
      );
      return failure(
        GEMINI_CHAT_ERROR.PARSE,
        "Could not parse the model response. Please try again.",
      );
    }

    const safeguarded = applyPropertyClaimSafeguard(
      parsed.data,
      approvedFacts,
      initialProject,
    );

    if (safeguarded.reply !== parsed.data.reply) {
      const categories = detectUnsupportedClaimCategories(
        parsed.data.reply,
        approvedFacts,
      );
      logServiceIssue(
        "PROPERTY_CLAIM_SAFEGUARD",
        `Replaced reply; categories: ${categories.join(", ")}`,
      );
    }

    return success(safeguarded);
  } catch (error) {
    const apiMessage =
      error instanceof Error ? error.message : "Unknown Gemini API error";
    logServiceIssue(GEMINI_CHAT_ERROR.API, apiMessage);
    return failure(
      GEMINI_CHAT_ERROR.API,
      "Gemini request failed. Please try again later.",
    );
  }
}
