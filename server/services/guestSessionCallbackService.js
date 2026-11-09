import Lead from "../models/Lead.js";
import GuestSession from "../models/GuestSession.js";
import { applyBuyerCallbackHandoff } from "./leadHandoffService.js";
import { serializeGuestSessionPublic } from "./guestSessionSerializer.js";

/**
 * @param {import("../models/GuestSession.js").default} session
 */
export async function buildGuestSessionPublicDto(session) {
  const doc = session.toObject ? session.toObject() : session;
  let callbackPending = false;
  let contactName = null;
  let hasPhone = false;

  if (doc.leadId) {
    const lead = await Lead.findById(doc.leadId).select("name phone handoffStatus handoffType");
    contactName = lead?.name ?? null;
    hasPhone = Boolean(lead?.phone?.trim() && lead.phone !== "Not provided");
    callbackPending =
      Boolean(lead) &&
      (lead.handoffStatus === "Pending" || lead.handoffStatus === "Assigned") &&
      lead.handoffType === "buyer_callback";
  }

  return serializeGuestSessionPublic(session, {
    includeCallbackState: true,
    callbackRequested: Boolean(doc.callbackRequestedAt),
    callbackPending,
    includeContactSummary: true,
    contactName,
    hasPhone,
  });
}

export function buildPublicCallbackConfirmation(project) {
  const subject = `for ${project ?? "General Inquiry"}`;
  return {
    message: `Your callback request ${subject} has been received. Our sales team will contact you soon.`,
  };
}

/**
 * @param {import("../models/GuestSession.js").default} session
 * @param {{ note: string, preferredContactMethod: string }} callbackInput
 */
export async function requestGuestSessionCallback(session, callbackInput) {
  const fresh = await GuestSession.findById(session._id);
  if (!fresh) {
    return { error: "not_found" };
  }

  if (fresh.contactCaptured !== true || !fresh.leadId) {
    return { error: "contact_required" };
  }

  const lead = await Lead.findById(fresh.leadId);
  if (!lead) {
    return { error: "lead_missing" };
  }

  const now = new Date();
  const handoffResult = applyBuyerCallbackHandoff(lead, callbackInput, now);
  lead.lastActivityAt = now;
  await lead.save();

  fresh.callbackRequestedAt = fresh.callbackRequestedAt ?? now;
  fresh.lastActivityAt = now;
  await fresh.save();

  const sessionDto = await buildGuestSessionPublicDto(fresh);

  return {
    alreadyRequested: handoffResult.reusedOpenHandoff,
    confirmation: buildPublicCallbackConfirmation(fresh.project),
    session: sessionDto,
  };
}
