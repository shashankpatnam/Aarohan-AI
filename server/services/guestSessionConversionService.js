import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import GuestSession from "../models/GuestSession.js";
import { applyHandoffFromChat } from "./leadHandoffService.js";
import { mongoSupportsTransactions } from "../utils/mongoTransactions.js";

/** Public guest enquiries — must be a LEAD_SOURCES enum value. */
export const GUEST_LEAD_SOURCE = "Website";

const LEAD_PHONE_WHEN_EMAIL_ONLY = "Not provided";

function formatTimelineDisplayTime(date) {
  return date.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * @param {import("../models/GuestSession.js").default["messages"]} guestMessages
 */
function copyMessagesForLead(guestMessages) {
  if (!Array.isArray(guestMessages)) {
    return [];
  }

  return guestMessages.map((msg) => {
    const copied = {
      from: msg.from,
      text: msg.text,
      time: msg.time ?? "",
      at: msg.at ?? null,
    };
    if (msg._id) {
      copied._id = msg._id;
    }
    return copied;
  });
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @param {{ name: string, phone: string, email: string }} contact
 */
function buildLeadPayloadFromGuestSession(session, contact) {
  const now = new Date();
  const phoneForLead =
    contact.phone.length > 0 ? contact.phone : LEAD_PHONE_WHEN_EMAIL_ONLY;
  const hasConversation =
    Array.isArray(session.messages) && session.messages.length > 0;

  const timeline = [
    {
      kind: "created",
      title: "Lead created",
      detail: session.project
        ? `Initial project context: ${session.project}. Enquiry captured via Aarohan AI guest chat (${GUEST_LEAD_SOURCE}).`
        : `General Inquiry captured via Aarohan AI guest chat (${GUEST_LEAD_SOURCE}).`,
      time: formatTimelineDisplayTime(now),
      at: now,
    },
    {
      kind: "ai",
      title: "Guest contact captured",
      detail: session.project
        ? `Buyer shared contact details after an AI guest session that began with ${session.project}.`
        : "Buyer shared contact details for a General Inquiry after an AI guest session.",
      time: formatTimelineDisplayTime(now),
      at: now,
    },
  ];

  const qualification = session.qualification
    ? {
        buyingTimeline: session.qualification.buyingTimeline ?? "",
        budgetFit: session.qualification.budgetFit ?? "",
        locationPreference: session.qualification.locationPreference ?? "",
        score:
          typeof session.qualification.score === "number"
            ? session.qualification.score
            : null,
      }
    : {};

  const leadDoc = {
    name: contact.name,
    phone: phoneForLead,
    email: contact.email ?? "",
    project: session.project ?? null,
    initialProject: session.initialProject ?? session.project ?? null,
    interestedProjects: Array.isArray(session.interestedProjects)
      ? [...session.interestedProjects]
      : [],
    interestEvidence: Array.isArray(session.interestEvidence)
      ? session.interestEvidence.map((evidence) => ({
          project: evidence.project,
          sourceBuyerMessageId: evidence.sourceBuyerMessageId,
          type: evidence.type,
          recordedAt: evidence.recordedAt,
        }))
      : [],
    source: GUEST_LEAD_SOURCE,
    status: hasConversation ? "Contacted" : "New",
    messages: copyMessagesForLead(session.messages),
    timeline,
    qualification,
    buyerSummary: session.buyerSummary ?? "",
    preferredLanguage: session.preferredLanguage ?? "",
    lastActivityAt: session.lastActivityAt ?? now,
  };

  return { leadDoc, now };
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @param {string} submittedName
 */
export function buildPublicContactConfirmation(session, submittedName) {
  const initialProject = session.initialProject ?? session.project;
  const initialContext = initialProject
    ? ` You began by exploring ${initialProject}.`
    : "";
  return {
    message: `Thank you, ${submittedName}. Our team will follow up about your Aarohan enquiry.${initialContext}`,
    project: initialProject ?? null,
    submittedName,
  };
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @param {string} submittedName
 */
export function buildConversionResult(session, submittedName) {
  return {
    contactCaptured: true,
    confirmation: buildPublicContactConfirmation(session, submittedName),
  };
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @param {{ name: string, phone: string, email: string }} contact
 */
export async function convertGuestSessionToLead(session, contact) {
  const sessionId = session._id;
  const current = await GuestSession.findById(sessionId);
  if (!current) {
    return { error: "not_found" };
  }

  if (current.contactCaptured === true && current.leadId) {
    await completeMissingLeadPhone(current.leadId, contact.phone);
    const refreshed = await GuestSession.findById(sessionId);
    return {
      alreadyConverted: true,
      session: refreshed ?? current,
      ...buildConversionResult(refreshed ?? current, contact.name),
    };
  }

  const useTransactions = await mongoSupportsTransactions();
  const result = useTransactions
    ? await convertWithTransaction(sessionId, contact)
    : await convertWithoutTransaction(sessionId, contact);
  if (result.alreadyConverted && result.session?.leadId) {
    await completeMissingLeadPhone(result.session.leadId, contact.phone);
    result.session = (await GuestSession.findById(sessionId)) ?? result.session;
  }
  return result;
}

async function completeMissingLeadPhone(leadId, phone) {
  const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
  if (!normalizedPhone) return;
  await Lead.updateOne(
    { _id: leadId, $or: [{ phone: "Not provided" }, { phone: "" }, { phone: null }] },
    { $set: { phone: normalizedPhone, lastActivityAt: new Date() } },
  );
}

async function convertWithTransaction(sessionId, contact) {
  const mongoSession = await mongoose.startSession();
  mongoSession.startTransaction();

  try {
    const locked = await GuestSession.findById(sessionId).session(mongoSession);
    if (!locked) {
      await mongoSession.abortTransaction();
      return { error: "not_found" };
    }

    if (locked.contactCaptured === true && locked.leadId) {
      await mongoSession.commitTransaction();
      return {
        alreadyConverted: true,
        session: locked,
        ...buildConversionResult(locked, contact.name),
      };
    }

    const { leadDoc, now } = buildLeadPayloadFromGuestSession(locked, contact);
    const [lead] = await Lead.create([leadDoc], { session: mongoSession });

    if (locked.needsHumanHandoff === true) {
      applyHandoffFromChat(
        lead,
        true,
        locked.handoffReason || "Human follow-up from guest chat",
        now,
      );
      await lead.save({ session: mongoSession });
    }

    locked.contactCaptured = true;
    locked.leadId = lead._id;
    locked.lastActivityAt = now;
    await locked.save({ session: mongoSession });

    await mongoSession.commitTransaction();

    return {
      alreadyConverted: false,
      session: locked,
      leadId: lead._id,
      ...buildConversionResult(locked, contact.name),
    };
  } catch (error) {
    await mongoSession.abortTransaction();
    throw error;
  } finally {
    mongoSession.endSession();
  }
}

async function convertWithoutTransaction(sessionId, contact) {
  const existing = await GuestSession.findById(sessionId);
  if (!existing) {
    return { error: "not_found" };
  }

  if (existing.contactCaptured === true && existing.leadId) {
    return {
      alreadyConverted: true,
      session: existing,
      ...buildConversionResult(existing, contact.name),
    };
  }

  const { leadDoc, now } = buildLeadPayloadFromGuestSession(existing, contact);
  const lead = await Lead.create(leadDoc);

  if (existing.needsHumanHandoff === true) {
    applyHandoffFromChat(
      lead,
      true,
      existing.handoffReason || "Human follow-up from guest chat",
      now,
    );
    await lead.save();
  }

  const updated = await GuestSession.findOneAndUpdate(
    {
      _id: sessionId,
      contactCaptured: { $ne: true },
      leadId: null,
    },
    {
      $set: {
        contactCaptured: true,
        leadId: lead._id,
        lastActivityAt: now,
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    await Lead.deleteOne({ _id: lead._id });
    const converted = await GuestSession.findById(sessionId);
    if (converted?.contactCaptured === true && converted.leadId) {
      return {
        alreadyConverted: true,
        session: converted,
        ...buildConversionResult(converted, contact.name),
      };
    }
    return { error: "conflict" };
  }

  return {
    alreadyConverted: false,
    session: updated,
    leadId: lead._id,
    ...buildConversionResult(updated, contact.name),
  };
}
