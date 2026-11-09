import mongoose from "mongoose";
import { PROJECTS_WITH_APPROVED_FACTS } from "./Lead.js";

export const PROJECT_FACTS_APPROVAL_STATUSES = ["draft", "approved"];

const priceInformationSchema = new mongoose.Schema(
  {
    summary: { type: String, default: null, trim: true },
    startingFrom: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const projectFactsSchema = new mongoose.Schema(
  {
    projectName: {
      type: String,
      required: true,
      unique: true,
      enum: PROJECTS_WITH_APPROVED_FACTS,
    },
    location: { type: String, default: null, trim: true },
    propertyConfigurations: { type: [String], default: [] },
    priceInformation: {
      type: priceInformationSchema,
      default: null,
    },
    amenities: { type: [String], default: [] },
    possessionTimeline: { type: String, default: null, trim: true },
    reraInformation: { type: String, default: null, trim: true },
    visitProcess: { type: String, default: null, trim: true },
    inventoryInformation: { type: String, default: null, trim: true },
    approvalStatus: {
      type: String,
      enum: PROJECT_FACTS_APPROVAL_STATUSES,
      default: "draft",
    },
  },
  {
    timestamps: true,
  },
);

const ProjectFacts = mongoose.model("ProjectFacts", projectFactsSchema);

export default ProjectFacts;
