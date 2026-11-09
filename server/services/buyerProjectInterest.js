import { LEAD_PROJECTS } from "../models/Lead.js";

function projectsMentioned(text) {
  const lower = text.toLocaleLowerCase();
  return LEAD_PROJECTS.filter((project) =>
    lower.includes(project.toLocaleLowerCase()),
  );
}

function isClearInterest(text) {
  if (/\b(not interested|not prefer|don't prefer|do not prefer|don't like|do not like|not my choice|no interest)\b/i.test(text)) return false;
  return /\b(interested in|would like to consider|want to consider|considering|prefer|preference|first choice|first preference|my choice|choose|chosen)\b/i.test(text) || /\bi(?: really)? like\b/i.test(text);
}

function isExplicitDisinterest(text) {
  return /\b(not interested|not prefer|don't prefer|do not prefer|don't like|do not like|not my choice|no interest)\b/i.test(text);
}

function isClearPrimary(text) {
  return /\b(first preference|first choice|prefer|preferred|primary choice|main choice)\b/i.test(text);
}

function isConfirmation(text) {
  return /^\s*(yes|yeah|yep|correct|that's right|that is right|please do|confirm|confirmed|i confirm)\b/i.test(text);
}

function isRejection(text) {
  return /^\s*(no|nope|not really|don't|do not|incorrect)\b/i.test(text);
}

/** Determine explicit interest from this buyer-authored message only. */
export function detectBuyerProjectInterest(text, pending = {}) {
  if (typeof text !== "string") return { projects: [], primaryProject: null, type: null, ambiguous: [] };
  const found = projectsMentioned(text);
  if (found.length && isExplicitDisinterest(text)) {
    return { projects: [], primaryProject: null, type: null, ambiguous: [], clearPending: true };
  }
  const explicit = isClearInterest(text);
  const primary = isClearPrimary(text) ? found[0] ?? null : null;
  if (found.length && explicit) {
    return { projects: found, primaryProject: primary, type: "explicit_buyer_statement", ambiguous: [] };
  }
  if ((pending.projects?.length || pending.primaryProject) && isConfirmation(text)) {
    const projects = [...new Set([...(pending.projects ?? []), ...(pending.primaryProject ? [pending.primaryProject] : [])])]
      .filter((project) => LEAD_PROJECTS.includes(project));
    return { projects, primaryProject: pending.primaryProject ?? null, type: "buyer_confirmation", ambiguous: [] };
  }
  if ((pending.projects?.length || pending.primaryProject) && isRejection(text)) {
    return { projects: [], primaryProject: null, type: null, ambiguous: [], clearPending: true };
  }
  if (found.length) return { projects: [], primaryProject: null, type: null, ambiguous: found };
  return { projects: [], primaryProject: null, type: null, ambiguous: [] };
}

