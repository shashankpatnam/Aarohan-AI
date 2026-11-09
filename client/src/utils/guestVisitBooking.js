import { GUEST_PROJECTS } from "../constants/projects.js";

const INFORMATIONAL_PREFIX = /^\s*(?:how|what|when|where|why|do you|does|is there|can you explain|tell me about)\b/i;
const AVAILABILITY_QUESTION_PATTERNS = [
  /\b(?:which|what)\s+(?:dates?|days?|time\s+slots?|slots?)\b.{0,32}\bavailable\b/i,
  /\b(?:are there|do you have)\s+(?:any\s+)?(?:available\s+)?(?:dates?|days?|time\s+slots?|slots?)\b/i,
  /\bshow\s+(?:me\s+)?(?:the\s+)?available\s+(?:dates?|slots?)\b/i,
];
const BOOKING_RESUME_PATTERNS = [
  /\bwhere\s+do\s+i\s+(?:enter|share|put)\s+my\s+details\b/i,
  /\bhow\s+do\s+i\s+share\s+my\s+details\b/i,
  /\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:contact|booking)\s+form\b/i,
  /\bi\s+want\s+to\s+continue\s+(?:the\s+)?booking\b/i,
];
const BOOKING_PATTERNS = [
  /\b(?:book|reserve)\s+(?:(?:a|the|my)\s+)?(?:(?:site\s+)?visit|slot|time|appointment)\b/i,
  /\b(?:schedule|arrange)\b.{0,28}\b(?:site\s+)?visit\b/i,
  /\b(?:can|could|may)\s+i\s+(?:please\s+)?(?:book|schedule|reserve)\b/i,
  /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:book|schedule|arrange|reserve)\b/i,
  /\b(?:i want to|i(?:'d| would) like to)\s+(?:book|schedule|arrange|reserve)\b/i,
  /\b(?:i want to|i(?:'d| would) like to)\s+(?:go\s+and\s+)?(?:visit|see|tour)\b/i,
  /\b(?:i want to|i(?:'d| would) like to)\s+(?:have|arrange)\s+(?:a\s+)?(?:site\s+)?visit\b/i,
  /\b(?:can|could|may)\s+i\s+(?:come\s+and\s+)?(?:visit|see|tour)\b/i,
  /\b(?:can|could|may)\s+i\s+visit\b.{0,32}\b(?:this\s+)?(?:weekend|saturday|sunday|tomorrow|today)\b/i,
];
const REJECTION_PREFIX = /\b(?:not interested in|not keen on|don't like|do not like|don't want|do not want|not for me|not my preference|avoid|reject|dislike|rather than|would not choose|wouldn't choose)\b[^.!?]{0,48}$/i;
const REJECTION_SUFFIX = /^(?:[^.!?]{0,48}\b(?:is not for me|isn't for me|is not my preference|isn't my preference|not interested|I don't want|I do not want|I dislike|I reject)\b)/i;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isSiteVisitIntent(text, from = "buyer") {
  if (from !== "buyer" || typeof text !== "string") return false;
  if (AVAILABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (BOOKING_RESUME_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (INFORMATIONAL_PREFIX.test(text)) return false;
  return BOOKING_PATTERNS.some((pattern) => pattern.test(text));
}

export function isSiteVisitAvailabilityQuestion(text) {
  return typeof text === "string" && AVAILABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isBookingResumeRequest(text) {
  return typeof text === "string" && BOOKING_RESUME_PATTERNS.some((pattern) => pattern.test(text));
}

export function asksToVisitAnotherProject(text) {
  return typeof text === "string" && /\b(?:another|different|other)\s+(?:project|community)\b/i.test(text);
}

export function projectsMentioned(text) {
  if (typeof text !== "string") return [];
  return GUEST_PROJECTS.filter((project) => new RegExp(escapeRegex(project), "i").test(text));
}

function buyerMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter((message) => message?.from === "buyer" && typeof message.text === "string");
}

function isRejectedInText(text, project) {
  const matcher = new RegExp(escapeRegex(project), "ig");
  for (const match of text.matchAll(matcher)) {
    const before = text.slice(Math.max(0, match.index - 56), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 56);
    if (REJECTION_PREFIX.test(before) || REJECTION_SUFFIX.test(after)) return true;
  }
  return false;
}

function rejectedProjects(messages, requestText) {
  const texts = [...buyerMessages(messages).map((message) => message.text), requestText];
  return new Set(GUEST_PROJECTS.filter((project) => texts.some((text) => isRejectedInText(text, project))));
}

function explicitlyRequestedProjects(requestText) {
  const clauses = requestText.split(/(?<=[.!?;])\s+/);
  const projects = new Set();
  for (const clause of clauses) {
    if (!isSiteVisitIntent(clause)) continue;
    for (const project of projectsMentioned(clause)) {
      if (!isRejectedInText(clause, project)) projects.add(project);
    }
  }
  return [...projects];
}

export function resolveVisitProject(messages, requestText = "", confirmedInterests = []) {
  if (asksToVisitAnotherProject(requestText) && isSiteVisitIntent(requestText)) {
    return { project: null, needsClarification: true, candidates: [], source: "another_project" };
  }
  const rejected = rejectedProjects(messages, requestText);
  const requested = explicitlyRequestedProjects(requestText);
  if (requested.length === 1) {
    return { project: requested[0], needsClarification: false, candidates: requested, source: "visit_request" };
  }
  if (requested.length > 1) {
    return { project: null, needsClarification: true, candidates: requested, source: "visit_request" };
  }

  const activeInterests = new Set(
    (Array.isArray(confirmedInterests) ? confirmedInterests : [])
      .filter((project) => GUEST_PROJECTS.includes(project) && !rejected.has(project)),
  );
  if (activeInterests.size === 1) {
    return { project: [...activeInterests][0], needsClarification: false, candidates: [...activeInterests], source: "confirmed_interest" };
  }
  if (activeInterests.size > 1) {
    return { project: null, needsClarification: true, candidates: [...activeInterests], source: "multiple_confirmed_interests" };
  }
  return { project: null, needsClarification: false, candidates: [], source: "no_confirmed_project" };
}

function indiaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
}

export function getIndiaTodayIso(date = new Date()) {
  const parts = indiaParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getIndiaCurrentMonth(date = new Date()) {
  return getIndiaTodayIso(date).slice(0, 7);
}

export function getMillisecondsUntilNextIndiaMidnight(now = Date.now()) {
  const nextDate = new Date(`${getIndiaTodayIso(new Date(now))}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextMidnightIst = nextDate.getTime() - (5 * 60 + 30) * 60_000;
  return Math.max(0, nextMidnightIst - now);
}

export function getMonthAvailabilityRange(month, todayIso = getIndiaTodayIso()) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { from: firstDay < todayIso ? todayIso : firstDay, to: lastDay };
}

export function getMonthCalendarCells(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells = Array(firstWeekday).fill(null);
  for (let day = 1; day <= dayCount; day += 1) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatVisitDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatMonthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1, 12)));
}

export function revalidateBookingDraft(draft, availability) {
  if (!draft?.project || !draft?.date) {
    return { valid: false, date: draft?.date ?? "", slot: "", message: "Select an available time slot." };
  }
  const availableSlots = availability?.[draft.date] ?? [];
  if (!draft.slot && availableSlots.length > 0) {
    return { valid: false, date: draft.date, slot: "", message: "" };
  }
  if (availableSlots.includes(draft.slot)) return { valid: true, date: draft.date, slot: draft.slot, message: "" };
  if (availableSlots.length > 0) {
    return { valid: false, date: draft.date, slot: "", message: "That saved time is no longer available. Please choose another slot." };
  }
  return { valid: false, date: "", slot: "", message: "That saved date is no longer available. Please choose another date." };
}
