import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./helpers/installMongooseConnectGuard.js";
import request from "supertest";
import { after, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import GuestSession from "../models/GuestSession.js";
import ProjectFacts from "../models/ProjectFacts.js";
import { PROJECTS_WITH_APPROVED_FACTS } from "../models/Lead.js";
import { getApprovedProjectFacts } from "../services/projectFactsService.js";

let memoryServer;
let agent;

const projectFacts = [
  ["Skyline Residences", "East Ahmedabad", ["2 BHK", "3 BHK"], "INR 65 lakh", "December 2027", "DEMO-RERA-0001"],
  ["Green Valley Phase 2", "Bopal, Ahmedabad", ["2 BHK", "3 BHK"], "INR 58 lakh", "June 2028", "DEMO-RERA-0002"],
  ["Riverfront Heights", "Sabarmati riverfront", ["3 BHK"], "INR 1.1 crore", "March 2028", "DEMO-RERA-0003"],
  ["Palm Grove Villas", "Ahmedabad–Gandhinagar", ["3 BHK villa", "4 BHK villa"], "INR 1.2 crore", "September 2028", "DEMO-RERA-0004"],
  ["Orchid Park Residences", "Gota, Ahmedabad", ["2 BHK", "3 BHK"], "INR 72 lakh", "November 2027", "DEMO-RERA-0005"],
  ["Terrace Gardens", "Prahlad Nagar, Ahmedabad", ["3 BHK"], "INR 95 lakh", "May 2028", "DEMO-RERA-0006"],
];

const expectedDtoKeys = [
  "projectName",
  "location",
  "propertyConfigurations",
  "priceInformation",
  "possessionTimeline",
  "reraInformation",
];

describe("GET /api/public/projects", () => {
  before(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    agent = request(createApp({ authRateLimit: { disabled: true } }));

    await ProjectFacts.collection.insertMany([
      ...projectFacts.map(([projectName, location, propertyConfigurations, startingFrom, possessionTimeline, reraInformation]) => ({
        projectName,
        approvalStatus: "approved",
        location,
        propertyConfigurations,
        priceInformation: { startingFrom, summary: "Internal pricing summary" },
        possessionTimeline,
        reraInformation,
        inventoryInformation: "Internal inventory note",
        internalNotes: "Never expose this",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      {
        projectName: "Unlisted Demo Project",
        approvalStatus: "approved",
        location: "Approved but not allowlisted",
        internalNotes: "Must remain private",
      },
    ]);
  });

  after(async () => {
    await GuestSession.deleteMany({});
    await mongoose.disconnect();
    if (memoryServer) await memoryServer.stop();
  });

  it("returns all six approved allowlisted projects using only buyer-safe DTO fields", async () => {
    assert.equal(PROJECTS_WITH_APPROVED_FACTS.length, 6);

    const response = await agent.get("/api/public/projects").expect(200);
    const actualNames = response.body.projects.map(({ projectName }) => projectName).sort();
    assert.deepEqual(actualNames, PROJECTS_WITH_APPROVED_FACTS.toSorted());

    for (const project of response.body.projects) {
      assert.deepEqual(Object.keys(project).sort(), expectedDtoKeys.toSorted());
      assert.equal(typeof project.location, "string");
      assert.ok(project.propertyConfigurations.length > 0);
      assert.equal(typeof project.priceInformation.startingFrom, "string");
      assert.equal(typeof project.possessionTimeline, "string");
      assert.equal(typeof project.reraInformation, "string");
    }

    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Internal pricing summary|Internal inventory note|Never expose this|inventoryInformation|approvalStatus|createdAt|updatedAt|internalNotes/i,
    );
  });

  it("never returns a draft document, even when its project name is allowlisted", async () => {
    assert.ok(PROJECTS_WITH_APPROVED_FACTS.includes("Green Valley Phase 2"));
    await ProjectFacts.collection.updateOne(
      { projectName: "Green Valley Phase 2" },
      { $set: { approvalStatus: "draft" } },
    );

    try {
      const response = await agent.get("/api/public/projects").expect(200);
      assert.equal(
        response.body.projects.some(({ projectName }) => projectName === "Green Valley Phase 2"),
        false,
      );
      assert.doesNotMatch(JSON.stringify(response.body), /Bopal, Ahmedabad|INR 58 lakh/);
    } finally {
      await ProjectFacts.collection.updateOne(
        { projectName: "Green Valley Phase 2" },
        { $set: { approvalStatus: "approved" } },
      );
    }
  });

  it("never returns an approved project that is not in the allowlist", async () => {
    assert.equal(PROJECTS_WITH_APPROVED_FACTS.includes("Unlisted Demo Project"), false);
    const response = await agent.get("/api/public/projects").expect(200);

    assert.equal(
      response.body.projects.some(({ projectName }) => projectName === "Unlisted Demo Project"),
      false,
    );
    assert.doesNotMatch(JSON.stringify(response.body), /Approved but not allowlisted|Must remain private/);
  });

  it("returns approved facts for both newly eligible projects and accepts their guest sessions", async () => {
    for (const project of ["Orchid Park Residences", "Terrace Gardens"]) {
      const facts = await getApprovedProjectFacts(project);
      assert.equal(facts.projectName, project);
      assert.ok(facts.location);

      const response = await agent
        .post("/api/public/sessions")
        .send({ intent: "project", project })
        .expect(201);
      assert.equal(response.body.session.project, project);
    }
  });
});
