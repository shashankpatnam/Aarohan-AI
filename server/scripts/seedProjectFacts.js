import dotenv from "dotenv";
import mongoose from "mongoose";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ProjectFacts from "../models/ProjectFacts.js";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dirname, "../seeds/projectFacts.demo.json");

function buildInsertPayload(project) {
  return {
    projectName: project.projectName,
    location: project.location ?? null,
    propertyConfigurations: project.propertyConfigurations ?? [],
    priceInformation: project.priceInformation ?? null,
    amenities: project.amenities ?? [],
    possessionTimeline: project.possessionTimeline ?? null,
    reraInformation: project.reraInformation ?? null,
    visitProcess: project.visitProcess ?? null,
    inventoryInformation: project.inventoryInformation ?? null,
    approvalStatus: project.approvalStatus ?? "draft",
  };
}

async function seedProjectFacts() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error(
      "Seed failed: MONGODB_URI is not set. Add it to server/.env and try again.",
    );
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(seedPath, "utf8"));
  const projects = Array.isArray(payload.projects) ? payload.projects : [];

  if (projects.length === 0) {
    console.error("Seed failed: no projects found in projectFacts.demo.json");
    process.exit(1);
  }

  await mongoose.connect(uri);

  let inserted = 0;
  let skipped = 0;

  for (const project of projects) {
    if (!project?.projectName) {
      console.warn("Skipping seed entry without projectName");
      continue;
    }

    const result = await ProjectFacts.updateOne(
      { projectName: project.projectName },
      { $setOnInsert: buildInsertPayload(project) },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      inserted += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(
    `ProjectFacts seed complete: ${inserted} inserted, ${skipped} already present (existing rows unchanged).`,
  );

  await mongoose.disconnect();
}

seedProjectFacts().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exit(1);
});
