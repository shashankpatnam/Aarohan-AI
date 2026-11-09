import { PROJECTS_WITH_APPROVED_FACTS } from "../models/Lead.js";

/**
 * Approved property facts DTO for the Aarohan AI assistant.
 *
 * ONLY verified, business-approved values may be stored and returned from MongoDB.
 * Do not infer, estimate, or copy facts from portals, brochures, or the open web.
 * When information is not yet approved, leave fields as null, [], or NOT_PROVIDED.
 *
 * The AI must treat missing fields as unknown and must not fill gaps from general knowledge.
 */

/** Explicit sentinel for optional text fields when approval status is "known empty". */
export const NOT_PROVIDED = "not provided";

/** Accurate public copy for the self-service guest chat booking flow. */
export const APPROVED_PUBLIC_VISIT_PROCESS =
  "You can book a site visit directly through this chat. The booking flow collects your contact details, shows available dates and time slots, and submits your selected visit. Your visit is confirmed only after the booking is successfully submitted.";

const OUTDATED_VISIT_PROCESS_PATTERN =
  /choose a free slot in the chat|slot in (this |the )?chat|book(ing)? (a |the )?visit (slot )?in (this |the )?chat|no (?:live )?(?:in-chat )?(?:slot picker|calendar)|confirmed by (?:a )?sales executive in (?:our )?CRM|coordinated directly by (?:our )?sales team in (?:the )?CRM|share (?:your )?preferred (?:day|visit )?(?:time|date)|site visits? are arranged by (?:the )?sales (?:desk|team)|a visit is not (?:officially )?booked until/i;

/**
 * Normalizes stale visit-process copy without rewriting stored MongoDB facts.
 *
 * @param {string|null|undefined} visitProcess
 * @returns {string|null}
 */
export function normalizeVisitProcessForAssistant(visitProcess) {
  if (visitProcess == null) {
    return null;
  }
  if (typeof visitProcess !== "string") {
    return null;
  }
  const trimmed = visitProcess.trim();
  if (!trimmed) {
    return null;
  }
  if (OUTDATED_VISIT_PROCESS_PATTERN.test(trimmed)) {
    return APPROVED_PUBLIC_VISIT_PROCESS;
  }
  return trimmed;
}

/**
 * Consistent approved-facts shape for projects with verified facts.
 *
 * @typedef {Object} ApprovedPriceInformation
 * @property {string} summary - Verbatim approved pricing copy (required when object is set)
 * @property {string|null} [startingFrom] - Approved figure or range text only; never computed
 * @property {string|null} [note] - Approved disclaimer or validity note
 *
 * @typedef {Object} ApprovedProjectFacts
 * @property {string} projectName - Must match a LEAD_PROJECTS value exactly
 * @property {string|null} location - Approved location / address description
 * @property {string[]} propertyConfigurations - Approved unit types (e.g. "2 BHK"); empty if none
 * @property {string[]} amenities - Approved amenity list; empty if none
 * @property {string|null} possessionTimeline - Approved possession / handover statement
 * @property {string|null} reraInformation - Approved RERA registration text
 * @property {string|null} visitProcess - Approved site-visit instructions for this project
 * @property {ApprovedPriceInformation|null} priceInformation - Set only when pricing is approved; otherwise null
 * @property {string|null} inventoryInformation - Approved inventory text only; otherwise null
 */

/**
 * Empty approved-facts DTO shell (for tests and fixtures).
 *
 * @param {string} projectName
 * @returns {ApprovedProjectFacts}
 */
export function createEmptyApprovedFactsDto(projectName) {
  return {
    projectName,
    location: null,
    propertyConfigurations: [],
    amenities: [],
    possessionTimeline: null,
    reraInformation: null,
    visitProcess: null,
    priceInformation: null,
    inventoryInformation: null,
  };
}

/**
 * Project names that currently have verified facts eligible for public use.
 * @type {readonly string[]}
 */
export const APPROVED_FACT_PROJECT_NAMES = Object.freeze([
  ...PROJECTS_WITH_APPROVED_FACTS,
]);

/**
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export function isApprovedTextFact(value) {
  if (value == null || typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === NOT_PROVIDED) {
    return false;
  }
  return true;
}

/**
 * @param {ApprovedProjectFacts} facts
 * @returns {boolean}
 */
export function hasApprovedPriceInformation(facts) {
  if (!facts?.priceInformation) {
    return false;
  }
  const { summary, startingFrom } = facts.priceInformation;
  return isApprovedTextFact(summary) || isApprovedTextFact(startingFrom);
}

/** @param {ApprovedProjectFacts} facts */
export function hasApprovedLocation(facts) {
  return isApprovedTextFact(facts?.location);
}

/** @param {ApprovedProjectFacts} facts */
export function hasApprovedPropertyConfigurations(facts) {
  return (
    Array.isArray(facts?.propertyConfigurations) &&
    facts.propertyConfigurations.length > 0
  );
}

/** @param {ApprovedProjectFacts} facts */
export function hasApprovedAmenities(facts) {
  return Array.isArray(facts?.amenities) && facts.amenities.length > 0;
}

/** @param {ApprovedProjectFacts} facts */
export function hasApprovedPossessionTimeline(facts) {
  return isApprovedTextFact(facts?.possessionTimeline);
}

/** @param {ApprovedProjectFacts} facts */
export function hasApprovedReraInformation(facts) {
  return isApprovedTextFact(facts?.reraInformation);
}

/** @param {ApprovedProjectFacts} facts */
export function hasApprovedInventoryInformation(facts) {
  return isApprovedTextFact(facts?.inventoryInformation);
}
