import Lead, {
  LEAD_PROJECTS,
  LEAD_SOURCES,
  LEAD_STATUSES,
} from "../models/Lead.js";
import SiteVisit, { VISIT_STATUSES } from "../models/SiteVisit.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BUSINESS_TIME_ZONE = "Asia/Kolkata";

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

function startOfBusinessDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  // Ahmedabad uses UTC+05:30 year round. Build UTC instants explicitly so
  // date filtering does not depend on the server machine's local timezone.
  return new Date(Date.UTC(year, month - 1, day, -5, -30));
}

function endOfBusinessDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, -5, -30) - 1);
}

function parseDateRangeQuery(query) {
  const fromRaw =
    typeof query.from === "string" ? query.from.trim() : "";
  const toRaw = typeof query.to === "string" ? query.to.trim() : "";

  if (!fromRaw && !toRaw) {
    return { data: { from: null, to: null } };
  }

  const errors = [];

  if (fromRaw && !isValidIsoDate(fromRaw)) {
    errors.push("from must be a valid date in YYYY-MM-DD format");
  }
  if (toRaw && !isValidIsoDate(toRaw)) {
    errors.push("to must be a valid date in YYYY-MM-DD format");
  }

  if (errors.length > 0) {
    return { errors };
  }

  const from = fromRaw || null;
  const to = toRaw || null;

  if (from && to && from > to) {
    return { errors: ["from must be on or before to"] };
  }

  return { data: { from, to } };
}

function buildLeadCreatedAtMatch(from, to) {
  if (!from && !to) {
    return {};
  }

  const createdAt = {};
  if (from) {
    createdAt.$gte = startOfBusinessDay(from);
  }
  if (to) {
    createdAt.$lte = endOfBusinessDay(to);
  }

  return { createdAt };
}

function buildVisitDateMatch(from, to) {
  if (!from && !to) {
    return {};
  }

  const visitDate = {};
  if (from) {
    visitDate.$gte = from;
  }
  if (to) {
    visitDate.$lte = to;
  }

  return { visitDate };
}

function todayIsoBusiness() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function withVisitMatch(base, extra) {
  if (!base || Object.keys(base).length === 0) {
    return extra;
  }
  return { $and: [base, extra] };
}

function mapGroupResults(rows) {
  return Object.fromEntries(
    rows.map(({ _id, count }) => [String(_id), count]),
  );
}

function fillEnumCounts(map, enumValues) {
  const known = Object.fromEntries(enumValues.map((key) => [key, map[key] ?? 0]));
  const unexpected = Object.fromEntries(
    Object.entries(map).filter(([key]) => key !== "null" && !enumValues.includes(key)),
  );
  return { ...known, ...unexpected };
}

function toSortedBreakdown(map, nameKey) {
  return Object.entries(map)
    .map(([name, count]) => ({ [nameKey]: name, count }))
    .sort((a, b) => b.count - a.count || a[nameKey].localeCompare(b[nameKey]));
}

async function aggregateLeadGroups(match, groupField) {
  const pipeline = [];
  if (Object.keys(match).length > 0) {
    pipeline.push({ $match: match });
  }
  pipeline.push({
    $group: {
      _id: `$${groupField}`,
      count: { $sum: 1 },
    },
  });

  return Lead.aggregate(pipeline);
}

async function aggregateInterestedProjectGroups(match) {
  const pipeline = [];
  if (Object.keys(match).length > 0) pipeline.push({ $match: match });
  pipeline.push(
    {
      $set: {
        interestedProjects: {
          $setUnion: [{ $ifNull: ["$interestedProjects", []] }, []],
        },
      },
    },
    { $unwind: "$interestedProjects" },
    { $group: { _id: "$interestedProjects", count: { $sum: 1 } } },
  );
  return Lead.aggregate(pipeline);
}

async function aggregateVisitGroups(match, groupField) {
  const pipeline = [];
  if (Object.keys(match).length > 0) {
    pipeline.push({ $match: match });
  }
  pipeline.push({
    $group: {
      _id: `$${groupField}`,
      count: { $sum: 1 },
    },
  });

  return SiteVisit.aggregate(pipeline);
}

export async function getAnalytics(req, res) {
  try {
    const parsed = parseDateRangeQuery(req.query);
    if (parsed.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsed.errors,
      });
    }

    const { from, to } = parsed.data;
    const leadMatch = buildLeadCreatedAtMatch(from, to);
    const visitMatch = buildVisitDateMatch(from, to);
    const today = todayIsoBusiness();

    const [
      leadTotal,
      visitTotal,
      leadByStatusRows,
      leadBySourceRows,
      leadByProjectRows,
      leadByInterestedProjectRows,
      visitByStatusRows,
      visitByProjectRows,
      activeScheduled,
      overdueScheduled,
    ] = await Promise.all([
      Object.keys(leadMatch).length > 0
        ? Lead.countDocuments(leadMatch)
        : Lead.countDocuments(),
      Object.keys(visitMatch).length > 0
        ? SiteVisit.countDocuments(visitMatch)
        : SiteVisit.countDocuments(),
      aggregateLeadGroups(leadMatch, "status"),
      aggregateLeadGroups(leadMatch, "source"),
      aggregateLeadGroups(leadMatch, "project"),
      aggregateInterestedProjectGroups(leadMatch),
      aggregateVisitGroups(visitMatch, "status"),
      aggregateVisitGroups(visitMatch, "project"),
      SiteVisit.countDocuments(
        withVisitMatch(visitMatch, {
          status: "Scheduled",
          visitDate: { $gte: today },
        }),
      ),
      SiteVisit.countDocuments(
        withVisitMatch(visitMatch, {
          status: "Scheduled",
          visitDate: { $lt: today },
        }),
      ),
    ]);

    const leadStatusMap = mapGroupResults(leadByStatusRows);
    const leadSourceMap = mapGroupResults(leadBySourceRows);
    const leadProjectMap = mapGroupResults(leadByProjectRows);
    const leadInterestedProjectMap = mapGroupResults(leadByInterestedProjectRows);
    const visitStatusMap = mapGroupResults(visitByStatusRows);
    const visitProjectMap = mapGroupResults(visitByProjectRows);
    const primaryProjectBreakdown = toSortedBreakdown(
      fillEnumCounts(leadProjectMap, LEAD_PROJECTS),
      "project",
    );
    const generalInquiryCount = leadProjectMap.null ?? 0;

    return res.json({
      success: true,
      filters: {
        from,
        to,
        businessTimeZone: BUSINESS_TIME_ZONE,
        leadDateField: "createdAt",
        leadDateDescription:
          "Lead metrics count enquiries by creation date (Asia/Kolkata calendar days).",
        visitDateField: "visitDate",
        visitDateDescription:
          "Visit metrics count site visits by scheduled visit date (YYYY-MM-DD on the visit record); today's date uses Asia/Kolkata. Active scheduled excludes cancelled, completed, and past-due Scheduled rows.",
      },
      leads: {
        totalInRange: leadTotal,
        totalUniqueLeads: leadTotal,
        generalInquiryCount,
        byStatus: fillEnumCounts(leadStatusMap, LEAD_STATUSES),
        bySource: toSortedBreakdown(
          fillEnumCounts(leadSourceMap, LEAD_SOURCES),
          "source",
        ),
        byProject: primaryProjectBreakdown,
        byPrimaryProject: primaryProjectBreakdown,
        byInterestedProject: toSortedBreakdown(
          fillEnumCounts(leadInterestedProjectMap, LEAD_PROJECTS),
          "project",
        ),
      },
      visits: {
        totalInRange: visitTotal,
        counts: {
          total: visitTotal,
          activeScheduled,
          overdueScheduled,
          completed: visitStatusMap.Completed ?? 0,
          cancelled: visitStatusMap.Cancelled ?? 0,
        },
        byStatus: fillEnumCounts(visitStatusMap, VISIT_STATUSES),
        byProject: toSortedBreakdown(
          fillEnumCounts(visitProjectMap, LEAD_PROJECTS),
          "project",
        ),
      },
    });
  } catch (error) {
    console.error("getAnalytics error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch analytics",
    });
  }
}
