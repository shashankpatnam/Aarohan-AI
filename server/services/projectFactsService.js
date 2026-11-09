import {
  APPROVED_FACT_PROJECT_NAMES,
  normalizeVisitProcessForAssistant,
} from "../config/projectFacts.js";
import ProjectFacts from "../models/ProjectFacts.js";

/**
 * Maps a MongoDB ProjectFacts document to the approved-facts DTO used by Gemini
 * and the property claim guard.
 *
 * @param {import("mongoose").LeanDocument<any>|null|undefined} doc
 * @returns {import("../config/projectFacts.js").ApprovedProjectFacts|null}
 */
export function toApprovedProjectFactsDto(doc) {
  if (!doc || typeof doc !== "object") {
    return null;
  }

  const priceInformation = doc.priceInformation
    ? {
        summary: doc.priceInformation.summary ?? null,
        startingFrom: doc.priceInformation.startingFrom ?? null,
        note: doc.priceInformation.note ?? null,
      }
    : null;

  return {
    projectName: doc.projectName,
    location: doc.location ?? null,
    propertyConfigurations: [...(doc.propertyConfigurations ?? [])],
    amenities: [...(doc.amenities ?? [])],
    possessionTimeline: doc.possessionTimeline ?? null,
    reraInformation: doc.reraInformation ?? null,
    visitProcess: normalizeVisitProcessForAssistant(doc.visitProcess),
    priceInformation,
    inventoryInformation: doc.inventoryInformation ?? null,
  };
}

/**
 * Returns approved facts for a project, or null if unknown, missing, or not approved.
 * Unknown or blank names never fall back to another project's facts.
 *
 * @param {string} projectName
 * @returns {Promise<import("../config/projectFacts.js").ApprovedProjectFacts|null>}
 */
export async function getApprovedProjectFacts(projectName) {
  if (typeof projectName !== "string") {
    return null;
  }

  const key = projectName.trim();
  if (!key || !APPROVED_FACT_PROJECT_NAMES.includes(key)) {
    return null;
  }

  const doc = await ProjectFacts.findOne({
    projectName: key,
    approvalStatus: "approved",
  }).lean();

  if (!doc) {
    return null;
  }

  return toApprovedProjectFactsDto(doc);
}

/**
 * Returns a portfolio-shaped DTO for every approved project name. A project
 * without an approved facts document is present with facts: null; internal
 * MongoDB fields and non-approved documents are never returned.
 *
 * @returns {Promise<{ projects: Array<{ projectName: string, facts: import("../config/projectFacts.js").ApprovedProjectFacts|null }> }>}
 */
export async function getApprovedPortfolioFacts() {
  const docs = await ProjectFacts.find({
    projectName: { $in: APPROVED_FACT_PROJECT_NAMES },
    approvalStatus: "approved",
  }).lean();
  const factsByProject = new Map(
    docs.map((doc) => [doc.projectName, toApprovedProjectFactsDto(doc)]),
  );

  return {
    projects: APPROVED_FACT_PROJECT_NAMES.map((projectName) => ({
      projectName,
      facts: factsByProject.get(projectName) ?? null,
    })),
  };
}
