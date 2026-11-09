import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  fetchAnalytics,
  fetchLeads,
  fetchVisits,
} from "../services/api.js";
import {
  ArrowUpRight,
  CalendarCheck,
  MapPin,
  UserCheck,
  Users,
} from "lucide-react";
import ProjectLabel from "../components/crm/ProjectLabel.jsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const RANGE_PRESETS = [
  { id: "all", label: "All time" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "quarter", label: "This quarter" },
];

const FUNNEL_FILLS = ["#527A65", "#6B8F7A", "#849F8F", "#42634F"];

const SLOT_ORDER = {
  "10:00 AM": 0,
  "11:30 AM": 1,
  "2:00 PM": 2,
  "3:30 PM": 3,
  "4:30 PM": 4,
};

const STATUS_STYLES = {
  New: "bg-sky-50 text-sky-700 ring-sky-600/10",
  Contacted: "bg-amber-50 text-amber-800 ring-amber-600/10",
  Qualified: "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15",
  "Visit booked": "bg-violet-50 text-violet-800 ring-violet-600/10",
};

function isoDateFromParts(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIsoLocal() {
  return isoDateFromParts(new Date());
}

function isoDateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return isoDateFromParts(date);
}

function thisQuarterRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  return { from: isoDateFromParts(from), to: todayIsoLocal() };
}

function rangeToQuery(rangeId) {
  if (rangeId === "7") {
    return { from: isoDateOffset(-6), to: todayIsoLocal() };
  }
  if (rangeId === "30") {
    return { from: isoDateOffset(-29), to: todayIsoLocal() };
  }
  if (rangeId === "quarter") {
    return thisQuarterRange();
  }
  return {};
}

function tomorrowIsoLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatUpcomingDateTime(visitDate, slot) {
  const today = todayIsoLocal();
  const tomorrow = tomorrowIsoLocal();

  if (visitDate === today) {
    return `Today · ${slot}`;
  }
  if (visitDate === tomorrow) {
    return `Tomorrow · ${slot}`;
  }

  const parsed = new Date(`${visitDate}T12:00:00`);
  const dateLabel = parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${dateLabel} · ${slot}`;
}

function sortUpcomingVisits(visits) {
  return [...visits]
    .filter((visit) => visit.status === "Scheduled")
    .sort((a, b) => {
      const dateCompare = a.visitDate.localeCompare(b.visitDate);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return (SLOT_ORDER[a.slot] ?? 99) - (SLOT_ORDER[b.slot] ?? 99);
    })
    .slice(0, 4)
    .map((visit) => ({
      id: visit.id,
      buyer: visit.buyer,
      project: visit.project,
      executive: visit.executive,
      datetime: formatUpcomingDateTime(visit.visitDate, visit.slot),
    }));
}

function StatusBadge({ status }) {
  const styles = STATUS_STYLES[status] ?? "bg-gray-50 text-gray-700 ring-gray-600/10";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {status}
    </span>
  );
}

function FunnelTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { stage, count } = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs text-gray-500">{stage}</p>
      <p className="text-sm font-semibold text-gray-900">
        {count.toLocaleString()}
      </p>
    </div>
  );
}

function Dashboard() {
  const [rangeId, setRangeId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [leadMetrics, setLeadMetrics] = useState({
    total: 0,
    generalInquiry: 0,
    new: 0,
    contacted: 0,
    qualified: 0,
    visitBooked: 0,
  });
  const [visitMetrics, setVisitMetrics] = useState({
    activeScheduled: 0,
    completed: 0,
    cancelled: 0,
  });
  const [recentLeads, setRecentLeads] = useState([]);
  const [upcomingVisits, setUpcomingVisits] = useState([]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const query = rangeToQuery(rangeId);
      const [analyticsData, leadsData, visitsData] = await Promise.all([
        fetchAnalytics(query),
        fetchLeads(),
        fetchVisits({ date: "upcoming" }),
      ]);

      const byStatus = analyticsData.leads?.byStatus ?? {};
      setLeadMetrics({
        total: analyticsData.leads?.totalUniqueLeads ?? analyticsData.leads?.totalInRange ?? 0,
        generalInquiry: analyticsData.leads?.generalInquiryCount ?? 0,
        new: byStatus.New ?? 0,
        contacted: byStatus.Contacted ?? 0,
        qualified: byStatus.Qualified ?? 0,
        visitBooked: byStatus["Visit booked"] ?? 0,
      });

      const visitSummary = visitsData.summary ?? {};
      setVisitMetrics({
        activeScheduled:
          visitSummary.activeScheduled ??
          (visitSummary.upcoming ?? 0) + (visitSummary.today ?? 0),
        completed: visitSummary.completed ?? 0,
        cancelled: visitSummary.cancelled ?? 0,
      });
      setRecentLeads((leadsData.leads ?? []).slice(0, 5));
      setUpcomingVisits(sortUpcomingVisits(visitsData.visits ?? []));
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load dashboard data. Check that the API server is running.";
      setLoadError(message);
      setLeadMetrics({
        total: 0,
        generalInquiry: 0,
        new: 0,
        contacted: 0,
        qualified: 0,
        visitBooked: 0,
      });
      setVisitMetrics({ activeScheduled: 0, completed: 0, cancelled: 0 });
      setRecentLeads([]);
      setUpcomingVisits([]);
    } finally {
      setLoading(false);
    }
  }, [rangeId]);

  useEffect(() => {
    const timer = window.setTimeout(loadDashboard, 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const kpiCards = useMemo(
    () => [
      {
        label: "Total unique leads",
        value: leadMetrics.total,
        icon: Users,
      },
      {
        label: "General Inquiry leads",
        value: leadMetrics.generalInquiry,
        icon: Users,
      },
      {
        label: "Qualified leads",
        value: leadMetrics.qualified,
        icon: UserCheck,
      },
      {
        label: "Active scheduled visits",
        value: visitMetrics.activeScheduled,
        icon: CalendarCheck,
      },
    ],
    [leadMetrics, visitMetrics],
  );

  const funnelData = useMemo(
    () => [
      { stage: "All leads", count: leadMetrics.total, fill: FUNNEL_FILLS[0] },
      { stage: "New", count: leadMetrics.new, fill: FUNNEL_FILLS[1] },
      { stage: "Qualified", count: leadMetrics.qualified, fill: FUNNEL_FILLS[2] },
      {
        stage: "Visit booked",
        count: leadMetrics.visitBooked,
        fill: FUNNEL_FILLS[3],
      },
    ],
    [leadMetrics],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Overview
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Your property sales at a glance.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {RANGE_PRESETS.map((range) => {
            const selected = rangeId === range.id;
            return (
              <button
                key={range.id}
                type="button"
                onClick={() => setRangeId(range.id)}
                aria-pressed={selected}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  selected
                    ? "border-[#527A65]/40 bg-[#EDF3EE] text-[#42634F]"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-800">
            Could not load dashboard
          </p>
          <p className="mt-1 text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={loadDashboard}
            className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50"
          >
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-200/80 bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-sm text-gray-500">Loading dashboard…</p>
        </div>
      ) : loadError ? null : (
        <>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpiCards.map(({ label, value, icon: Icon }) => (
              <article
                key={label}
                className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-gray-900/[0.02]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-gray-500">{label}</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">
                      {value.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FAFAF8] text-[#527A65]">
                    <Icon size={17} strokeWidth={1.75} />
                  </div>
                </div>
                {label === "Active scheduled visits" ? (
                  <p className="mt-2 text-xs text-gray-500">
                    Completed {visitMetrics.completed.toLocaleString()} ·
                    Cancelled {visitMetrics.cancelled.toLocaleString()}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-gray-400">
                    {label === "Total unique leads" ? "Unique leads created in the selected date range" : "Filtered by enquiry created date"}
                  </p>
                )}
              </article>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-gray-900/[0.02]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Lead status breakdown
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Current status of leads created in the selected range —
                    leads may skip stages
                  </p>
                </div>
              </div>
              <div className="h-[210px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={funnelData}
                    layout="vertical"
                    margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="#E5E7EB"
                    />
                    <XAxis
                      type="number"
                      tick={{ fill: "#9CA3AF", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      width={100}
                      tick={{ fill: "#4B5563", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={<FunnelTooltip />}
                      cursor={{ fill: "#FAFAF8" }}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={28}>
                      {funnelData.map((entry) => (
                        <Cell key={entry.stage} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-gray-900/[0.02]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Upcoming site visits
                  </h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Scheduled tours for today or later
                  </p>
                </div>
                <MapPin size={18} className="text-[#527A65]" strokeWidth={1.75} />
              </div>
              {upcomingVisits.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  No upcoming scheduled visits.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {upcomingVisits.map((visit) => (
                    <li
                      key={visit.id}
                      className="flex gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FAFAF8] text-[#527A65]">
                        <CalendarCheck size={17} strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {visit.buyer}
                        </p>
                        <p className="truncate text-sm text-gray-500">
                          {visit.project}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          {visit.datetime}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 sm:hidden">
                          {visit.executive}
                        </p>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <p className="text-xs text-gray-400">Executive</p>
                        <p className="text-sm font-medium text-gray-700">
                          {visit.executive}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-gray-200/80 bg-white shadow-sm shadow-gray-900/[0.02]">
            <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Recent enquiries
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  Latest inbound lead activity
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/leads"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  View all leads
                  <ArrowUpRight size={16} />
                </Link>
                <Link
                  to="/visits"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#527A65] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#42634F]"
                >
                  Manage visits
                </Link>
              </div>
            </div>

            <div className="overflow-x-auto">
              {recentLeads.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-gray-500">
                  No leads yet. Add enquiries from the Leads page.
                </p>
              ) : (
                <table className="min-w-[820px] w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-[#FAFAF8]/80">
                      <th className="px-5 py-3 font-medium text-gray-500">
                        Name
                      </th>
                      <th className="px-4 py-2.5 font-medium text-gray-500">
                        Project / Interest
                      </th>
                      <th className="px-4 py-2.5 font-medium text-gray-500">
                        Visit project
                      </th>
                      <th className="px-4 py-2.5 font-medium text-gray-500">
                        Source
                      </th>
                      <th className="px-4 py-2.5 font-medium text-gray-500">
                        Status
                      </th>
                      <th className="px-4 py-2.5 font-medium text-gray-500">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recentLeads.map((row) => (
                      <tr key={row.id} className="hover:bg-[#FAFAF8]/50">
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-900">
                          {row.name}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                          <ProjectLabel project={row.project} label={row.projectLabel} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                          {row.visitProject || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                          {row.source}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-400">
                          {row.lastActivity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default Dashboard;
