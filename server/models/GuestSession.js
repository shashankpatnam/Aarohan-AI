import mongoose from "mongoose";
import { LEAD_PROJECTS } from "./Lead.js";

const messageSchema = new mongoose.Schema(
  {
    from: {
      type: String,
      enum: ["ai", "buyer"],
      required: true,
    },
    text: { type: String, required: true, trim: true },
    time: { type: String, default: "", trim: true },
    at: { type: Date, default: null },
  },
  { _id: true },
);

const qualificationSchema = new mongoose.Schema(
  {
    buyingTimeline: { type: String, default: "", trim: true },
    budgetFit: { type: String, default: "", trim: true },
    locationPreference: { type: String, default: "", trim: true },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
  },
  { _id: false },
);

const interestEvidenceSchema = new mongoose.Schema(
  {
    project: {
      type: String,
      required: true,
      enum: LEAD_PROJECTS,
    },
    sourceBuyerMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["explicit_buyer_statement", "buyer_confirmation"],
    },
    recordedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
);

const guestSessionSchema = new mongoose.Schema(
  {
    project: {
      type: String,
      default: null,
      enum: LEAD_PROJECTS,
    },
    initialProject: { type: String, default: null, enum: LEAD_PROJECTS },
    interestedProjects: {
      type: [{ type: String, enum: LEAD_PROJECTS }],
      default: [],
      validate: {
        validator(projects) {
          return new Set(projects).size === projects.length;
        },
        message: "interestedProjects must not contain duplicate projects",
      },
    },
    interestEvidence: {
      type: [interestEvidenceSchema],
      default: [],
    },
    pendingInterestConfirmation: {
      projects: { type: [{ type: String, enum: LEAD_PROJECTS }], default: [] },
      primaryProject: { type: String, enum: [...LEAD_PROJECTS, null], default: null },
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    qualification: {
      type: qualificationSchema,
      default: () => ({}),
    },
    preferredLanguage: { type: String, default: "", trim: true },
    buyerSummary: { type: String, default: "", trim: true },
    needsHumanHandoff: { type: Boolean, default: false },
    handoffReason: { type: String, default: "", trim: true },
    handoffRequestedAt: { type: Date, default: null },
    contactCaptured: { type: Boolean, default: false },
    callbackRequestedAt: { type: Date, default: null },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },
    expiresAt: { type: Date, required: true },
    lastActivityAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  },
);

guestSessionSchema.index({ expiresAt: 1 });

const GuestSession = mongoose.model("GuestSession", guestSessionSchema);

export default GuestSession;
