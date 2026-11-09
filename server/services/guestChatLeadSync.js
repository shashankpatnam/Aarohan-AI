import Lead from "../models/Lead.js";

/**
 * @param {Array<{ _id?: unknown, from: string, text: string, time?: string, at?: Date|null }>} messages
 */
export function toLeadMessagePayloads(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((msg) => msg?._id && (msg.from === "buyer" || msg.from === "ai"))
    .map((msg) => ({
      _id: msg._id,
      from: msg.from,
      text: msg.text,
      time: msg.time ?? "",
      at: msg.at ?? null,
    }));
}

function messageIdList(messages) {
  return toLeadMessagePayloads(messages)
    .map((msg) => String(msg._id))
    .join(",");
}

/**
 * Append newly saved GuestSession messages onto the linked Lead.
 * Idempotent on message _id. GuestSession remains the source of truth.
 *
 * @param {import("../models/GuestSession.js").default} session
 * @param {Array<{ _id?: unknown, from: string, text: string, time?: string, at?: Date|null }>} newMessages
 * @param {Date} now
 */
export async function syncGuestMessagesToLinkedLead(session, newMessages, now) {
  if (!session?.leadId) {
    return { synced: false, reason: "no_lead" };
  }

  const incoming = toLeadMessagePayloads(newMessages);
  if (incoming.length === 0) {
    return { synced: false, reason: "no_messages" };
  }

  let appended = 0;
  for (const payload of incoming) {
    const result = await Lead.updateOne(
      { _id: session.leadId, "messages._id": { $ne: payload._id } },
      {
        $push: { messages: payload },
        $set: { lastActivityAt: now },
      },
    );
    if (result.modifiedCount > 0) {
      appended += 1;
    } else if (result.matchedCount === 0) {
      const leadExists = await Lead.exists({ _id: session.leadId });
      if (!leadExists) {
        console.error(
          `guestChatLeadSync sessionId=${session._id} messageIds=${messageIdList(incoming)} reason=lead_not_found`,
        );
        return { synced: false, reason: "lead_not_found" };
      }
    }
  }

  const summarySets = { lastActivityAt: now };
  const interestProjects = Array.isArray(session.interestedProjects)
    ? session.interestedProjects
    : [];
  for (const evidence of session.interestEvidence ?? []) {
    if (!evidence?.sourceBuyerMessageId || !interestProjects.includes(evidence.project)) continue;
    await Lead.updateOne(
      { _id: session.leadId, interestEvidence: { $not: { $elemMatch: { project: evidence.project, sourceBuyerMessageId: evidence.sourceBuyerMessageId } } } },
      { $push: { interestEvidence: evidence } },
    );
  }
  await Lead.updateOne(
    { _id: session.leadId },
    { $addToSet: { interestedProjects: { $each: interestProjects } } },
  );
  const summary =
    typeof session.buyerSummary === "string" ? session.buyerSummary.trim() : "";
  if (summary) {
    summarySets.buyerSummary = summary;
  }
  await Lead.updateOne({ _id: session.leadId }, { $set: { ...summarySets, project: session.project ?? null } });

  return { synced: appended > 0, appended };
}

let syncImplementation = syncGuestMessagesToLinkedLead;

export function __setSyncGuestMessagesToLinkedLeadForTests(fn) {
  syncImplementation =
    typeof fn === "function" ? fn : syncGuestMessagesToLinkedLead;
}

export function __resetSyncGuestMessagesToLinkedLeadForTests() {
  syncImplementation = syncGuestMessagesToLinkedLead;
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @param {Array<{ _id?: unknown, from: string, text: string, time?: string, at?: Date|null }>} newMessages
 * @param {Date} now
 */
export async function syncGuestChatTurnToLeadSafely(session, newMessages, now) {
  if (!session?.leadId) {
    return;
  }

  try {
    await syncImplementation(session, newMessages, now);
  } catch (error) {
    const ids = messageIdList(newMessages);
    console.error(
      `guestChatLeadSync sessionId=${session._id} messageIds=${ids} error=${error?.message ?? "unknown"}`,
    );
  }
}
