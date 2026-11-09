import mongoose from "mongoose";

export const LEAD_PROJECTS = [
  "Skyline Residences",
  "Green Valley Phase 2",
  "Riverfront Heights",
  "Palm Grove Villas",
  "Orchid Park Residences",
  "Terrace Gardens",
];

export const PROJECTS_WITH_APPROVED_FACTS = [
  "Skyline Residences",
  "Green Valley Phase 2",
  "Riverfront Heights",
  "Palm Grove Villas",
  "Orchid Park Residences",
  "Terrace Gardens",
];

export const LEAD_SOURCES = [
  "99acres",
  "MagicBricks",
  "Website",
  "Referral",
  "Housing.com",
];

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Visit booked"];

export const HANDOFF_STATUSES = ["None", "Pending", "Assigned", "Resolved"];

export const HANDOFF_TYPES = ["ai", "buyer_callback"];

export const HANDOFF_CONTACT_METHODS = ["phone", "email"];

const timelineEventSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["created", "ai", "reply"],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    detail: { type: String, default: "", trim: true },
    time: { type: String, default: "", trim: true },
    at: { type: Date, default: null },
  },
  { _id: true },
);

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

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true },
    project: {
      type: String,
      default: null,
      enum: LEAD_PROJECTS,
    },
    initialProject: {
      type: String,
      default: null,
      enum: LEAD_PROJECTS,
    },
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
    source: {
      type: String,
      required: true,
      enum: LEAD_SOURCES,
    },
    budget: { type: String, default: "Not specified", trim: true },
    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: "New",
    },
    statusBeforeVisit: {
      type: String,
      enum: LEAD_STATUSES,
      default: null,
    },
    executive: { type: String, default: "Unassigned", trim: true },
    handoffStatus: {
      type: String,
      enum: HANDOFF_STATUSES,
      default: "None",
    },
    handoffReason: { type: String, default: "", trim: true },
    /** Snapshot of the AI-triggered reason; preserved when a buyer callback upgrades the handoff. */
    handoffAiReason: { type: String, default: "", trim: true },
    handoffRequestedAt: { type: Date, default: null },
    handoffResolvedAt: { type: Date, default: null },
    handoffType: {
      type: String,
      enum: [...HANDOFF_TYPES, ""],
      default: "",
    },
    handoffCallbackNote: { type: String, default: "", trim: true },
    handoffPreferredContactMethod: {
      type: String,
      enum: [...HANDOFF_CONTACT_METHODS, ""],
      default: "",
    },
    preferredConfiguration: { type: String, default: "", trim: true },
    preferredLanguage: { type: String, default: "", trim: true },
    qualification: {
      type: qualificationSchema,
      default: () => ({}),
    },
    timeline: {
      type: [timelineEventSchema],
      default: [],
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    buyerSummary: { type: String, default: "", trim: true },
    lastActivityAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  },
);

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;
