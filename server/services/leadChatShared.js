export const CHAT_MAX_MESSAGE_LENGTH = 4000;
export const CHAT_RECENT_MESSAGE_LIMIT = 24;

/**
 * @param {Record<string, unknown>} body
 * @returns {{ errors?: string[], data?: { message: string } }}
 */
export function validateChatMessageBody(body) {
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const errors = [];

  if (!message) {
    errors.push("message is required");
  } else if (message.length > CHAT_MAX_MESSAGE_LENGTH) {
    errors.push(
      `message must be at most ${CHAT_MAX_MESSAGE_LENGTH} characters`,
    );
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { data: { message } };
}

/**
 * @param {Date} date
 * @returns {string}
 */
export function formatChatMessageTime(date) {
  return date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * @param {Array<{ from?: string, text?: string }>|undefined} messages
 * @returns {import("./geminiLeadChat.js").ConversationMessage[]}
 */
export function buildRecentMessagesForGemini(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .slice(-CHAT_RECENT_MESSAGE_LIMIT)
    .map((msg) => ({
      from: msg.from,
      text: typeof msg.text === "string" ? msg.text : "",
    }))
    .filter(
      (msg) =>
        (msg.from === "buyer" || msg.from === "ai") &&
        msg.text.trim().length > 0,
    );
}

/**
 * @param {import("../models/Lead.js").default} lead
 * @returns {import("./geminiLeadChat.js").LeadChatContext}
 */
export function buildLeadContextForGemini(lead) {
  return {
    primaryProject: lead.project ?? null,
    initialProject: lead.initialProject ?? null,
    interestedProjects: Array.isArray(lead.interestedProjects) ? [...lead.interestedProjects] : [],
    name: lead.name,
    budget: lead.budget,
    preferredConfiguration: lead.preferredConfiguration,
    preferredLanguage: lead.preferredLanguage,
    status: lead.status,
    buyerSummary: lead.buyerSummary,
    qualification: lead.qualification
      ? {
          buyingTimeline: lead.qualification.buyingTimeline,
          budgetFit: lead.qualification.budgetFit,
          locationPreference: lead.qualification.locationPreference,
          score: lead.qualification.score,
        }
      : {},
  };
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @returns {import("./geminiLeadChat.js").LeadChatContext}
 */
export function buildGuestContextForGemini(session) {
  return {
    name: "",
    budget: "",
    preferredConfiguration: "",
    preferredLanguage: session.preferredLanguage ?? "",
    status: "Guest",
    buyerSummary: session.buyerSummary ?? "",
    qualification: session.qualification
      ? {
          buyingTimeline: session.qualification.buyingTimeline,
          budgetFit: session.qualification.budgetFit,
          locationPreference: session.qualification.locationPreference,
          score: session.qualification.score,
        }
      : {},
  };
}

/**
 * Plain object for graceful fallback handoff summaries (not a persisted Lead).
 * @param {import("../models/GuestSession.js").default} session
 * @returns {Record<string, unknown>}
 */
export function buildGuestFallbackAdapter(session) {
  return {
    name: "",
    project: session.project,
    budget: "",
    status: "Guest",
    buyerSummary: session.buyerSummary ?? "",
    preferredLanguage: session.preferredLanguage ?? "",
  };
}
