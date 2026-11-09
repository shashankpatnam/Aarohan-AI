import { LEAD_PROJECTS } from "../models/Lead.js";
import Lead from "../models/Lead.js";
import SiteVisit, { VISIT_SLOTS } from "../models/SiteVisit.js";
import { isDuplicateKeyError, reserveSiteVisit } from "../services/siteVisitBookingService.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 30; // inclusive range of at most 31 calendar dates

function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function localDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateDistance(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000;
}

function addIsoDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function slotHasElapsed(date, slot, now = new Date()) {
  if (date !== localDateIso(now)) return false;
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(slot);
  if (!match) return true;
  let hour = Number(match[1]) % 12;
  if (match[3] === "PM") hour += 12;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
  const nowMinutes = Number(values.hour) * 60 + Number(values.minute);
  return hour * 60 + Number(match[2]) <= nowMinutes;
}

function publicBookingDto(visit) {
  return {
    id: String(visit._id),
    project: visit.project,
    date: visit.visitDate,
    slot: visit.slot,
    status: visit.status,
    confirmation: `Your site visit to ${visit.project} is confirmed for ${visit.visitDate} at ${visit.slot}.`,
  };
}

function sendInvalid(res, errors) {
  return res.status(400).json({ success: false, code: "invalid_selection", message: "Please select a valid project, date and time slot.", errors });
}

export async function getPublicVisitAvailability(req, res) {
  try {
    if (String(req.guestSession?._id) !== req.params.sessionId) {
      return res.status(401).json({ success: false, code: "invalid_session", message: "Invalid session credentials" });
    }
    if (req.guestSession.contactCaptured !== true || !req.guestSession.leadId) {
      return res.status(422).json({ success: false, code: "contact_required", message: "Please submit your contact details before viewing site visit availability." });
    }
    if (!(await Lead.exists({ _id: req.guestSession.leadId }))) {
      return res.status(409).json({ success: false, code: "lead_unavailable", message: "Your enquiry could not be linked to a lead." });
    }
    const project = typeof req.query.project === "string" ? req.query.project.trim() : "";
    const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
    const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
    const errors = [];
    if (!LEAD_PROJECTS.includes(project)) errors.push(`project must be one of: ${LEAD_PROJECTS.join(", ")}`);
    if (!isValidIsoDate(from)) errors.push("from must be a valid YYYY-MM-DD date");
    if (!isValidIsoDate(to)) errors.push("to must be a valid YYYY-MM-DD date");
    if (!errors.length) {
      const today = localDateIso();
      if (from < today || to < today) errors.push("date range cannot include past dates");
      if (to < from) errors.push("to must be on or after from");
      if (to >= from && dateDistance(from, to) > MAX_RANGE_DAYS) errors.push("date range cannot exceed 31 calendar days");
    }
    if (errors.length) return sendInvalid(res, errors);

    const bookedVisits = await SiteVisit.find({
      project,
      visitDate: { $gte: from, $lte: to },
      status: "Scheduled",
    }).select("visitDate slot").lean();
    const bookedByDate = new Map();
    for (const visit of bookedVisits) {
      if (!bookedByDate.has(visit.visitDate)) bookedByDate.set(visit.visitDate, new Set());
      bookedByDate.get(visit.visitDate).add(visit.slot);
    }

    const availability = [];
    for (let offset = 0; offset <= dateDistance(from, to); offset += 1) {
      const date = addIsoDays(from, offset);
      const booked = bookedByDate.get(date) ?? new Set();
      const slots = VISIT_SLOTS.filter((slot) => !booked.has(slot) && !slotHasElapsed(date, slot));
      if (slots.length) availability.push({ date, slots });
    }
    return res.json({ success: true, project, availability });
  } catch (error) {
    console.error("getPublicVisitAvailability error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch availability" });
  }
}

export async function createPublicVisit(req, res) {
  try {
    const session = req.guestSession;
    if (String(session?._id) !== req.params.sessionId) {
      return res.status(401).json({ success: false, code: "invalid_session", message: "Invalid session credentials" });
    }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return sendInvalid(res, ["request body must be an object"]);
    const unexpected = Object.keys(body).filter((key) => !["project", "date", "slot"].includes(key));
    const project = typeof body.project === "string" ? body.project.trim() : "";
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const slot = typeof body.slot === "string" ? body.slot.trim() : "";
    const errors = [...unexpected.map((key) => `unexpected field: ${key}`)];
    if (!LEAD_PROJECTS.includes(project)) errors.push(`project must be one of: ${LEAD_PROJECTS.join(", ")}`);
    if (!isValidIsoDate(date)) errors.push("date must be a valid YYYY-MM-DD date");
    if (!VISIT_SLOTS.includes(slot)) errors.push(`slot must be one of: ${VISIT_SLOTS.join(", ")}`);
    if (errors.length) return sendInvalid(res, errors);

    if (session.contactCaptured !== true || !session.leadId) {
      return res.status(422).json({ success: false, code: "contact_required", message: "Please submit your contact details before booking a site visit." });
    }
    const lead = await Lead.findById(session.leadId);
    if (!lead) return res.status(409).json({ success: false, code: "lead_unavailable", message: "Your enquiry could not be linked to a lead. Please contact the sales team." });

    const current = await SiteVisit.findOne({ lead: lead._id, status: "Scheduled" });
    if (current) {
      if (current.project === project && current.visitDate === date && current.slot === slot) {
        return res.status(200).json({ success: true, booking: publicBookingDto(current), retry: true });
      }
      return res.status(409).json({ success: false, code: "visit_already_scheduled", message: "A site visit is already scheduled for this enquiry." });
    }

    const today = localDateIso();
    if (date < today || slotHasElapsed(date, slot)) {
      return res.status(400).json({ success: false, code: "invalid_selection", message: "Please select a future date and time slot." });
    }

    const occupied = await SiteVisit.exists({ project, visitDate: date, slot, status: "Scheduled" });
    if (occupied) return res.status(409).json({ success: false, code: "slot_unavailable", message: "That time slot is no longer available. Please choose another." });

    let result;
    try {
      result = await reserveSiteVisit(lead, {
        project,
        visitDate: date,
        slot,
        executive: lead.executive?.trim() || "Unassigned",
        notes: "",
      });
    } catch (error) {
      // A connection/commit error can leave the outcome uncertain. Only report
      // success after finding the exact scheduled record in MongoDB.
      const existing = await SiteVisit.findOne({ lead: lead._id, status: "Scheduled" });
      if (existing && existing.project === project && existing.visitDate === date && existing.slot === slot) {
        return res.status(200).json({ success: true, booking: publicBookingDto(existing), retry: true });
      }
      if (!isDuplicateKeyError(error)) throw error;
      return res.status(409).json({ success: false, code: existing ? "visit_already_scheduled" : "slot_unavailable", message: existing ? "A site visit is already scheduled for this enquiry." : "That time slot is no longer available. Please choose another." });
    }
    if (result.conflict) {
      const existing = await SiteVisit.findOne({ lead: lead._id, status: "Scheduled" });
      if (existing && existing.project === project && existing.visitDate === date && existing.slot === slot) {
        return res.status(200).json({ success: true, booking: publicBookingDto(existing), retry: true });
      }
      return res.status(409).json({ success: false, code: existing ? "visit_already_scheduled" : "slot_unavailable", message: existing ? "A site visit is already scheduled for this enquiry." : "That time slot is no longer available. Please choose another." });
    }

    // Verify persistence before making the buyer-facing confirmation claim.
    const persisted = await SiteVisit.findById(result.visit._id);
    if (!persisted || persisted.status !== "Scheduled") {
      return res.status(503).json({ success: false, code: "booking_unconfirmed", message: "We could not confirm the booking. Please check your visits or contact the sales team before trying again." });
    }
    return res.status(201).json({ success: true, booking: publicBookingDto(persisted) });
  } catch (error) {
    console.error("createPublicVisit error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to process site visit booking" });
  }
}
