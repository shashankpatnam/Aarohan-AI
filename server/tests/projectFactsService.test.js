import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import ProjectFacts from "../models/ProjectFacts.js";
import {
  getApprovedPortfolioFacts,
  getApprovedProjectFacts,
  toApprovedProjectFactsDto,
} from "../services/projectFactsService.js";
import { APPROVED_PUBLIC_VISIT_PROCESS } from "../config/projectFacts.js";
import { APPROVED_FACT_PROJECT_NAMES } from "../config/projectFacts.js";
import { startTestMongo, stopTestMongo } from "./helpers/testMongo.js";

const TEST_PROJECT = "Skyline Residences";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let memoryServer;

describe("projectFactsService", () => {
  it("returns null for unknown project names without querying invalid enums", async () => {
    assert.equal(await getApprovedProjectFacts(""), null);
    assert.equal(await getApprovedProjectFacts("Not A Real Project"), null);
    assert.equal(await getApprovedProjectFacts(null), null);
  });

  it("maps approved documents to the facts DTO shape", () => {
    const dto = toApprovedProjectFactsDto({
      projectName: TEST_PROJECT,
      location: "Demo City",
      propertyConfigurations: ["2 BHK"],
      amenities: ["Gym"],
      possessionTimeline: null,
      reraInformation: null,
      visitProcess: null,
      priceInformation: { summary: "From demo", startingFrom: null, note: null },
      inventoryInformation: null,
    });

    assert.equal(dto.projectName, TEST_PROJECT);
    assert.deepEqual(dto.propertyConfigurations, ["2 BHK"]);
    assert.equal(dto.priceInformation.summary, "From demo");
  });

  it("replaces in-chat slot visitProcess copy in the assistant DTO", () => {
    const dto = toApprovedProjectFactsDto({
      projectName: TEST_PROJECT,
      visitProcess:
        "Site visits are by appointment. Choose a free slot in the chat and you will receive a location pin and reminders 1 day and 2 hours before your visit.",
    });

    assert.equal(dto.visitProcess, APPROVED_PUBLIC_VISIT_PROCESS);
    assert.equal(/choose a free slot in the chat/i.test(dto.visitProcess), false);
  });

  it("normalizes stale manual CRM visitProcess wording", () => {
    const copy =
      "Site visits are arranged by the sales desk after you request a callback.";
    const dto = toApprovedProjectFactsDto({
      projectName: TEST_PROJECT,
      visitProcess: copy,
    });
    assert.equal(dto.visitProcess, APPROVED_PUBLIC_VISIT_PROCESS);
  });
});

describe("projectFactsService MongoDB", () => {
  before(async () => {
    memoryServer = await startTestMongo();
  });

  after(async () => {
    await stopTestMongo(memoryServer);
  });

  it("excludes draft facts from getApprovedProjectFacts", async () => {
    await ProjectFacts.updateOne(
      { projectName: TEST_PROJECT },
      {
        $set: {
          projectName: TEST_PROJECT,
          approvalStatus: "draft",
          location: null,
          propertyConfigurations: [],
          amenities: [],
          possessionTimeline: null,
          reraInformation: null,
          visitProcess: null,
          priceInformation: null,
          inventoryInformation: null,
        },
      },
      { upsert: true },
    );

    assert.equal(await getApprovedProjectFacts(TEST_PROJECT), null);
  });

  it("returns approved facts when approvalStatus is approved", async () => {
    await ProjectFacts.updateOne(
      { projectName: TEST_PROJECT },
      {
        $set: {
          approvalStatus: "approved",
          location: "Test location",
          propertyConfigurations: ["2 BHK"],
        },
      },
    );

    const facts = await getApprovedProjectFacts(TEST_PROJECT);
    assert.ok(facts);
    assert.equal(facts.projectName, TEST_PROJECT);
    assert.ok(Array.isArray(facts.propertyConfigurations));
    assert.equal(facts.location, "Test location");
  });

  it("returns null when no document exists for a valid project name", async () => {
    await ProjectFacts.deleteOne({ projectName: TEST_PROJECT });

    assert.equal(await getApprovedProjectFacts(TEST_PROJECT), null);

    await ProjectFacts.updateOne(
      { projectName: TEST_PROJECT },
      {
        $setOnInsert: {
          projectName: TEST_PROJECT,
          location: null,
          propertyConfigurations: [],
          priceInformation: null,
          amenities: [],
          possessionTimeline: null,
          reraInformation: null,
          visitProcess: null,
          inventoryInformation: null,
          approvalStatus: "draft",
        },
      },
      { upsert: true },
    );
  });

  it("returns allowlisted portfolio entries and excludes drafts and internal fields", async () => {
    await ProjectFacts.deleteMany({
      projectName: { $in: APPROVED_FACT_PROJECT_NAMES },
    });
    const approvedName = APPROVED_FACT_PROJECT_NAMES[0];
    const draftName = APPROVED_FACT_PROJECT_NAMES[1];
    await ProjectFacts.collection.insertMany([
      {
        projectName: approvedName,
        approvalStatus: "approved",
        location: "Approved location",
        propertyConfigurations: ["2 BHK"],
        amenities: ["Garden"],
        possessionTimeline: null,
        reraInformation: null,
        visitProcess: null,
        priceInformation: null,
        inventoryInformation: null,
        privateSalesNote: "must not reach Gemini",
      },
      {
        projectName: draftName,
        approvalStatus: "draft",
        location: "Draft-only location",
        privateSalesNote: "draft internal note",
      },
    ]);

    const portfolio = await getApprovedPortfolioFacts();
    assert.deepEqual(
      portfolio.projects.map(({ projectName }) => projectName),
      [...APPROVED_FACT_PROJECT_NAMES],
    );
    assert.equal(portfolio.projects[0].facts.location, "Approved location");
    assert.equal(portfolio.projects[1].facts, null);
    assert.equal(
      JSON.stringify(portfolio).includes("must not reach Gemini"),
      false,
    );
    assert.equal(JSON.stringify(portfolio).includes("Draft-only location"), false);
  });
});
