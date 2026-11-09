import { GEMINI_CHAT_ERROR } from "./geminiLeadChat.js";

/** @typedef {"no_approved_facts"|"model_unavailable"|"unknown_error"} ChatFailureReason */

export const CHAT_FAILURE_REASON = {
  NO_APPROVED_FACTS: "no_approved_facts",
  MODEL_UNAVAILABLE: "model_unavailable",
  UNKNOWN_ERROR: "unknown_error",
};

const FALLBACK_REPLY_BY_LANG = {
  en:
    "Thanks for your message. A member of our team will confirm the details and get back to you shortly.",
  hi:
    "आपके संदेश के लिए धन्यवाद। हमारी टीम का सदस्य विवरण की पुष्टि करके शीघ्र आपसे संपर्क करेगा।",
  gu:
    "તમારા સંદેશ માટે આભાર. અમારી ટીમનો સભ્ય વિગતોની ખાતરી કરીને ટૂંક સમયમાં તમારો સંપર્ક કરશે.",
};

const HANDOFF_PREFIX_BY_REASON = {
  [CHAT_FAILURE_REASON.NO_APPROVED_FACTS]:
    "Automated chat could not use approved project facts.",
  [CHAT_FAILURE_REASON.MODEL_UNAVAILABLE]:
    "Automated chat could not reach the AI assistant.",
  [CHAT_FAILURE_REASON.UNKNOWN_ERROR]:
    "Automated chat encountered an unexpected error.",
};

const BUYER_MESSAGE_HANDOFF_MAX = 160;

function truncateForHandoff(text, maxLength = BUYER_MESSAGE_HANDOFF_MAX) {
  if (typeof text !== "string") {
    return "";
  }
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

/**
 * @param {string} [preferredLanguage]
 * @returns {string}
 */
export function resolveFallbackReplyText(preferredLanguage) {
  const normalized = normalizeLeadLanguageCode(preferredLanguage);
  return FALLBACK_REPLY_BY_LANG[normalized] ?? FALLBACK_REPLY_BY_LANG.en;
}

/**
 * @param {string} [preferredLanguage]
 * @returns {"en"|"hi"|"gu"}
 */
export function normalizeLeadLanguageCode(preferredLanguage) {
  const value = typeof preferredLanguage === "string" ? preferredLanguage.trim() : "";
  const lower = value.toLowerCase();
  if (lower === "hi" || lower === "hindi" || lower.startsWith("hindi")) {
    return "hi";
  }
  if (lower === "gu" || lower === "gujarati" || lower.startsWith("gujarati")) {
    return "gu";
  }
  return "en";
}

/**
 * @param {string} errorCode
 * @returns {ChatFailureReason}
 */
export function mapGeminiErrorToChatFailureReason(errorCode) {
  if (errorCode === GEMINI_CHAT_ERROR.PROJECT_FACTS) {
    return CHAT_FAILURE_REASON.NO_APPROVED_FACTS;
  }
  if (errorCode === GEMINI_CHAT_ERROR.VALIDATION) {
    return CHAT_FAILURE_REASON.UNKNOWN_ERROR;
  }
  if (
    errorCode === GEMINI_CHAT_ERROR.MODEL_UNAVAILABLE ||
    errorCode === GEMINI_CHAT_ERROR.API ||
    errorCode === GEMINI_CHAT_ERROR.CONFIG ||
    errorCode === GEMINI_CHAT_ERROR.EMPTY ||
    errorCode === GEMINI_CHAT_ERROR.PARSE ||
    errorCode === GEMINI_CHAT_ERROR.BLOCKED
  ) {
    return CHAT_FAILURE_REASON.MODEL_UNAVAILABLE;
  }
  return CHAT_FAILURE_REASON.UNKNOWN_ERROR;
}

/**
 * @param {import("../models/Lead.js").default|Record<string, unknown>} lead
 * @param {string} buyerText
 * @param {ChatFailureReason} reasonCode
 * @returns {string}
 */
export function buildFallbackHandoffSummary(lead, buyerText, reasonCode) {
  const prefix =
    HANDOFF_PREFIX_BY_REASON[reasonCode] ??
    HANDOFF_PREFIX_BY_REASON[CHAT_FAILURE_REASON.UNKNOWN_ERROR];

  const name = typeof lead.name === "string" ? lead.name.trim() : "";
  const project = typeof lead.project === "string" && lead.project.trim()
    ? lead.project.trim()
    : "General Inquiry";
  const budget = typeof lead.budget === "string" ? lead.budget.trim() : "";
  const status = typeof lead.status === "string" ? lead.status.trim() : "";
  const buyerSummary =
    typeof lead.buyerSummary === "string" ? lead.buyerSummary.trim() : "";

  const parts = [prefix];
  const leadBits = [];
  if (name) {
    leadBits.push(`Lead: ${name}`);
  }
  leadBits.push(`Primary project: ${project}`);
  if (budget) {
    leadBits.push(`Budget: ${budget}`);
  }
  if (status) {
    leadBits.push(`Status: ${status}`);
  }
  if (buyerSummary) {
    leadBits.push(`Summary: ${truncateForHandoff(buyerSummary, 120)}`);
  }
  if (leadBits.length > 0) {
    parts.push(leadBits.join("; "));
  }

  const buyerSnippet = truncateForHandoff(buyerText);
  if (buyerSnippet) {
    parts.push(`Latest buyer message: ${buyerSnippet}`);
  }

  return parts.join(" ");
}

/**
 * @param {import("../models/Lead.js").default|Record<string, unknown>} lead
 * @param {string} buyerText
 * @param {ChatFailureReason} reasonCode
 * @returns {import("./geminiLeadChat.js").LeadChatTurnData}
 */
export function buildFallbackChatTurnData(lead, buyerText, reasonCode) {
  return {
    reply: resolveFallbackReplyText(lead.preferredLanguage),
    preferredLanguage: null,
    qualification: null,
    buyerSummary: null,
    needsHumanHandoff: true,
    handoffReason: buildFallbackHandoffSummary(lead, buyerText, reasonCode),
    recommendQualified: false,
  };
}

/**
 * @param {string} leadId
 * @param {ChatFailureReason} reasonCode
 */
export function logGracefulChatFallback(leadId, reasonCode) {
  console.error(`leadChatGracefulFallback leadId=${leadId} reason=${reasonCode}`);
}
