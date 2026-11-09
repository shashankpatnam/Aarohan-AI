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
];

/** Buyer-authored request classifier; booking-specific follow-ups use the live calendar instead of Gemini. */
export function isGuestSiteVisitBookingIntent(text) {
  if (typeof text !== "string") return false;
  if (AVAILABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (BOOKING_RESUME_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (INFORMATIONAL_PREFIX.test(text)) return false;
  return BOOKING_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasExplicitBuyerInterestLanguage(text) {
  return typeof text === "string" && (/\b(?:interested in|would like to consider|want to consider|considering|prefer|preference|first choice|first preference|my choice|choose|chosen)\b/i.test(text) || /\bi(?: really)? like\b/i.test(text));
}

