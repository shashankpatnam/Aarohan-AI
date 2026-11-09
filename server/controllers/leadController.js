import mongoose from "mongoose";
import Lead, {
  LEAD_PROJECTS,
  LEAD_SOURCES,
  LEAD_STATUSES,
} from "../models/Lead.js";
import SiteVisit from "../models/SiteVisit.js";
import StaffUser from "../models/StaffUser.js";
import {
  applyHandoffFromChat,
  serializeHandoffFields,
} from "../services/leadHandoffService.js";
import {
  buildFallbackChatTurnData,
  CHAT_FAILURE_REASON,
  logGracefulChatFallback,
} from "../services/leadChatGracefulFallback.js";
import { resolveLeadChatTurn } from "../services/leadChatTurnResolver.js";
import {
  buildLeadContextForGemini,
  buildRecentMessagesForGemini,
  formatChatMessageTime,
  validateChatMessageBody,
} from "../services/leadChatShared.js";

function isValidObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return false;
  }
  return String(new mongoose.Types.ObjectId(id)) === id;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatLastActivity(lastActivityAt) {
  if (!lastActivityAt) {
    return "—";
  }

  const then = new Date(lastActivityAt).getTime();
  if (Number.isNaN(then)) {
    return "—";
  }

  const diffMs = Date.now() - then;
  if (diffMs < 0) {
    return "Just now";
  }

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return "Just now";
  }
  if (diffMin < 60) {
    return `${diffMin} min ago`;
  }

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return diffHr === 1 ? "1 hr ago" : `${diffHr} hrs ago`;
  }

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) {
    return "Yesterday";
  }
  if (diffDay < 7) {
    return `${diffDay} days ago`;
  }

  return new Date(lastActivityAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function serializeLeadDocument(lead) {
  const doc = lead.toObject ? lead.toObject() : lead;
  const { _id, __v, ...rest } = doc;
  return {
    id: _id.toString(),
    ...rest,
    projectLabel: rest.project ?? "General Inquiry",
  };
}

function serializeLeadWithLastActivity(lead) {
  const serializedLead = serializeLeadDocument(lead);
  if (serializedLead.lastActivityAt) {
    serializedLead.lastActivityAt = new Date(
      serializedLead.lastActivityAt,
    ).toISOString();
  }
  serializedLead.lastActivity = formatLastActivity(
    serializedLead.lastActivityAt,
  );
  Object.assign(serializedLead, serializeHandoffFields(lead));
  return serializedLead;
}

function formatTimelineDisplayTime(date) {
  return date.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateTimelineDetail(text, maxLength = 280) {
  if (typeof text !== "string") {
    return "";
  }
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function applyQualificationUpdates(lead, updates) {
  if (!updates || typeof updates !== "object") {
    return;
  }

  if (!lead.qualification) {
    lead.qualification = {};
  }

  if (updates.buyingTimeline) {
    lead.qualification.buyingTimeline = updates.buyingTimeline;
  }
  if (updates.budgetFit) {
    lead.qualification.budgetFit = updates.budgetFit;
  }
  if (updates.locationPreference) {
    lead.qualification.locationPreference = updates.locationPreference;
  }
  if (typeof updates.score === "number" && Number.isFinite(updates.score)) {
    lead.qualification.score = updates.score;
  }
}

function serializeLeadListItem(lead) {
  const doc = lead.toObject ? lead.toObject() : lead;
  return {
    id: doc._id.toString(),
    name: doc.name,
    phone: doc.phone,
    project: doc.project,
    projectLabel: doc.project ?? "General Inquiry",
    initialProject: doc.initialProject ?? null,
    interestedProjects: doc.interestedProjects ?? [],
    source: doc.source,
    budget: doc.budget,
    status: doc.status,
    executive: doc.executive,
    handoffStatus: doc.handoffStatus ?? "None",
    lastActivityAt: doc.lastActivityAt
      ? new Date(doc.lastActivityAt).toISOString()
      : null,
    lastActivity: formatLastActivity(doc.lastActivityAt),
  };
}

function serializeVisit(visit) {
  const doc = visit.toObject ? visit.toObject() : visit;
  return {
    id: doc._id.toString(),
    leadId: doc.lead.toString(),
    buyer: doc.buyerName,
    project: doc.project,
    visitDate: doc.visitDate,
    slot: doc.slot,
    executive: doc.executive,
    notes: doc.notes,
    status: doc.status,
    bookedAt: doc.bookedAt ? new Date(doc.bookedAt).toISOString() : null,
    statusChangedAt: doc.statusChangedAt
      ? new Date(doc.statusChangedAt).toISOString()
      : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

function buildListFilter(query) {
  const filter = {};
  const { status, project, interestedProject, source, search } = query;

  if (status && status !== "all") {
    if (!LEAD_STATUSES.includes(status)) {
      return {
        error: `Invalid status. Must be one of: ${LEAD_STATUSES.join(", ")}`,
      };
    }
    filter.status = status;
  }

  if (project && project !== "all") {
    if (typeof project === "string" && project.toLowerCase() === "general inquiry") {
      filter.project = null;
    } else if (!LEAD_PROJECTS.includes(project)) {
      return {
        error: `Invalid primary project. Use General Inquiry or one of: ${LEAD_PROJECTS.join(", ")}`,
      };
    } else {
      filter.project = project;
    }
  }

  if (interestedProject && interestedProject !== "all") {
    if (!LEAD_PROJECTS.includes(interestedProject)) {
      return { error: `Invalid interested project. Must be one of: ${LEAD_PROJECTS.join(", ")}` };
    }
    filter.interestedProjects = interestedProject;
  }

  if (source && source !== "all") {
    if (!LEAD_SOURCES.includes(source)) {
      return {
        error: `Invalid source. Must be one of: ${LEAD_SOURCES.join(", ")}`,
      };
    }
    filter.source = source;
  }

  const searchTerm = typeof search === "string" ? search.trim() : "";
  if (searchTerm) {
    const pattern = escapeRegex(searchTerm);
    const searchOptions = [
      { name: { $regex: pattern, $options: "i" } },
      { phone: { $regex: pattern, $options: "i" } },
      { project: { $regex: pattern, $options: "i" } },
    ];
    if (/general\s+inquiry/i.test(searchTerm)) searchOptions.push({ project: null });
    filter.$or = searchOptions;
  }

  return { filter };
}

async function computeSummary() {
  const [all, statusCounts] = await Promise.all([
    Lead.countDocuments(),
    Lead.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const byStatus = Object.fromEntries(
    statusCounts.map(({ _id, count }) => [_id, count]),
  );

  const statusBreakdown = {
    New: byStatus.New ?? 0,
    Contacted: byStatus.Contacted ?? 0,
    Qualified: byStatus.Qualified ?? 0,
    "Visit booked": byStatus["Visit booked"] ?? 0,
  };

  return {
    all,
    new: statusBreakdown.New,
    contacted: statusBreakdown.Contacted,
    qualified: statusBreakdown.Qualified,
    visitBooked: statusBreakdown["Visit booked"],
    statusBreakdown,
  };
}

function qualificationDimensionsComplete(lead) {
  const q = lead.qualification;
  if (!q) {
    return false;
  }

  const buyingTimeline =
    typeof q.buyingTimeline === "string" ? q.buyingTimeline.trim() : "";
  const budgetFit = typeof q.budgetFit === "string" ? q.budgetFit.trim() : "";
  const locationPreference =
    typeof q.locationPreference === "string"
      ? q.locationPreference.trim()
      : "";

  return Boolean(buyingTimeline && budgetFit && locationPreference);
}

/**
 * Promote to Qualified only when Gemini sets recommendQualified and all three
 * qualification dimensions are populated on the lead (score alone never qualifies).
 */
function maybePromoteLeadToQualified(lead, recommendQualified, now) {
  if (recommendQualified !== true) {
    return;
  }

  if (lead.status === "Visit booked" || lead.status === "Qualified") {
    return;
  }

  if (!qualificationDimensionsComplete(lead)) {
    return;
  }

  const previousStatus = lead.status;
  lead.status = "Qualified";
  lead.timeline.push({
    kind: "ai",
    title: "Lead status updated",
    detail: `Status changed from ${previousStatus} to Qualified after buyer qualification was confirmed in conversation.`,
    time: formatTimelineDisplayTime(now),
    at: now,
  });
}

function appendLeadStatusTimelineEntry(
  lead,
  previousStatus,
  nextStatus,
  now,
  detailSuffix = "",
) {
  const suffix = detailSuffix ? ` ${detailSuffix}` : "";
  lead.timeline.push({
    kind: "ai",
    title: "Lead status updated",
    detail: `Status changed from ${previousStatus} to ${nextStatus}.${suffix}`,
    time: formatTimelineDisplayTime(now),
    at: now,
  });
}

function appendExecutiveTimelineEntry(lead, executive, now) {
  lead.timeline.push({
    kind: "ai",
    title: "Executive assigned",
    detail: `Assigned to ${executive}.`,
    time: formatTimelineDisplayTime(now),
    at: now,
  });
}

function validateUpdateLeadBody(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { errors: ["Request body must be a JSON object"] };
  }

  const allowedKeys = ["status", "executive", "project"];
  const keys = Object.keys(body);
  const unknown = keys.filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    return {
      errors: [`Only these fields may be updated: ${allowedKeys.join(", ")}`],
    };
  }

  const updates = {};
  const errors = [];

  if (body.status !== undefined) {
    const status =
      typeof body.status === "string" ? body.status.trim() : "";
    if (!status) {
      errors.push("status must be a non-empty string");
    } else if (!LEAD_STATUSES.includes(status)) {
      errors.push(`status must be one of: ${LEAD_STATUSES.join(", ")}`);
    } else if (status === "Visit booked") {
      errors.push(
        'status cannot be set to "Visit booked" via this endpoint; book a site visit instead',
      );
    } else {
      updates.status = status;
    }
  }

  if (body.executive !== undefined) {
    const executive =
      typeof body.executive === "string" ? body.executive.trim() : "";
    if (!executive) {
      errors.push("executive must be a non-empty string");
    } else if (executive.length > 120) {
      errors.push("executive must be at most 120 characters");
    } else {
      updates.executive = executive;
    }
  }

  if (Object.hasOwn(body, "project")) {
    const project = typeof body.project === "string" ? body.project.trim() : body.project;
    if (project === null || project === "" || project === "General Inquiry") {
      updates.project = null;
    } else if (typeof project !== "string" || !LEAD_PROJECTS.includes(project)) {
      errors.push(`project must be null or one of: ${LEAD_PROJECTS.join(", ")}`);
    } else {
      updates.project = project;
    }
  }

  if (keys.length === 0) {
    errors.push("At least one of status, executive or project is required");
  }

  if (errors.length > 0) {
    return { errors };
  }

  if (Object.keys(updates).length === 0) {
    return { errors: ["No valid fields to update"] };
  }

  return { data: updates };
}

async function leadHasScheduledVisit(leadId) {
  const visit = await SiteVisit.findOne({
    lead: leadId,
    status: "Scheduled",
  })
    .select("_id")
    .lean();
  return Boolean(visit);
}

function validateCreateBody(body) {
  const errors = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const project = body.project == null || body.project === "" ? null : body.project;
  const source = typeof body.source === "string" ? body.source.trim() : "";

  if (!name) {
    errors.push("name is required");
  }
  if (!phone) {
    errors.push("phone is required");
  }
  if (project !== null && (typeof project !== "string" || !LEAD_PROJECTS.includes(project))) {
    errors.push(`project must be one of: ${LEAD_PROJECTS.join(", ")}`);
  }
  if (!source) {
    errors.push("source is required");
  } else if (!LEAD_SOURCES.includes(source)) {
    errors.push(`source must be one of: ${LEAD_SOURCES.join(", ")}`);
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { data: { name, phone, project, interestedProjects: project ? [project] : [], source } };
}

export async function listLeads(req, res) {
  try {
    const built = buildListFilter(req.query);
    if (built.error) {
      return res.status(400).json({ success: false, message: built.error });
    }

    const [summary, leads] = await Promise.all([
      computeSummary(),
      Lead.find(built.filter).sort({ lastActivityAt: -1, createdAt: -1 }),
    ]);

    const visits = leads.length
      ? await SiteVisit.find({ lead: { $in: leads.map((lead) => lead._id) } })
          .sort({ createdAt: -1, _id: -1 })
          .select("lead project")
          .lean()
      : [];
    const visitProjectByLead = new Map();
    for (const visit of visits) {
      const leadId = visit.lead.toString();
      if (!visitProjectByLead.has(leadId)) {
        visitProjectByLead.set(leadId, visit.project);
      }
    }

    return res.json({
      success: true,
      summary,
      leads: leads.map((lead) => ({
        ...serializeLeadListItem(lead),
        visitProject: visitProjectByLead.get(lead._id.toString()) ?? null,
      })),
    });
  } catch (error) {
    console.error("listLeads error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leads",
    });
  }
}

export async function createLead(req, res) {
  try {
    const validated = validateCreateBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const now = new Date();
    const { project, source } = validated.data;
    const lead = await Lead.create({
      ...validated.data,
      lastActivityAt: now,
      timeline: [
        {
          kind: "created",
          title: "Lead created",
          detail: `Enquiry captured for ${project ?? "General Inquiry"} via ${source}.`,
          time: formatTimelineDisplayTime(now),
          at: now,
        },
      ],
    });

    const serialized = serializeLeadDocument(lead);
    serialized.lastActivity = formatLastActivity(serialized.lastActivityAt);
    if (serialized.lastActivityAt) {
      serialized.lastActivityAt = new Date(
        serialized.lastActivityAt,
      ).toISOString();
    }

    return res.status(201).json({
      success: true,
      lead: serialized,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("createLead error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create lead",
    });
  }
}

export async function getLeadById(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    const visits = await SiteVisit.find({ lead: id }).sort({
      visitDate: -1,
      createdAt: -1,
    });

    const serializedVisits = visits.map(serializeVisit);
    const activeVisit =
      serializedVisits.find((visit) => visit.status === "Scheduled") ?? null;

    const serializedLead = serializeLeadWithLastActivity(lead);

    return res.json({
      success: true,
      lead: serializedLead,
      visits: serializedVisits,
      activeVisit,
    });
  } catch (error) {
    console.error("getLeadById error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch lead",
    });
  }
}

export async function postLeadChat(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const validated = validateChatMessageBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    const { message: buyerText } = validated.data;

    const resolvedTurn = await resolveLeadChatTurn({
      initialProject: lead.initialProject ?? null,
      latestBuyerMessage: buyerText,
      recentMessages: buildRecentMessagesForGemini(lead.messages),
      leadContext: buildLeadContextForGemini(lead),
      lead,
    });

    if (resolvedTurn.chatFailureReason) {
      logGracefulChatFallback(id, resolvedTurn.chatFailureReason);
    }

    const {
      reply,
      preferredLanguage,
      qualification,
      buyerSummary,
      needsHumanHandoff,
      handoffReason,
      recommendQualified,
    } = resolvedTurn.data;

    const now = new Date();
    const buyerMessage = {
      from: "buyer",
      text: buyerText,
      time: formatChatMessageTime(now),
      at: now,
    };
    const aiMessage = {
      from: "ai",
      text: reply,
      time: formatChatMessageTime(now),
      at: now,
    };

    lead.messages.push(buyerMessage, aiMessage);

    lead.timeline.push({
      kind: "reply",
      title: "Buyer sent a message",
      detail: truncateTimelineDetail(buyerText),
      time: formatTimelineDisplayTime(now),
      at: now,
    });
    lead.timeline.push({
      kind: "ai",
      title: "Aarohan AI replied",
      detail: truncateTimelineDetail(reply),
      time: formatTimelineDisplayTime(now),
      at: now,
    });

    if (lead.status === "New") {
      lead.status = "Contacted";
      lead.timeline.push({
        kind: "ai",
        title: "Lead status updated",
        detail: "Status changed from New to Contacted.",
        time: formatTimelineDisplayTime(now),
        at: now,
      });
    }

    if (needsHumanHandoff) {
      applyHandoffFromChat(lead, needsHumanHandoff, handoffReason, now);
    }

    applyQualificationUpdates(lead, qualification);
    maybePromoteLeadToQualified(lead, recommendQualified, now);

    if (buyerSummary) {
      lead.buyerSummary = buyerSummary;
    }
    if (preferredLanguage) {
      lead.preferredLanguage = preferredLanguage;
    }

    lead.lastActivityAt = now;
    await lead.save();

    const serializedLead = serializeLeadWithLastActivity(lead);

    const responseBody = {
      success: true,
      lead: serializedLead,
      messages: serializedLead.messages,
      needsHumanHandoff,
      handoffReason: needsHumanHandoff ? handoffReason : null,
    };

    if (resolvedTurn.chatFailureReason) {
      responseBody.chatFailureReason = resolvedTurn.chatFailureReason;
    }

    return res.json(responseBody);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    const leadId = req.params?.id;
    if (typeof leadId === "string" && isValidObjectId(leadId)) {
      try {
        const lead = await Lead.findById(leadId);
        const buyerText =
          typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (lead && buyerText) {
          logGracefulChatFallback(leadId, CHAT_FAILURE_REASON.UNKNOWN_ERROR);

          const turnData = buildFallbackChatTurnData(
            lead,
            buyerText,
            CHAT_FAILURE_REASON.UNKNOWN_ERROR,
          );
          const now = new Date();

          lead.messages.push(
            {
              from: "buyer",
              text: buyerText,
              time: formatChatMessageTime(now),
              at: now,
            },
            {
              from: "ai",
              text: turnData.reply,
              time: formatChatMessageTime(now),
              at: now,
            },
          );
          lead.timeline.push({
            kind: "reply",
            title: "Buyer sent a message",
            detail: truncateTimelineDetail(buyerText),
            time: formatTimelineDisplayTime(now),
            at: now,
          });
          lead.timeline.push({
            kind: "ai",
            title: "Aarohan AI replied",
            detail: truncateTimelineDetail(turnData.reply),
            time: formatTimelineDisplayTime(now),
            at: now,
          });
          if (lead.status === "New") {
            lead.status = "Contacted";
          }
          applyHandoffFromChat(
            lead,
            true,
            turnData.handoffReason,
            now,
          );
          lead.lastActivityAt = now;
          await lead.save();

          const serializedLead = serializeLeadWithLastActivity(lead);
          return res.json({
            success: true,
            lead: serializedLead,
            messages: serializedLead.messages,
            needsHumanHandoff: true,
            handoffReason: turnData.handoffReason,
            chatFailureReason: CHAT_FAILURE_REASON.UNKNOWN_ERROR,
          });
        }
      } catch (recoveryError) {
        console.error("postLeadChat recovery error:", recoveryError.message);
      }
    }

    console.error("postLeadChat error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to process chat message",
    });
  }
}

export async function updateLead(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const validated = validateUpdateLeadBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    const { status: nextStatus, executive: nextExecutive, project: nextProject } = validated.data;
    if (nextExecutive !== undefined && nextExecutive !== lead.executive) {
      const eligibleExecutive = await StaffUser.findOne({
        name: nextExecutive,
        role: "staff",
        isActive: true,
      }).select("_id");
      if (!eligibleExecutive) {
        return res.status(400).json({
          success: false,
          message: "Executive must be an active staff account",
        });
      }
    }
    const now = new Date();
    let changed = false;

    if (nextProject !== undefined && nextProject !== lead.project) {
      lead.project = nextProject;
      lead.timeline.push({
        kind: "reply",
        title: "Primary project updated",
        detail: `Primary project changed to ${nextProject ?? "General Inquiry"} by sales team.`,
        time: formatTimelineDisplayTime(now),
        at: now,
      });
      changed = true;
    }
    if (nextProject && !lead.interestedProjects.includes(nextProject)) {
      lead.interestedProjects.push(nextProject);
      changed = true;
    }

    if (nextStatus !== undefined && nextStatus !== lead.status) {
        const hasScheduledVisit = await leadHasScheduledVisit(id);
        if (hasScheduledVisit) {
          return res.status(409).json({
            success: false,
            message:
              "Cannot change lead status while a site visit is scheduled; cancel the visit first",
          });
        }

        const previousStatus = lead.status;
        lead.status = nextStatus;
        appendLeadStatusTimelineEntry(
          lead,
          previousStatus,
          nextStatus,
          now,
          "(updated by sales team)",
        );
        changed = true;
    } else if (nextStatus !== undefined) {
      // same status — no-op
    }

    if (nextExecutive !== undefined && nextExecutive !== lead.executive) {
      if (lead.handoffStatus === "Resolved") {
        return res.status(409).json({ success: false, message: "Resolved handoffs cannot be reassigned" });
      }
      if (lead.handoffStatus === "Pending" || lead.handoffStatus === "Assigned") {
        return res.status(409).json({ success: false, message: "Use the handoff assignment action for open handoffs" });
      }
      lead.executive = nextExecutive;
      appendExecutiveTimelineEntry(lead, nextExecutive, now);
      changed = true;
    }

    if (!changed) {
      const serializedLead = serializeLeadWithLastActivity(lead);
      return res.json({
        success: true,
        lead: serializedLead,
        message: "No changes applied",
      });
    }

    lead.lastActivityAt = now;
    await lead.save();

    const serializedLead = serializeLeadWithLastActivity(lead);

    return res.json({
      success: true,
      lead: serializedLead,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("updateLead error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update lead",
    });
  }
}
