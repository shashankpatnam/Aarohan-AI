import mongoose from "mongoose";
import Lead, { HANDOFF_STATUSES } from "../models/Lead.js";
import StaffUser from "../models/StaffUser.js";
import {
  serializeHandoffFields,
} from "../services/leadHandoffService.js";

function formatLastActivity(lastActivityAt) {
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

function isValidObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return false;
  }
  return String(new mongoose.Types.ObjectId(id)) === id;
}

function serializeHandoffQueueItem(lead) {
  const doc = lead.toObject ? lead.toObject() : lead;
  return {
    leadId: doc._id.toString(),
    buyerName: doc.name,
    phone: doc.phone,
    email: doc.email ?? "",
    project: doc.project,
    projectLabel: doc.project ?? "General Inquiry",
    initialProject: doc.initialProject ?? null,
    interestedProjects: doc.interestedProjects ?? [],
    leadStatus: doc.status,
    executive: doc.executive,
    ...serializeHandoffFields(doc),
    lastActivityAt: doc.lastActivityAt
      ? new Date(doc.lastActivityAt).toISOString()
      : null,
    lastActivity: formatLastActivity(doc.lastActivityAt),
  };
}

function buildQueueFilter(statusParam) {
  const status =
    typeof statusParam === "string" ? statusParam.trim().toLowerCase() : "open";

  if (status === "all") {
    return { handoffStatus: { $in: ["Pending", "Assigned", "Resolved"] } };
  }
  if (status === "pending") {
    return { handoffStatus: "Pending" };
  }
  if (status === "assigned") {
    return { handoffStatus: "Assigned" };
  }
  if (status === "resolved") {
    return { handoffStatus: "Resolved" };
  }

  return { handoffStatus: { $in: ["Pending", "Assigned"] } };
}

export async function listHandoffs(req, res) {
  try {
    const filter = buildQueueFilter(req.query.status);

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 50));
    const [handoffs, summary, total] = await Promise.all([
      Lead.find(filter).select("name phone email project initialProject interestedProjects status executive handoffStatus handoffReason handoffAiReason handoffType handoffCallbackNote handoffPreferredContactMethod handoffRequestedAt handoffResolvedAt lastActivityAt").sort({
        handoffRequestedAt: -1,
        lastActivityAt: -1,
      }).skip((page - 1) * pageSize).limit(pageSize),
      Promise.all([
        Lead.countDocuments({ handoffStatus: "Pending" }),
        Lead.countDocuments({ handoffStatus: "Assigned" }),
        Lead.countDocuments({ handoffStatus: "Resolved" }),
      ]).then(([pending, assigned, resolved]) => ({ pending, assigned, resolved })),
      Lead.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      summary,
      handoffs: handoffs.map(serializeHandoffQueueItem),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    console.error("listHandoffs error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch handoffs",
    });
  }
}

export async function assignHandoff(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const executiveId = typeof req.body?.executiveId === "string" ? req.body.executiveId.trim() : "";
    const validated = executiveId && mongoose.Types.ObjectId.isValid(executiveId)
      ? { data: { executiveId } }
      : { errors: ["executiveId must identify an active staff account"] };
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const staff = await StaffUser.findOne({ _id: validated.data.executiveId, role: "staff", isActive: true }).select("name");
    if (!staff) {
      return res.status(400).json({ success: false, message: "Select an active staff account" });
    }

    const now = new Date();
    const lead = await Lead.findOneAndUpdate(
      { _id: id, handoffStatus: { $in: ["Pending", "Assigned"] } },
      {
        $set: { handoffStatus: "Assigned", executive: staff.name, lastActivityAt: now },
        $push: { timeline: {
          kind: "ai",
          title: "Handoff assigned",
          detail: `Human follow-up assigned to ${staff.name}.`,
          time: now.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
          at: now,
        } },
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!lead) {
      const current = await Lead.findById(id).select("handoffStatus");
      if (!current) return res.status(404).json({ success: false, message: "Lead not found" });
      return res.status(409).json({ success: false, message: `Handoff cannot be assigned while ${current.handoffStatus ?? "None"}` });
    }

    return res.json({
      success: true,
      handoff: serializeHandoffQueueItem(lead),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("assignHandoff error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to assign handoff",
    });
  }
}

export async function resolveHandoffRequest(req, res) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const now = new Date();
    const lead = await Lead.findOneAndUpdate(
      { _id: id, handoffStatus: { $in: ["Pending", "Assigned"] } },
      {
        $set: { handoffStatus: "Resolved", handoffResolvedAt: now, lastActivityAt: now },
        $push: { timeline: {
          kind: "ai",
          title: "Handoff resolved",
          detail: "Human follow-up marked as resolved by the sales team.",
          time: now.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
          at: now,
        } },
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!lead) {
      const current = await Lead.findById(id).select("handoffStatus");
      if (!current) {
        return res.status(404).json({ success: false, message: "Lead not found" });
      }
      return res.status(409).json({
        success: false,
        message: current.handoffStatus === "Resolved"
          ? "Handoff is already resolved"
          : `No open handoff to resolve (current: ${current.handoffStatus ?? "None"})`,
      });
    }

    return res.json({
      success: true,
      handoff: serializeHandoffQueueItem(lead),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("resolveHandoffRequest error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to resolve handoff",
    });
  }
}

export { HANDOFF_STATUSES };
