import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, fetchAnalytics } from "../services/api.js";
import { getBusinessDateRange } from "../utils/analyticsDateRange.js";
import { Calendar, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LEAD_STATUS_ORDER = ["New", "Contacted", "Qualified", "Visit booked"];
const VISIT_STATUS_ORDER = ["Scheduled", "Completed", "Cancelled"];
const SOURCES = ["99acres", "MagicBricks", "Website", "Referral", "Housing.com"];
const LEAD_STATUS_COLORS = {
  New: "#0ea5e9",
  Contacted: "#f59e0b",
  Qualified: "#527A65",
  "Visit booked": "#7c3aed",
};
const VISIT_STATUS_COLORS = {
  Scheduled: "#7c3aed",
  Completed: "#527A65",
  Cancelled: "#9ca3af",
};

function formatRangeLabel(from, to) {
  if (!from && !to) return "All time";
  if (from && to) return `${from} to ${to}`;
  return from ? `From ${from}` : `Through ${to}`;
}

function breakdownToChartData(breakdown, order, labelKey) {
  const entries = Array.isArray(breakdown)
    ? Object.fromEntries(breakdown.map((row) => [row[labelKey], row.count]))
    : breakdown;
  const known = order.map((name) => ({ [labelKey]: name, count: entries[name] ?? 0 }));
  const extras = Object.entries(entries)
    .filter(([name]) => !order.includes(name))
    .map(([name, count]) => ({ [labelKey]: name, count }));
  return [...known, ...extras];
}

function hasAnyCount(rows) {
  return rows.some((row) => row.count > 0);
}

function ChartTooltip({ active, payload, labelKey }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs text-gray-500">{row[labelKey]}</p>
      <p className="text-sm font-semibold text-gray-900">{row.count.toLocaleString()}</p>
    </div>
  );
}

function SectionCard({ title, subtitle, children, emptyMessage }) {
  return (
    <section className="min-w-0 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-gray-900/[0.02] sm:p-5">
      <div className="mb-2">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      </div>
      {children ?? <p className="py-8 text-center text-sm text-gray-500">{emptyMessage}</p>}
    </section>
  );
}

function Analytics() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadAnalytics = useCallback(async (from, to) => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await fetchAnalytics({ from: from || undefined, to: to || undefined }));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "Could not load analytics. Check that the API server is running.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadAnalytics(appliedFrom, appliedTo), 0);
    return () => window.clearTimeout(timer);
  }, [appliedFrom, appliedTo, loadAnalytics]);

  function applyRange(from, to) {
    setFromDate(from);
    setToDate(to);
    setAppliedFrom(from);
    setAppliedTo(to);
  }

  function handleApplyCustomRange(event) {
    event.preventDefault();
    setAppliedFrom(fromDate.trim());
    setAppliedTo(toDate.trim());
  }

  const makeChartRows = (rows, key) => (rows ?? []).map((row) => ({ [key]: row[key], count: row.count }));
  const leadStatusChart = useMemo(() => breakdownToChartData(data?.leads?.byStatus ?? {}, LEAD_STATUS_ORDER, "status"), [data]);
  const leadSourceChart = useMemo(() => breakdownToChartData(data?.leads?.bySource ?? [], SOURCES, "source"), [data]);
  const leadProjectChart = useMemo(() => makeChartRows(data?.leads?.byPrimaryProject ?? data?.leads?.byProject, "project"), [data]);
  const interestedProjectChart = useMemo(() => makeChartRows(data?.leads?.byInterestedProject, "project"), [data]);
  const visitStatusChart = useMemo(() => breakdownToChartData(data?.visits?.byStatus ?? {}, VISIT_STATUS_ORDER, "status"), [data]);
  const visitProjectChart = useMemo(() => makeChartRows(data?.visits?.byProject, "project"), [data]);
  const rangeLabel = formatRangeLabel(appliedFrom, appliedTo);
  const isEmptyRange = data && data.leads.totalInRange === 0 && data.visits.totalInRange === 0;

  function renderChart(rows, labelKey, { vertical = false, colors = {}, color = "#6B8F7A", barSize = 18 } = {}) {
    const chartAreaStyle = { height: "clamp(220px, 24vw, 290px)", minHeight: "220px", width: "100%" };
    if (!hasAnyCount(rows)) {
      return (
        <div className="flex w-full items-center justify-center text-sm text-gray-500" style={chartAreaStyle}>
          No data available for this date range.
        </div>
      );
    }
    return (
      <div className="block w-full min-w-0" style={chartAreaStyle}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey={labelKey} width={vertical ? 94 : 154} tick={{ fontSize: 11 }} />
            <Tooltip content={<ChartTooltip labelKey={labelKey} />} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={barSize} isAnimationActive={false}>
              {rows.map((row) => <Cell key={row[labelKey]} fill={colors[row[labelKey]] ?? color} />)}
              <LabelList dataKey="count" position="right" className="fill-gray-600 text-[10px]" formatter={(value) => value > 0 ? value : ""} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-[1.625rem]">Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">Snapshot counts; status charts show current distribution, not conversion rates.</p>
        </div>
        <p className="text-sm font-medium text-[#42634F]">{rangeLabel}</p>
      </header>

      <section className="rounded-xl border border-gray-200/80 bg-white p-3 shadow-sm shadow-gray-900/[0.02] sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <form onSubmit={handleApplyCustomRange} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <label htmlFor="analytics-from" className="text-xs font-medium text-gray-500">From
              <input id="analytics-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 sm:w-auto" />
            </label>
            <label htmlFor="analytics-to" className="text-xs font-medium text-gray-500">To
              <input id="analytics-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 sm:w-auto" />
            </label>
            <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#527A65] px-4 py-2 text-sm font-medium text-white hover:bg-[#42634F]"><Calendar size={16} />Apply range</button>
          </form>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => applyRange("", "")} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">All time</button>
            <button type="button" onClick={() => { const range = getBusinessDateRange(7); applyRange(range.from, range.to); }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Last 7 days</button>
            <button type="button" onClick={() => { const range = getBusinessDateRange(30); applyRange(range.from, range.to); }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Last 30 days</button>
          </div>
        </div>
        <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500">Lead metrics: enquiry creation date · Visit metrics: scheduled visit date · Business timezone: Asia/Kolkata</p>
      </section>

      {loadError && <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4"><p className="text-sm font-medium text-red-800">Could not load analytics</p><p className="mt-1 text-sm text-red-700">{loadError}</p><button type="button" onClick={() => loadAnalytics(appliedFrom, appliedTo)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50"><RefreshCw size={16} />Try again</button></div>}

      {loading ? <div className="rounded-xl border border-gray-200/80 bg-white px-6 py-12 text-center shadow-sm"><p className="text-sm text-gray-500">Loading analytics…</p></div>
        : loadError ? null
          : isEmptyRange ? <div className="rounded-xl border border-gray-200/80 bg-white px-6 py-12 text-center shadow-sm"><p className="text-sm font-medium text-gray-800">No data in this range</p><p className="mt-2 text-sm text-gray-500">No leads were created and no visits fall on dates within {rangeLabel.toLowerCase()}. Try a wider range or all time.</p></div>
            : <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
                <KpiCard label="Total leads" value={data.leads.totalUniqueLeads ?? data.leads.totalInRange} />
                <KpiCard label="General Inquiry" value={data.leads.generalInquiryCount ?? 0} accent />
                <KpiCard label="Total visits" value={data.visits.counts?.total ?? data.visits.totalInRange} />
                <KpiCard label="Active scheduled" value={data.visits.counts?.activeScheduled ?? 0} />
                <KpiCard label="Overdue scheduled" value={data.visits.counts?.overdueScheduled ?? 0} overdue />
                <KpiCard label="Completed" value={data.visits.counts?.completed ?? data.visits.byStatus?.Completed ?? 0} />
                <KpiCard label="Cancelled" value={data.visits.counts?.cancelled ?? data.visits.byStatus?.Cancelled ?? 0} />
              </div>
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-gray-900">Lead Insights</h2>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <SectionCard title="Leads by status" subtitle="Current status of leads created in range" emptyMessage="No data available for this date range.">{renderChart(leadStatusChart, "status", { vertical: true, colors: LEAD_STATUS_COLORS })}</SectionCard>
                  <SectionCard title="Leads by source" subtitle="Enquiry source for leads created in range" emptyMessage="No data available for this date range.">{renderChart(leadSourceChart, "source", { color: "#42634F" })}</SectionCard>
                  <SectionCard title="Leads by primary project" subtitle="General Inquiry leads are counted separately" emptyMessage="No data available for this date range.">{renderChart(leadProjectChart, "project")}</SectionCard>
                  <SectionCard title="Leads by interested project" subtitle="Non-exclusive: a lead can appear in multiple project groups" emptyMessage="No data available for this date range.">{renderChart(interestedProjectChart, "project", { color: "#527A65" })}</SectionCard>
                </div>
              </section>
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-gray-900">Site Visit Insights</h2>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <SectionCard title="Site visits by status" subtitle="Visit records whose scheduled date falls in range" emptyMessage="No data available for this date range.">{renderChart(visitStatusChart, "status", { vertical: true, colors: VISIT_STATUS_COLORS })}</SectionCard>
                  <SectionCard title="Site visits by project" subtitle="Grouped by project on the visit record" emptyMessage="No data available for this date range.">{renderChart(visitProjectChart, "project")}</SectionCard>
                </div>
              </section>
            </>}
    </div>
  );
}

function KpiCard({ label, value, accent = false, overdue = false }) {
  const style = overdue
    ? "border-amber-200 bg-amber-50/70 text-amber-900"
    : accent ? "border-[#527A65]/15 bg-[#F6F9F6] text-[#42634F]" : "border-gray-200/80 bg-white text-gray-900";
  return <article className={`min-w-0 rounded-xl border p-3 shadow-sm sm:p-4 ${style}`}><p className="text-xs font-medium opacity-80 sm:text-sm">{label}</p><p className="mt-1.5 text-2xl font-semibold">{Number(value ?? 0).toLocaleString()}</p></article>;
}

export default Analytics;
