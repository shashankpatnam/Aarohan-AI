const TIMELINE_DETAIL_MAX = 280;

export function formatTimelineDisplayTime(date) {
  return date.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateTimelineDetail(text, maxLength = TIMELINE_DETAIL_MAX) {
  if (typeof text !== "string") {
    return "";
  }
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function serializeHandoffFields(doc) {
  const lead = doc.toObject ? doc.toObject() : doc;
  return {
    handoffStatus: lead.handoffStatus ?? "None",
    handoffReason: lead.handoffReason ?? "",
    handoffAiReason: lead.handoffAiReason ?? "",
    handoffType: lead.handoffType ?? "",
    handoffCallbackNote: lead.handoffCallbackNote ?? "",
    handoffPreferredContactMethod: lead.handoffPreferredContactMethod ?? "",
    handoffRequestedAt: lead.handoffRequestedAt
      ? new Date(lead.handoffRequestedAt).toISOString()
      : null,
    handoffResolvedAt: lead.handoffResolvedAt
      ? new Date(lead.handoffResolvedAt).toISOString()
      : null,
  };
}

/**
 * Persist Gemini handoff request. Skips duplicate timeline entries while Pending/Assigned.
 */
export function applyHandoffFromChat(lead, needsHumanHandoff, handoffReason, now) {
  if (needsHumanHandoff !== true) {
    return;
  }

  const reason = truncateTimelineDetail(
    handoffReason ?? "Human follow-up recommended",
  );
  const current = lead.handoffStatus ?? "None";

  if (current === "Pending" || current === "Assigned") {
    lead.handoffReason = reason;
    if (lead.handoffType !== "buyer_callback") {
      lead.handoffAiReason = reason;
    } else if (!String(lead.handoffAiReason ?? "").trim()) {
      lead.handoffAiReason = reason;
    }
    return;
  }

  lead.handoffType = "ai";
  lead.handoffStatus = "Pending";
  lead.handoffReason = reason;
  lead.handoffAiReason = reason;
  lead.handoffRequestedAt = now;
  lead.handoffResolvedAt = null;

  lead.timeline.push({
    kind: "ai",
    title: "Human handoff requested",
    detail: reason,
    time: formatTimelineDisplayTime(now),
    at: now,
  });
}

/**
 * Buyer-requested callback on a converted guest lead (distinct from AI safety handoff).
 * @param {import("../models/Lead.js").default} lead
 * @param {{ note?: string, preferredContactMethod?: string }} options
 * @param {Date} now
 * @returns {{ reusedOpenHandoff: boolean }}
 */
export function applyBuyerCallbackHandoff(lead, options, now) {
  const note =
    typeof options.note === "string" ? truncateTimelineDetail(options.note) : "";
  const method =
    typeof options.preferredContactMethod === "string"
      ? options.preferredContactMethod.trim()
      : "";
  const methodNormalized =
    method === "phone" || method === "email" ? method : "";

  const primaryProject = typeof lead.project === "string" && lead.project.trim()
    ? lead.project.trim()
    : "General Inquiry";
  const reasonParts = [`Buyer requested a callback about ${primaryProject} from the guest chat experience.`];
  if (methodNormalized) {
    reasonParts.push(`Preferred contact: ${methodNormalized}.`);
  }
  if (note) {
    reasonParts.push(`Buyer note: ${note}`);
  }

  const callbackSummary = truncateTimelineDetail(reasonParts.join(" "));
  const current = lead.handoffStatus ?? "None";
  const open = current === "Pending" || current === "Assigned";
  const alreadyCallback = lead.handoffType === "buyer_callback";

  if (
    !String(lead.handoffAiReason ?? "").trim() &&
    lead.handoffType === "ai" &&
    String(lead.handoffReason ?? "").trim()
  ) {
    lead.handoffAiReason = lead.handoffReason;
  }

  lead.handoffType = "buyer_callback";

  if (open) {
    if (!String(lead.handoffCallbackNote ?? "").trim() && note) {
      lead.handoffCallbackNote = note;
    }
    if (
      !String(lead.handoffPreferredContactMethod ?? "").trim() &&
      methodNormalized
    ) {
      lead.handoffPreferredContactMethod = methodNormalized;
    }
    if (!alreadyCallback) {
      lead.timeline.push({
        kind: "reply",
        title: "Buyer callback requested",
        detail: callbackSummary,
        time: formatTimelineDisplayTime(now),
        at: now,
      });
    }
    return { reusedOpenHandoff: true };
  }

  lead.handoffStatus = "Pending";
  lead.handoffCallbackNote = note;
  lead.handoffPreferredContactMethod = methodNormalized;
  lead.handoffReason = String(lead.handoffAiReason ?? "").trim()
    ? lead.handoffAiReason
    : callbackSummary;
  lead.handoffRequestedAt = now;
  lead.handoffResolvedAt = null;

  lead.timeline.push({
    kind: "reply",
    title: "Buyer callback requested",
    detail: callbackSummary,
    time: formatTimelineDisplayTime(now),
    at: now,
  });

  return { reusedOpenHandoff: false };
}

export function assignHandoffExecutive(lead, executive, now) {
  lead.executive = executive;
  lead.handoffStatus = "Assigned";

  lead.timeline.push({
    kind: "ai",
    title: "Handoff assigned",
    detail: `Human follow-up assigned to ${executive}.`,
    time: formatTimelineDisplayTime(now),
    at: now,
  });
}

export function resolveHandoff(lead, now) {
  lead.handoffStatus = "Resolved";
  lead.handoffResolvedAt = now;

  lead.timeline.push({
    kind: "ai",
    title: "Handoff resolved",
    detail: "Human follow-up marked as resolved by the sales team.",
    time: formatTimelineDisplayTime(now),
    at: now,
  });
}

export function syncHandoffOnExecutiveUpdate(lead, executive, now) {
  if (lead.handoffStatus !== "Pending") {
    return false;
  }

  assignHandoffExecutive(lead, executive, now);
  return true;
}
