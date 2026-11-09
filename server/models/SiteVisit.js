import mongoose from "mongoose";
import { LEAD_PROJECTS } from "./Lead.js";

export const VISIT_SLOTS = [
  "10:00 AM",
  "11:30 AM",
  "2:00 PM",
  "3:30 PM",
  "4:30 PM",
];

export const VISIT_STATUSES = ["Scheduled", "Completed", "Cancelled"];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const siteVisitSchema = new mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
    },
    buyerName: { type: String, required: true, trim: true },
    project: {
      type: String,
      required: true,
      enum: LEAD_PROJECTS,
    },
    visitDate: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator(value) {
          return ISO_DATE_PATTERN.test(value);
        },
        message: "visitDate must be in YYYY-MM-DD format",
      },
    },
    slot: {
      type: String,
      required: true,
      enum: VISIT_SLOTS,
    },
    executive: { type: String, required: true, trim: true },
    notes: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: VISIT_STATUSES,
      default: "Scheduled",
    },
    bookedAt: { type: Date, required: true },
    statusChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

siteVisitSchema.index(
  { lead: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "Scheduled" },
  },
);

siteVisitSchema.index(
  { project: 1, visitDate: 1, slot: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "Scheduled" },
  },
);

siteVisitSchema.index({ lead: 1, visitDate: -1 });

const SiteVisit = mongoose.model("SiteVisit", siteVisitSchema);

export default SiteVisit;
