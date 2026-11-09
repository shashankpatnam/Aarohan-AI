import { serializeGuestMessages } from "./guestChatService.js";
import { LEAD_PROJECTS } from "../models/Lead.js";

/**
 * Explicit public guest session DTO. Does not spread Mongoose documents.
 * @param {import("../models/GuestSession.js").default} session
 * @param {{
 *   includeCallbackState?: boolean,
 *   includeContactSummary?: boolean,
 *   callbackRequested?: boolean,
 *   callbackPending?: boolean,
 *   contactName?: string|null,
 *   hasPhone?: boolean,
 * }} [options]
 */
export function serializeGuestSessionPublic(session, options = {}) {
  const doc = session.toObject ? session.toObject() : session;

  const payload = {
    id: String(doc._id),
    project: doc.project ?? doc.initialProject ?? null,
    contactCaptured: doc.contactCaptured === true,
    interestedProjects: Array.isArray(doc.interestedProjects)
      ? doc.interestedProjects.filter((project) => LEAD_PROJECTS.includes(project))
      : [],
    needsHumanHandoff: doc.needsHumanHandoff === true,
    messages: serializeGuestMessages(doc.messages ?? []),
    expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
    lastActivityAt: doc.lastActivityAt
      ? new Date(doc.lastActivityAt).toISOString()
      : null,
  };

  if (options.includeCallbackState) {
    payload.callbackRequested = options.callbackRequested === true;
    payload.callbackPending = options.callbackPending === true;
  }

  if (options.includeContactSummary) {
    payload.contactName = options.contactName ?? null;
    payload.hasPhone = options.hasPhone === true;
  }

  return payload;
}
