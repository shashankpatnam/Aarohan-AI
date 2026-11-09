import { LEAD_PROJECTS } from "../models/Lead.js";
import SiteVisit, { VISIT_SLOTS } from "../models/SiteVisit.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

export async function getAvailability(req, res) {
  try {
    const project =
      typeof req.query.project === "string" ? req.query.project.trim() : "";
    const date =
      typeof req.query.date === "string" ? req.query.date.trim() : "";

    if (!project) {
      return res.status(400).json({
        success: false,
        message: "project query parameter is required",
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date query parameter is required",
      });
    }

    if (!LEAD_PROJECTS.includes(project)) {
      return res.status(400).json({
        success: false,
        message: `Invalid project. Must be one of: ${LEAD_PROJECTS.join(", ")}`,
      });
    }

    if (!isValidIsoDate(date)) {
      return res.status(400).json({
        success: false,
        message: "date must be in YYYY-MM-DD format",
      });
    }

    const scheduledVisits = await SiteVisit.find({
      project,
      visitDate: date,
      status: "Scheduled",
    }).select("slot");

    const bookedSlots = new Set(scheduledVisits.map((visit) => visit.slot));

    const slots = VISIT_SLOTS.map((slot) => ({
      slot,
      booked: bookedSlots.has(slot),
    }));

    return res.json({
      success: true,
      project,
      date,
      slots,
    });
  } catch (error) {
    console.error("getAvailability error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch availability",
    });
  }
}
