const STORAGE_KEY = "aarohan_guest_session";
const BOOKING_DRAFT_PREFIX = `${STORAGE_KEY}:booking:`;
const GUEST_PROJECTS = [
  "Skyline Residences",
  "Green Valley Phase 2",
  "Riverfront Heights",
  "Palm Grove Villas",
  "Orchid Park Residences",
  "Terrace Gardens",
];

/**
 * @typedef {{ sessionId: string, sessionToken: string, project: string }} StoredGuestSession
 */

/**
 * @returns {StoredGuestSession|null}
 */
export function readGuestSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.sessionId !== "string" ||
      typeof parsed?.sessionToken !== "string" ||
      typeof parsed?.project !== "string"
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      sessionToken: parsed.sessionToken,
      project: parsed.project,
    };
  } catch {
    return null;
  }
}

/**
 * @param {StoredGuestSession} session
 */
export function writeGuestSession(session) {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      project: session.project,
    }),
  );
}

export function clearGuestSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function bookingDraftKey(sessionId) {
  return `${BOOKING_DRAFT_PREFIX}${encodeURIComponent(sessionId)}`;
}

function isValidDraftDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Stores only non-sensitive booking selection fields under the owning guest session ID. */
export function writeGuestBookingDraft(sessionId, draft) {
  try {
    const allowedStates = new Set([
      "identifying_project",
      "awaiting_contact",
      "selecting_date",
      "selecting_slot",
      "reviewing_booking",
    ]);
    if (typeof sessionId !== "string" || !sessionId) return false;
    if (draft?.project != null && !GUEST_PROJECTS.includes(draft.project)) return false;
    if (draft?.state && !allowedStates.has(draft.state)) return false;
    const date = draft.date || "";
    const slot = draft.slot || "";
    if (date && !isValidDraftDate(date)) return false;
    if (slot && (!date || typeof slot !== "string" || slot.length > 16)) return false;
    sessionStorage.setItem(bookingDraftKey(sessionId), JSON.stringify({
      sessionId,
      project: draft.project ?? null,
      date,
      slot,
      state: draft.state ?? (slot ? "reviewing_booking" : date ? "selecting_slot" : draft.project ? "awaiting_contact" : "identifying_project"),
    }));
    return true;
  } catch {
    return false;
  }
}

export function readGuestBookingDraft(sessionId) {
  try {
    if (typeof sessionId !== "string" || !sessionId) return null;
    const raw = sessionStorage.getItem(bookingDraftKey(sessionId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (
      draft?.sessionId !== sessionId ||
      (draft.project !== null && !GUEST_PROJECTS.includes(draft.project)) ||
      (draft.date !== "" && !isValidDraftDate(draft.date)) ||
      (draft.slot !== "" && (typeof draft.slot !== "string" || draft.slot.length > 16)) ||
      (draft.slot && !draft.date) ||
      (draft.state && !["identifying_project", "awaiting_contact", "selecting_date", "selecting_slot", "reviewing_booking"].includes(draft.state))
    ) return null;
    const state = draft.state ?? (draft.slot ? "reviewing_booking" : draft.date ? "selecting_slot" : "awaiting_contact");
    return { sessionId, project: draft.project, date: draft.date, slot: draft.slot, state };
  } catch {
    return null;
  }
}

export function clearGuestBookingDraft(sessionId) {
  try {
    if (typeof sessionId === "string" && sessionId) sessionStorage.removeItem(bookingDraftKey(sessionId));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}
