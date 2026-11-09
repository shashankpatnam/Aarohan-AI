import { generateLeadChatTurn } from "./geminiLeadChat.js";
import {
  buildFallbackChatTurnData,
  CHAT_FAILURE_REASON,
  mapGeminiErrorToChatFailureReason,
} from "./leadChatGracefulFallback.js";

/** @type {typeof generateLeadChatTurn|null} */
let generateTurnTestOverride = null;

/**
 * Test-only hook for HTTP integration tests (do not use in production).
 * @param {typeof generateLeadChatTurn|null} fn
 */
export function __setGenerateLeadChatTurnForTests(fn) {
  generateTurnTestOverride = fn;
}

export function __resetGenerateLeadChatTurnForTests() {
  generateTurnTestOverride = null;
}

/**
 * @typedef {Object} ResolvedLeadChatTurn
 * @property {import("./geminiLeadChat.js").LeadChatTurnData} data
 * @property {import("./leadChatGracefulFallback.js").ChatFailureReason|null} chatFailureReason
 */

/**
 * @param {Object} params
 * @param {string|null} [params.initialProject]
 * @param {string} [params.projectName] Legacy alias used by CRM lead chat.
 * @param {string} params.latestBuyerMessage
 * @param {import("./geminiLeadChat.js").ConversationMessage[]} params.recentMessages
 * @param {import("./geminiLeadChat.js").LeadChatContext} params.leadContext
 * @param {import("../models/Lead.js").default|Record<string, unknown>} params.lead
 * @param {typeof generateLeadChatTurn} [generateTurn]
 * @returns {Promise<ResolvedLeadChatTurn>}
 */
export async function resolveLeadChatTurn(
  {
    initialProject,
    projectName,
    latestBuyerMessage,
    recentMessages,
    leadContext,
    lead,
  },
  generateTurn = generateTurnTestOverride ?? generateLeadChatTurn,
) {
  try {
    const initialProjectContext = initialProject ?? projectName ?? null;
    const geminiResult = await generateTurn({
      initialProject: initialProjectContext,
      projectName: initialProjectContext,
      latestBuyerMessage,
      recentMessages,
      leadContext,
    });

    if (geminiResult.ok) {
      return { data: geminiResult.data, chatFailureReason: null };
    }

    const chatFailureReason = mapGeminiErrorToChatFailureReason(
      geminiResult.error.code,
    );
    return {
      data: buildFallbackChatTurnData(
        lead,
        latestBuyerMessage,
        chatFailureReason,
      ),
      chatFailureReason,
    };
  } catch {
    const chatFailureReason = CHAT_FAILURE_REASON.UNKNOWN_ERROR;
    return {
      data: buildFallbackChatTurnData(
        lead,
        latestBuyerMessage,
        chatFailureReason,
      ),
      chatFailureReason,
    };
  }
}
