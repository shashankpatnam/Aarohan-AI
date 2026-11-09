import mongoose from "mongoose";
import Lead, { LEAD_PROJECTS } from "../models/Lead.js";
import SiteVisit, { VISIT_SLOTS, VISIT_STATUSES } from "../models/SiteVisit.js";
import { isDuplicateKeyError, reserveSiteVisit } from "../services/siteVisitBookingService.js";

const STATUS_UPDATE_TARGETS = ["Completed", "Cancelled"];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return false;
  }
  return String(new mongoose.Types.ObjectId(id)) === id;
}

function isValidIsoDate(dateStr) {
  if (!ISO_DATE_PATTERN.test(dateStr)) {
    return false;
  }

  const [year, month, day] = dateStr.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function todayIsoLocal() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isVisitDateTodayOrFuture(visitDate) {
  return visitDate >= todayIsoLocal();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isoDateOffsetFromToday(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildVisitListFilter(query) {
  const filter = {};
  const { search, project, status, date } = query;
  const today = todayIsoLocal();

  if (project && project !== "all") {
    if (!LEAD_PROJECTS.includes(project)) {
      return {
        error: `Invalid project. Must be one of: ${LEAD_PROJECTS.join(", ")}`,
      };
    }
    filter.project = project;
  }

  if (status && status !== "all") {
    if (!VISIT_STATUSES.includes(status)) {
      return {
        error: `Invalid status. Must be one of: ${VISIT_STATUSES.join(", ")}`,
      };
    }
    filter.status = status;
  }

  if (date && date !== "all") {
    const allowedDateFilters = ["today", "this-week", "upcoming", "past"];
    if (!allowedDateFilters.includes(date)) {
      return {
        error: `Invalid date filter. Must be one of: ${allowedDateFilters.join(", ")}`,
      };
    }

    if (date === "today") {
      filter.visitDate = today;
    } else if (date === "past") {
      filter.visitDate = { $lt: today };
    } else if (date === "upcoming") {
      if (filter.status && filter.status !== "Scheduled") {
        return { filter: { _id: { $in: [] } } };
      }
      filter.status = "Scheduled";
      filter.visitDate = { $gte: today };
    } else if (date === "this-week") {
      filter.visitDate = { $gte: today, $lt: isoDateOffsetFromToday(7) };
    }
  }

  const searchTerm = typeof search === "string" ? search.trim() : "";
  if (searchTerm) {
    const pattern = escapeRegex(searchTerm);
    filter.$or = [
      { buyerName: { $regex: pattern, $options: "i" } },
      { project: { $regex: pattern, $options: "i" } },
    ];
  }

  return { filter };
}

async function computeVisitSummary() {
  const today = todayIsoLocal();

  const [upcoming, todayCount, overdue, completed, cancelled, total] =
    await Promise.all([
      SiteVisit.countDocuments({
        status: "Scheduled",
        visitDate: { $gt: today },
      }),
      SiteVisit.countDocuments({ status: "Scheduled", visitDate: today }),
      SiteVisit.countDocuments({
        status: "Scheduled",
        visitDate: { $lt: today },
      }),
      SiteVisit.countDocuments({ status: "Completed" }),
      SiteVisit.countDocuments({ status: "Cancelled" }),
      SiteVisit.countDocuments({}),
    ]);

  return {
    total,
    activeScheduled: upcoming + todayCount,
    overdueScheduled: overdue,
    upcoming,
    today: todayCount,
    completed,
    cancelled,
  };
}

export async function listVisits(req, res) {
  try {
    const built = buildVisitListFilter(req.query);
    if (built.error) {
      return res.status(400).json({
        success: false,
        message: built.error,
      });
    }

    const [summary, visits] = await Promise.all([
      computeVisitSummary(),
      SiteVisit.find(built.filter).sort({ visitDate: -1, createdAt: -1 }),
    ]);

    return res.json({
      success: true,
      summary,
      visits: visits.map(serializeVisit),
    });
  } catch (error) {
    console.error("listVisits error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch visits",
    });
  }
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

async function mongoSupportsTransactions() {
  const db = mongoose.connection.db;
  if (!db) {
    return false;
  }

  try {
    const hello = await db.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  } catch {
    return false;
  }
}

function validateCreateVisitBody(body) {
  const errors = [];
  const visitDate =
    typeof body.visitDate === "string" ? body.visitDate.trim() : "";
  const slot = typeof body.slot === "string" ? body.slot.trim() : "";
  const executive =
    typeof body.executive === "string" ? body.executive.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!visitDate) {
    errors.push("visitDate is required");
  } else if (!isValidIsoDate(visitDate)) {
    errors.push("visitDate must be in YYYY-MM-DD format");
  } else if (!isVisitDateTodayOrFuture(visitDate)) {
    errors.push("visitDate must be today or a future date");
  }

  if (!slot) {
    errors.push("slot is required");
  } else if (!VISIT_SLOTS.includes(slot)) {
    errors.push(`slot must be one of: ${VISIT_SLOTS.join(", ")}`);
  }

  if (!executive) {
    errors.push("executive is required");
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    data: { visitDate, slot, executive, notes },
  };
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

function buildVisitStatusTimelineEntry(nextStatus, visit, now) {
  const completed = nextStatus === "Completed";
  return {
    kind: "ai",
    title: completed ? "Site visit completed" : "Site visit cancelled",
    detail: `${visit.project} on ${visit.visitDate} at ${visit.slot}.`,
    time: formatTimelineDisplayTime(now),
    at: now,
  };
}

function resolveLeadStatusAfterCancel(lead) {
  if (lead.status !== "Visit booked") {
    return null;
  }

  let restored = lead.statusBeforeVisit;
  if (restored == null || restored === "Visit booked") {
    restored = "Qualified";
  }

  return {
    status: restored,
    statusBeforeVisit: null,
  };
}

async function buildLeadStatusUpdate(visit, nextStatus, now, session) {
  const timelineEntry = buildVisitStatusTimelineEntry(
    nextStatus,
    visit,
    now,
  );
  const update = {
    lastActivityAt: now,
    $push: { timeline: timelineEntry },
  };

  if (nextStatus === "Cancelled") {
    const query = SiteVisit.findOne({
      lead: visit.lead,
      status: "Scheduled",
      _id: { $ne: visit._id },
    }).select("_id");

    if (session) {
      query.session(session);
    }

    const otherScheduled = await query;

    if (!otherScheduled) {
      const leadQuery = Lead.findById(visit.lead);
      if (session) {
        leadQuery.session(session);
      }
      const lead = await leadQuery;
      if (lead) {
        const statusChange = resolveLeadStatusAfterCancel(lead);
        if (statusChange) {
          update.status = statusChange.status;
          update.statusBeforeVisit = statusChange.statusBeforeVisit;
        }
      }
    }
  }

  return update;
}

async function applyVisitStatusUpdate(visitId, nextStatus, session) {
  const now = new Date();
  const queryOptions = session ? { session } : {};

  const visit = await SiteVisit.findById(visitId, null, queryOptions);
  if (!visit) {
    return { notFound: true };
  }

  if (visit.status !== "Scheduled") {
    return {
      conflict: true,
      message: "Only scheduled visits can be updated",
    };
  }

  visit.status = nextStatus;
  visit.statusChangedAt = now;
  await visit.save(queryOptions);

  const leadUpdate = await buildLeadStatusUpdate(visit, nextStatus, now, session);
  await Lead.findByIdAndUpdate(visit.lead, leadUpdate, queryOptions);

  return { visit };
}

async function updateVisitStatusWithTransaction(visitId, nextStatus) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await applyVisitStatusUpdate(visitId, nextStatus, session);
    if (result.notFound || result.conflict) {
      await session.abortTransaction();
      return result;
    }

    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function updateVisitStatusWithoutTransaction(visitId, nextStatus) {
  try {
    return await applyVisitStatusUpdate(visitId, nextStatus, null);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return {
        conflict: true,
        message: "Visit status update conflict",
      };
    }
    throw error;
  }
}

function validateStatusUpdateBody(body) {
  const status =
    typeof body.status === "string" ? body.status.trim() : "";

  if (!status) {
    return { errors: ["status is required"] };
  }

  if (!STATUS_UPDATE_TARGETS.includes(status)) {
    return {
      errors: [`status must be one of: ${STATUS_UPDATE_TARGETS.join(", ")}`],
    };
  }

  return { data: { status } };
}

export async function updateVisitStatus(req, res) {
  try {
    const { id: visitId } = req.params;

    if (!isValidObjectId(visitId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid visit id",
      });
    }

    const validated = validateStatusUpdateBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const existingVisit = await SiteVisit.findById(visitId).select("status");
    if (!existingVisit) {
      return res.status(404).json({
        success: false,
        message: "Visit not found",
      });
    }

    if (existingVisit.status !== "Scheduled") {
      return res.status(409).json({
        success: false,
        message: "Only scheduled visits can be updated",
      });
    }

    const useTransactions = await mongoSupportsTransactions();
    let result;

    if (useTransactions) {
      try {
        result = await updateVisitStatusWithTransaction(
          visitId,
          validated.data.status,
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({
            success: false,
            message: "Visit status update conflict",
          });
        }
        throw error;
      }
    } else {
      result = await updateVisitStatusWithoutTransaction(
        visitId,
        validated.data.status,
      );
    }

    if (result.notFound) {
      return res.status(404).json({
        success: false,
        message: "Visit not found",
      });
    }

    if (result.conflict) {
      return res.status(409).json({
        success: false,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      visit: serializeVisit(result.visit),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("updateVisitStatus error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update visit status",
    });
  }
}

export async function createVisit(req, res) {
  try {
    const { id: leadId } = req.params;

    if (!isValidObjectId(leadId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const validated = validateCreateVisitBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    if (!lead.project) {
      return res.status(400).json({ success: false, message: "A primary project is required for CRM site visit booking" });
    }

    let result;
    try {
      result = await reserveSiteVisit(lead, {
        ...validated.data,
        project: lead.project,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return res.status(409).json({
          success: false,
          message: "Booking conflict: this lead or time slot already has a scheduled visit",
        });
      } else {
        throw error;
      }
    }

    if (result.conflict) {
      return res.status(409).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(201).json({
      success: true,
      visit: serializeVisit(result.visit),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("createVisit error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create site visit booking",
    });
  }
}
