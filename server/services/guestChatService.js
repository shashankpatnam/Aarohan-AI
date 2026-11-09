import {
  logGracefulChatFallback,
} from "./leadChatGracefulFallback.js";
import { syncGuestChatTurnToLeadSafely } from "./guestChatLeadSync.js";
import { detectBuyerProjectInterest } from "./buyerProjectInterest.js";
import { resolveLeadChatTurn } from "./leadChatTurnResolver.js";
import {
  hasExplicitBuyerInterestLanguage,
  isGuestSiteVisitBookingIntent,
} from "./guestSiteVisitIntent.js";
import {
  buildGuestContextForGemini,
  buildGuestFallbackAdapter,
  buildRecentMessagesForGemini,
  formatChatMessageTime,
} from "./leadChatShared.js";

function applyQualificationUpdates(session, updates) {
  if (!updates || typeof updates !== "object") {
    return;
  }

  if (!session.qualification) {
    session.qualification = {};
  }

  if (updates.buyingTimeline) {
    session.qualification.buyingTimeline = updates.buyingTimeline;
  }
  if (updates.budgetFit) {
    session.qualification.budgetFit = updates.budgetFit;
  }
  if (updates.locationPreference) {
    session.qualification.locationPreference = updates.locationPreference;
  }
  if (typeof updates.score === "number" && Number.isFinite(updates.score)) {
    session.qualification.score = updates.score;
  }
}

/**
 * Guest-safe handoff flag (not CRM handoffStatus on Lead).
 */
function applyGuestHandoffFromChat(session, needsHumanHandoff, handoffReason, now) {
  if (needsHumanHandoff !== true) {
    return;
  }

  const reason =
    typeof handoffReason === "string" && handoffReason.trim()
      ? handoffReason.trim()
      : "Human follow-up recommended";

  if (session.needsHumanHandoff === true) {
    session.handoffReason = reason;
    return;
  }

  session.needsHumanHandoff = true;
  session.handoffReason = reason;
  session.handoffRequestedAt = now;
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @param {string} buyerText
 * @returns {Promise<{
 *   messages: Array<{ id: string, from: string, text: string, time: string, at: string|null }>,
 *   needsHumanHandoff: boolean,
 * }>}
 */
export async function processGuestSessionChat(session, buyerText) {
  const bookingIntent = isGuestSiteVisitBookingIntent(buyerText);
  const resolvedTurn = await resolveLeadChatTurn({
    initialProject: session.initialProject ?? session.project,
    latestBuyerMessage: buyerText,
    recentMessages: buildRecentMessagesForGemini(session.messages),
    leadContext: buildGuestContextForGemini(session),
    lead: buildGuestFallbackAdapter(session),
  });

  if (resolvedTurn?.chatFailureReason) {
    logGracefulChatFallback(
      session._id.toString(),
      resolvedTurn.chatFailureReason,
    );
  }

  const {
    reply: generatedReply,
    preferredLanguage,
    qualification,
    buyerSummary,
    needsHumanHandoff,
    handoffReason,
  } = resolvedTurn?.data ?? {};

  const now = new Date();
  const previousPending = session.pendingInterestConfirmation?.toObject?.() ?? session.pendingInterestConfirmation ?? {};
  const skipVisitOnlyInterestDetection = bookingIntent && !hasExplicitBuyerInterestLanguage(buyerText);
  const detection = skipVisitOnlyInterestDetection
    ? { projects: [], primaryProject: null, type: null, ambiguous: [], skipPendingUpdate: true }
    : detectBuyerProjectInterest(buyerText, previousPending);
  let reply = generatedReply ?? "";
  if (!detection.skipPendingUpdate) {
    if (detection.ambiguous.length) {
      session.pendingInterestConfirmation = { projects: detection.ambiguous, primaryProject: null };
      reply = `Are you saying you are interested in ${detection.ambiguous.join(" and ")}? Please confirm.`;
    } else if (detection.clearPending) {
      session.pendingInterestConfirmation = { projects: [], primaryProject: null };
    } else if (detection.projects.length) {
      session.pendingInterestConfirmation = { projects: [], primaryProject: null };
    }
  }
  const previousMessageCount = Array.isArray(session.messages)
    ? session.messages.length
    : 0;

  session.messages.push({
    from: "buyer",
    text: buyerText,
    time: formatChatMessageTime(now),
    at: now,
  });
  if (reply) {
    session.messages.push({
      from: "ai",
      text: reply,
      time: formatChatMessageTime(now),
      at: now,
    });
  }
  const buyerMessage = session.messages[previousMessageCount];
  for (const project of detection.projects) {
    if (!session.interestedProjects.includes(project)) session.interestedProjects.push(project);
    const sourceBuyerMessageId = buyerMessage?._id;
    const exists = sourceBuyerMessageId && session.interestEvidence.some((entry) =>
      entry.project === project && String(entry.sourceBuyerMessageId) === String(sourceBuyerMessageId));
    if (!exists) session.interestEvidence.push({
      project,
      sourceBuyerMessageId,
      type: detection.type,
      recordedAt: now,
    });
  }
  if (!detection.skipPendingUpdate && detection.primaryProject && detection.projects.includes(detection.primaryProject)) {
    session.project = detection.primaryProject;
  }

  applyGuestHandoffFromChat(session, needsHumanHandoff, handoffReason, now);
  applyQualificationUpdates(session, qualification);

  if (buyerSummary) {
    session.buyerSummary = buyerSummary;
  }
  if (preferredLanguage) {
    session.preferredLanguage = preferredLanguage;
  }

  session.lastActivityAt = now;
  await session.save();

  const newMessages = session.messages.slice(previousMessageCount);
  await syncGuestChatTurnToLeadSafely(session, newMessages, now);

  return {
    messages: serializeGuestMessages(session.messages),
    needsHumanHandoff: session.needsHumanHandoff === true,
  };
}

/**
 * @param {Array<{ _id?: unknown, from: string, text: string, time?: string, at?: Date|null }>} messages
 */
export function serializeGuestMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((msg) => ({
    id: msg._id ? msg._id.toString() : undefined,
    from: msg.from,
    text: msg.text,
    time: msg.time ?? "",
    at: msg.at ? new Date(msg.at).toISOString() : null,
  }));
}
