import {
  hasApprovedAmenities,
  hasApprovedInventoryInformation,
  hasApprovedLocation,
  hasApprovedPossessionTimeline,
  hasApprovedPriceInformation,
  hasApprovedPropertyConfigurations,
  hasApprovedReraInformation,
} from "../config/projectFacts.js";
import {
  buildSafeFallbackReply,
  buildSafeguardHandoffReason,
} from "./chatPropertyClaimGuard.js";

/** @typedef {import("./chatPropertyClaimGuard.js").ClaimCategory} FactCategory */

/**
 * @param {FactCategory} category
 * @param {import("../config/projectFacts.js").ApprovedProjectFacts} facts
 * @returns {boolean}
 */
export function isFactCategoryApproved(category, facts) {
  switch (category) {
    case "price":
      return hasApprovedPriceInformation(facts);
    case "inventory":
      return hasApprovedInventoryInformation(facts);
    case "configurations":
      return hasApprovedPropertyConfigurations(facts);
    case "location":
      return hasApprovedLocation(facts);
    case "amenities":
      return hasApprovedAmenities(facts);
    case "possession":
      return hasApprovedPossessionTimeline(facts);
    case "rera":
      return hasApprovedReraInformation(facts);
    default:
      return true;
  }
}

/**
 * @param {string} message
 * @returns {boolean}
 */
export function isBareGreetingOrSmallTalk(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    return false;
  }
  return (
    /^(?:hi|hello|hey|good morning|good afternoon|good evening|namaste|thanks|thank you)(?:[!.\s]|$)/i.test(
      text,
    ) && text.length < 80
  );
}

/**
 * @param {string} message
 * @returns {boolean}
 */
export function messageRequestsPropertyInformation(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    return false;
  }
  if (text.includes("?")) {
    return true;
  }
  return /^(?:what|when|where|which|how|who|is|are|do|does|did|can|could|would|will|please|tell me|share|i(?:'d| would) like to know|i want to know|need to know|looking for info)/i.test(
    text,
  );
}

/**
 * @type {{ category: FactCategory, patterns: RegExp[] }[]}
 */
const BUYER_FACT_QUESTION_CHECKS = [
  {
    category: "price",
    patterns: [
      /\b(?:what|how much)\s+(?:is|are)\s+(?:the\s+)?(?:price|pricing|cost|rate)\b/i,
      /\b(?:price|pricing|cost|rate|emi|down payment)\s+(?:of|for)\b/i,
      /\b(?:starting|base)\s+price\b/i,
      /\b(?:any|what)\s+(?:discount|offer|deal)s?\b/i,
      /\bhow much\b.*\b(?:cost|pay|price)\b/i,
      /\bshare\s+(?:the\s+)?(?:price|pricing)\b/i,
    ],
  },
  {
    category: "inventory",
    patterns: [
      /\b(?:any|how many)\s+(?:units|flats|apartments|homes)\s+(?:are\s+)?(?:still\s+)?(?:available|left|remaining)\b/i,
      /\b(?:units|flats)\s+(?:available|left|remaining)\b/i,
      /\b(?:in stock|sold out|inventory)\b/i,
      /\bunit availability\b/i,
      /\b(?:is there|are there)\s+(?:any\s+)?(?:units|flats|inventory)\b/i,
    ],
  },
  {
    category: "configurations",
    patterns: [
      /\bwhat\s+(?:configurations|configuration|bhk|bedroom)\b/i,
      /\bwhich\s+(?:bhk|configurations?)\b/i,
      /\b(?:do you|you)\s+(?:have|offer)\s+(?:\d\s*bhk|\d\s*bedroom)/i,
      /\b(?:available|offer(?:ed)?)\s+in\s+\d\s*bhk\b/i,
      /\bhow many\s+bhk\b/i,
    ],
  },
  {
    category: "location",
    patterns: [
      /\bwhere\s+(?:is|are)\s+(?:the\s+)?(?:project|property|site|it)\b/i,
      /\b(?:project|property|site)\s+location\b/i,
      /\bwhat\s+(?:is|'s)\s+(?:the\s+)?(?:address|location)\b/i,
      /\bhow far\s+(?:is|from)\b/i,
      /\bnear\s+(?:which|what)\b/i,
    ],
  },
  {
    category: "amenities",
    patterns: [
      /\bwhat\s+(?:amenities|facilities)\b/i,
      /\b(?:list|tell me)\s+(?:the\s+)?amenities\b/i,
      /\b(?:do you|is there)\s+(?:a\s+)?(?:clubhouse|swimming pool|gym)\b/i,
      /\bamenities\s+(?:include|available)\b/i,
    ],
  },
  {
    category: "possession",
    patterns: [
      /\bwhen\s+(?:is|will|can)\s+(?:possession|handover|completion)\b/i,
      /\bpossession\s+(?:date|timeline|in|by)\b/i,
      /\bready to move\b/i,
      /\bhandover\s+(?:date|when|timeline)\b/i,
    ],
  },
  {
    category: "rera",
    patterns: [
      /\brera\s*(?:number|no|#|registration|id)\b/i,
      /\b(?:registered|registration)\s+(?:under\s+)?rera\b/i,
      /\bwhat\s+is\s+(?:the\s+)?rera\b/i,
      /\bis\s+it\s+rera\s+registered\b/i,
    ],
  },
];

/**
 * @param {string} message
 * @returns {FactCategory[]}
 */
export function detectRequestedFactCategories(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || isBareGreetingOrSmallTalk(text)) {
    return [];
  }
  if (!messageRequestsPropertyInformation(text)) {
    return [];
  }

  const categories = [];
  for (const { category, patterns } of BUYER_FACT_QUESTION_CHECKS) {
    if (patterns.some((pattern) => pattern.test(text))) {
      categories.push(category);
    }
  }
  return categories;
}

/**
 * @param {string} message
 * @param {import("../config/projectFacts.js").ApprovedProjectFacts} approvedFacts
 * @returns {FactCategory[]}
 */
export function findUnavailableRequestedFactCategories(message, approvedFacts) {
  if (!approvedFacts) {
    return [];
  }

  const requested = detectRequestedFactCategories(message);
  if (requested.length === 0) {
    return [];
  }

  return requested.filter(
    (category) => !isFactCategoryApproved(category, approvedFacts),
  );
}

function getPortfolioEntries(approvedFacts) {
  return Array.isArray(approvedFacts?.projects)
    ? approvedFacts.projects.map((entry) => ({
        projectName: entry?.projectName,
        facts: entry?.facts ?? null,
      }))
    : null;
}

function findPortfolioScope(message, entries) {
  const lowerMessage = message.toLowerCase();
  const mentioned = entries.filter(
    ({ projectName }) =>
      typeof projectName === "string" &&
      lowerMessage.includes(projectName.toLowerCase()),
  );
  if (mentioned.length > 0) {
    return mentioned;
  }
  return entries;
}

function findPortfolioFactGaps(message, approvedFacts, initialProject) {
  const entries = getPortfolioEntries(approvedFacts);
  if (!entries) {
    return {
      unavailable: findUnavailableRequestedFactCategories(message, approvedFacts),
      scope: initialProject || null,
    };
  }

  const requested = detectRequestedFactCategories(message);
  const targets = findPortfolioScope(message, entries);
  const unavailable = requested.filter((category) =>
    targets.every(
      ({ facts }) => !facts || !isFactCategoryApproved(category, facts),
    ),
  );
  const mentioned = entries.filter(
    ({ projectName }) =>
      typeof projectName === "string" &&
      message.toLowerCase().includes(projectName.toLowerCase()),
  );
  const scope =
    mentioned.length > 0
      ? mentioned.map(({ projectName }) => projectName).join(" and ")
      : null;

  return { unavailable, scope };
}

/**
 * @param {string} projectName
 * @param {FactCategory[]} categories
 * @returns {import("./geminiLeadChat.js").LeadChatTurnData}
 */
export function buildFactGapHandoffTurn(projectName, categories) {
  const unique = [...new Set(categories)];
  return {
    reply: buildSafeFallbackReply(projectName, unique),
    preferredLanguage: null,
    qualification: null,
    buyerSummary: null,
    needsHumanHandoff: true,
    handoffReason: buildSafeguardHandoffReason(unique),
    recommendQualified: false,
  };
}

/**
 * @param {string} message
 * @param {import("../config/projectFacts.js").ApprovedProjectFacts} approvedFacts
 * @param {string} projectName
 * @returns {import("./geminiLeadChat.js").LeadChatTurnData|null}
 */
export function tryBuildFactGapHandoffTurn(
  message,
  approvedFacts,
  initialProject = null,
) {
  const { unavailable, scope } = findPortfolioFactGaps(
    message,
    approvedFacts,
    initialProject,
  );
  if (unavailable.length === 0) {
    return null;
  }
  return buildFactGapHandoffTurn(scope, unavailable);
}
