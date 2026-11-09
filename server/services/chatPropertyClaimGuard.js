import {
  hasApprovedAmenities,
  hasApprovedInventoryInformation,
  hasApprovedLocation,
  hasApprovedPossessionTimeline,
  hasApprovedPriceInformation,
  hasApprovedPropertyConfigurations,
  hasApprovedReraInformation,
} from "../config/projectFacts.js";

/** @typedef {'price'|'inventory'|'amenities'|'possession'|'rera'|'configurations'|'location'} ClaimCategory */

export const CLAIM_CATEGORY_LABELS = {
  price: "pricing",
  inventory: "unit availability",
  amenities: "amenities",
  possession: "possession or completion timeline",
  configurations: "property configurations",
  location: "project location",
  rera: "RERA information",
};

function portfolioEntries(facts) {
  if (!Array.isArray(facts?.projects)) {
    return null;
  }
  return facts.projects.map((entry) => ({
    projectName: entry?.projectName,
    facts: entry?.facts ?? null,
  }));
}

function isClaimCategoryApprovedForReply(categoryCheck, reply, facts) {
  const entries = portfolioEntries(facts);
  if (!entries) {
    return categoryCheck.isApproved(facts);
  }

  const lowerReply = reply.toLowerCase();
  const mentioned = entries.filter(
    ({ projectName }) =>
      typeof projectName === "string" &&
      lowerReply.includes(projectName.toLowerCase()),
  );
  const scopedEntries = mentioned.length > 0 ? mentioned : entries;

  return (
    scopedEntries.length > 0 &&
    scopedEntries.every(
      ({ facts: projectFacts }) =>
        projectFacts && categoryCheck.isApproved(projectFacts),
    )
  );
}

const CATEGORY_CHECKS = [
  {
    category: "price",
    isApproved: hasApprovedPriceInformation,
    patterns: [
      /(?:₹|rs\.?\s*|inr\s*)[\d,./]+/i,
      /\b[\d,./]+\s*(?:lakh|lac|crore|cr)\b/i,
      /\bstarting (?:from|at|price)\b/i,
      /\b(?:price|priced|pricing|costs?)\s+(?:is|are|at|from|around|approximately)\b/i,
      /(?:per|\/)\s*sq\.?\s*ft\b/i,
      /\b(?:emi|down payment)\b/i,
    ],
  },
  {
    category: "inventory",
    isApproved: hasApprovedInventoryInformation,
    patterns: [
      /\b(?:units?\s+(?:available|left|remaining)|inventory|in stock|sold out)\b/i,
      /\b(?:limited|few)\s+units\b/i,
      /\b(?:available|remaining)\s+units\b/i,
    ],
  },
  {
    category: "amenities",
    isApproved: hasApprovedAmenities,
    patterns: [
      /\bamenities include\b/i,
      /\bfeatures include\b/i,
      /\b(?:swimming pool|clubhouse|gymnasium|jogging track|landscaped gardens)\b/i,
      /\bwe offer (?:a )?(?:pool|gym|clubhouse)\b/i,
    ],
  },
  {
    category: "possession",
    isApproved: hasApprovedPossessionTimeline,
    patterns: [
      /\b(?:possession|handover|ready to move|completion)\b[^?.!]{0,80}\b(?:\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
      /\b(?:possession|handover)\s+(?:in|by|from|on|expected)\s+/i,
    ],
  },
  {
    category: "rera",
    isApproved: hasApprovedReraInformation,
    patterns: [
      /\brera\s*(?:no|number|#|registration)?\b/i,
      /\b(?:registration|reg\.)\s*(?:no|number)\b/i,
    ],
  },
  {
    category: "configurations",
    isApproved: hasApprovedPropertyConfigurations,
    patterns: [
      /\b(?:we|project|homes?|units|property)\s+(?:offer|have|include|available)[^.?!]{0,50}\b\d\s*bhk\b/i,
      /\b\d\s*bhk\s+(?:units|available|options|configurations)\b/i,
      /\b(?:available in|comes in)\s+\d\s*bhk\b/i,
    ],
  },
  {
    category: "location",
    isApproved: hasApprovedLocation,
    patterns: [
      /\b(?:located|situated)\s+(?:in|at|near)\s+[^?.!]+/i,
      /\b(?:project|property|site)\s+(?:is\s+)?(?:in|at|near)\s+[^?.!]+/i,
      /\baddress\s*(?:is|:)\s*/i,
    ],
  },
];

/**
 * Heuristic detection of property-specific claims in assistant reply text.
 * Not a complete factuality checker — pattern-based and English-oriented.
 *
 * @param {string} reply
 * @param {import("../config/projectFacts.js").ApprovedProjectFacts} approvedFacts
 * @returns {ClaimCategory[]}
 */
export function detectUnsupportedClaimCategories(reply, approvedFacts) {
  if (typeof reply !== "string" || !reply.trim() || !approvedFacts) {
    return [];
  }

  const text = reply.trim();
  const violations = [];

  for (const { category, isApproved, patterns } of CATEGORY_CHECKS) {
    if (
      isClaimCategoryApprovedForReply({ isApproved }, text, approvedFacts)
    ) {
      continue;
    }

    const matched = patterns.some((pattern) => pattern.test(text));
    if (matched) {
      violations.push(category);
    }
  }

  return violations;
}

/**
 * @param {string} projectName
 * @param {ClaimCategory[]} categories
 */
export function buildSafeFallbackReply(projectName, categories) {
  const unique = [...new Set(categories)];
  const labels = unique
    .map((key) => CLAIM_CATEGORY_LABELS[key] ?? key)
    .join(", ");
  const project =
    typeof projectName === "string" && projectName.trim()
      ? projectName.trim()
      : "the Aarohan property portfolio";

  return (
    `I don't have verified ${labels} details for ${project} in our approved project records yet. ` +
    "A member of our sales team can confirm this information with you."
  );
}

/**
 * @param {ClaimCategory[]} categories
 */
export function buildSafeguardHandoffReason(categories) {
  const unique = [...new Set(categories)];
  const labels = unique
    .map((key) => CLAIM_CATEGORY_LABELS[key] ?? key)
    .join(", ");
  return `Verified project details are not available for ${labels}; a sales executive should follow up.`;
}

/**
 * Replaces risky reply text when unsupported property claims are detected.
 * Preserves qualification and other turn fields.
 *
 * @param {import("./geminiLeadChat.js").LeadChatTurnData} turnData
 * @param {import("../config/projectFacts.js").ApprovedProjectFacts} approvedFacts
 * @param {string} projectName
 * @returns {import("./geminiLeadChat.js").LeadChatTurnData}
 */
export function applyPropertyClaimSafeguard(turnData, approvedFacts, projectName) {
  const violations = detectUnsupportedClaimCategories(
    turnData.reply,
    approvedFacts,
  );

  if (violations.length === 0) {
    return turnData;
  }

  const handoffReason = buildSafeguardHandoffReason(violations);
  const mentionedProjects =
    portfolioEntries(approvedFacts)?.filter(
      ({ projectName: candidate }) =>
        typeof candidate === "string" &&
        turnData.reply.toLowerCase().includes(candidate.toLowerCase()),
    ) ?? [];
  const fallbackScope =
    mentionedProjects.length > 0
      ? mentionedProjects.map(({ projectName: candidate }) => candidate).join(" and ")
      : projectName;

  return {
    ...turnData,
    reply: buildSafeFallbackReply(fallbackScope, violations),
    needsHumanHandoff: true,
    handoffReason,
  };
}
