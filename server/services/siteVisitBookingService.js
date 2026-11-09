import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import SiteVisit from "../models/SiteVisit.js";

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

async function mongoSupportsTransactions() {
  const db = mongoose.connection.db;
  if (!db) return false;
  try {
    const hello = await db.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  } catch {
    return false;
  }
}

function buildLeadBookingUpdate(lead, now) {
  const update = { status: "Visit booked", lastActivityAt: now };
  if (lead.statusBeforeVisit == null && lead.status !== "Visit booked") {
    update.statusBeforeVisit = lead.status;
  }
  return update;
}

function buildVisitPayload(lead, data, now) {
  return {
    lead: lead._id,
    buyerName: lead.name,
    project: data.project,
    visitDate: data.visitDate,
    slot: data.slot,
    executive: data.executive,
    notes: data.notes ?? "",
    status: "Scheduled",
    bookedAt: now,
  };
}

async function assertNoBookingConflicts(leadId, project, visitDate, slot) {
  const [leadScheduled, slotTaken] = await Promise.all([
    SiteVisit.findOne({ lead: leadId, status: "Scheduled" }).select("_id"),
    SiteVisit.findOne({ project, visitDate, slot, status: "Scheduled" }).select("_id"),
  ]);
  if (leadScheduled) return { conflict: true, message: "This lead already has a scheduled site visit" };
  if (slotTaken) return { conflict: true, message: "This time slot is already booked for the selected project and date" };
  return { conflict: false };
}

async function statusSyncFailed(visit, error) {
  const persisted = await SiteVisit.findById(visit._id);
  if (persisted?.status === "Scheduled") {
    console.error("site visit persisted but lead status synchronization failed; staff reconciliation required", {
      leadId: String(visit.lead), visitId: String(visit._id), error: error.message,
    });
    return { visit: persisted, statusSyncFailed: true };
  }
  throw error;
}

/** Shared reservation path for CRM and guest booking. The caller controls project/executive policy. */
export async function reserveSiteVisit(lead, data, now = new Date()) {
  const useTransactions = await mongoSupportsTransactions();
  if (useTransactions) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const conflict = await assertNoBookingConflicts(lead._id, data.project, data.visitDate, data.slot);
      if (conflict.conflict) {
        await session.abortTransaction();
        return conflict;
      }
      const [visit] = await SiteVisit.create([buildVisitPayload(lead, data, now)], { session });
      await Lead.findByIdAndUpdate(lead._id, buildLeadBookingUpdate(lead, now), { session });
      await session.commitTransaction();
      return { visit, statusSyncFailed: false };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  const conflict = await assertNoBookingConflicts(lead._id, data.project, data.visitDate, data.slot);
  if (conflict.conflict) return conflict;
  const visit = await SiteVisit.create(buildVisitPayload(lead, data, now));
  try {
    const update = await Lead.findByIdAndUpdate(lead._id, buildLeadBookingUpdate(lead, now));
    if (!update) throw new Error("Lead status update did not match a record");
    return { visit, statusSyncFailed: false };
  } catch (error) {
    return statusSyncFailed(visit, error);
  }
}

export { isDuplicateKeyError };
