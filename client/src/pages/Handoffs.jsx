import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, assignHandoff, fetchEligibleStaff, fetchHandoffs, resolveHandoff } from "../services/api.js";
import { CheckCircle2, HandHelping, Loader2, RefreshCw, UserRound, Users } from "lucide-react";
import ProjectLabel from "../components/crm/ProjectLabel.jsx";

const PAGE_SIZE = 50;
const EMPTY_SUMMARY = { pending: 0, assigned: 0, resolved: 0 };
const TABS = [
  { id: "open", label: "Open Queue", count: (s) => s.pending + s.assigned },
  { id: "pending", label: "Pending", count: (s) => s.pending },
  { id: "assigned", label: "Assigned", count: (s) => s.assigned },
  { id: "resolved", label: "Resolved", count: (s) => s.resolved },
];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function formatAge(value) {
  const then = new Date(value).getTime();
  if (!value || Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusBadge({ status }) {
  const palette = {
    Pending: "bg-amber-50 text-amber-800 ring-amber-600/15",
    Assigned: "bg-violet-50 text-violet-800 ring-violet-600/10",
    Resolved: "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15",
  }[status] ?? "bg-gray-50 text-gray-700 ring-gray-600/10";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${palette}`}>{status}</span>;
}

function SummaryCard({ label, value, icon: Icon }) {
  return <article className="flex min-w-0 items-center gap-3 rounded-xl border border-gray-200/80 bg-white px-3 py-2.5 shadow-sm sm:px-4">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EDF3EE] text-[#42634F]"><Icon size={17} /></span>
    <div className="min-w-0"><p className="truncate text-xs font-medium text-gray-500 sm:text-sm">{label}</p><p className="text-xl font-semibold leading-tight text-gray-900">{value.toLocaleString()}</p></div>
  </article>;
}

function HandoffCard({ item, staff, busy, onAssign, onResolve }) {
  const [selectedStaff, setSelectedStaff] = useState("");
  const isResolved = item.handoffStatus === "Resolved";
  const isCallback = item.handoffType === "buyer_callback";
  const aiReason = item.handoffAiReason?.trim() || "";
  const reason = item.handoffReason?.trim() || "";
  const buyerReason = isCallback && reason && reason !== aiReason ? reason : "";
  const prominentReason = isCallback ? "Buyer requested a callback" : aiReason || reason || "Human follow-up recommended";
  const canAssign = !isResolved;

  return <li className="grid min-w-0 gap-4 p-3 sm:p-4 xl:grid-cols-[minmax(13rem,0.9fr)_minmax(18rem,1.4fr)_minmax(14rem,0.9fr)] xl:items-start">
    <section className="min-w-0" aria-label="Buyer identity">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/leads/${item.leadId}`} className="break-words text-sm font-semibold text-gray-900 hover:text-[#42634F]">{item.buyerName || "Unnamed buyer"}</Link>
        <StatusBadge status={item.handoffStatus} />
      </div>
      <div className="mt-1.5 flex min-w-0 flex-col gap-1 text-xs text-gray-600">
        {item.phone ? <a href={`tel:${item.phone}`} className="w-fit font-medium text-[#42634F] hover:underline">{item.phone}</a> : <span className="text-gray-400">Phone not provided</span>}
        {item.email ? <a href={`mailto:${item.email}`} className="max-w-full break-all hover:text-[#42634F]">{item.email}</a> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <ProjectLabel project={item.project} label={item.projectLabel} className="py-0.5" />
        <span className="text-gray-500">{item.leadStatus || "Unknown lead status"}</span>
      </div>
      <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${isCallback ? "bg-sky-50 text-sky-800" : "bg-gray-100 text-gray-700"}`}>{isCallback ? "Buyer callback" : "AI handoff"}</span>
    </section>

    <section className="min-w-0" aria-label="Handoff reason">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Why they need help</p>
      <p className="mt-1 break-words text-sm font-medium leading-relaxed text-gray-900">{prominentReason}</p>
      {isCallback && aiReason ? <p className="mt-1 text-xs leading-relaxed text-gray-600"><span className="font-medium">AI handoff reason: </span>{aiReason}</p> : null}
      {buyerReason ? <p className="mt-1 text-xs leading-relaxed text-gray-600"><span className="font-medium">Callback reason: </span>{buyerReason}</p> : null}
      {isCallback && item.handoffCallbackNote?.trim() ? <p className="mt-2 break-words rounded-lg bg-[#FAFAF8] px-2.5 py-2 text-xs leading-relaxed text-gray-700"><span className="font-semibold text-gray-500">Buyer note: </span>{item.handoffCallbackNote}</p> : null}
      {isCallback && item.handoffPreferredContactMethod ? <p className="mt-2 text-xs text-gray-600">Preferred contact: <span className="font-medium capitalize text-gray-800">{item.handoffPreferredContactMethod}</span></p> : null}
    </section>

    <section className="min-w-0 border-t border-gray-100 pt-3 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0" aria-label="Handoff activity and actions">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>Requested {formatDate(item.handoffRequestedAt)}{formatAge(item.handoffRequestedAt) ? ` · ${formatAge(item.handoffRequestedAt)}` : ""}</span>
        {item.lastActivity ? <span>Activity {item.lastActivity}</span> : null}
        {item.initialProject ? <span>Initial: {item.initialProject}</span> : null}
      </div>
      {item.interestedProjects?.length ? <div className="mt-2 flex flex-wrap gap-1">{item.interestedProjects.map((project) => <span key={project} className="rounded-full bg-[#EDF3EE] px-2 py-0.5 text-[10px] font-medium text-[#42634F]">{project}</span>)}</div> : null}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-700"><UserRound size={14} className="text-gray-400" />{item.executive?.trim() && item.executive !== "Unassigned" ? item.executive : "Unassigned"}</p>
      {isResolved ? <p className="mt-1 text-xs text-gray-500">Resolved {formatDate(item.handoffResolvedAt)}</p> : null}
      {canAssign ? <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`assign-${item.leadId}`}>{item.executive && item.executive !== "Unassigned" ? "Reassign executive" : "Assign executive"}</label>
        <select id={`assign-${item.leadId}`} value={selectedStaff} onChange={(event) => setSelectedStaff(event.target.value)} disabled={busy || staff.length === 0} className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-700 outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15">
          <option value="">{item.executive && item.executive !== "Unassigned" ? `Assigned: ${item.executive}` : "Choose executive"}</option>
          {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
        <button type="button" disabled={busy || !selectedStaff} onClick={() => onAssign(item.leadId, selectedStaff)} className="h-9 rounded-lg border border-[#527A65]/25 px-3 text-xs font-semibold text-[#42634F] hover:bg-[#EDF3EE] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Saving…" : item.handoffStatus === "Assigned" ? "Reassign" : "Assign"}</button>
        <button type="button" disabled={busy} onClick={() => onResolve(item.leadId)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#527A65] px-3 text-xs font-semibold text-white hover:bg-[#42634F] disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Resolve</button>
      </div> : null}
      {canAssign && staff.length === 0 ? <p className="mt-2 text-xs text-amber-800">No active staff accounts are available for assignment.</p> : null}
    </section>
  </li>;
}

function Handoffs() {
  const [tab, setTab] = useState("open");
  const [page, setPage] = useState(1);
  const [handoffs, setHandoffs] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 });
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [pendingActionId, setPendingActionId] = useState("");

  const loadHandoffs = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchHandoffs({ status: tab, page, pageSize: PAGE_SIZE });
      setHandoffs(data.handoffs ?? []);
      setSummary(data.summary ?? EMPTY_SUMMARY);
      setPagination(data.pagination ?? { page, pageSize: PAGE_SIZE, total: data.handoffs?.length ?? 0, totalPages: 1 });
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "Could not load handoffs. Check that the API server is running.");
      setHandoffs([]);
      setPagination({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 });
    } finally { setLoading(false); }
  }, [tab, page]);

  useEffect(() => {
    const timer = window.setTimeout(loadHandoffs, 0);
    return () => window.clearTimeout(timer);
  }, [loadHandoffs]);
  useEffect(() => {
    let active = true;
    fetchEligibleStaff().then((data) => { if (active) setStaff(data.staff ?? []); }).catch(() => { if (active) setStaff([]); });
    return () => { active = false; };
  }, []);

  async function handleAssign(leadId, executiveId) {
    setPendingActionId(leadId); setActionError(""); setSuccessMessage("");
    try {
      const person = staff.find((entry) => entry.id === executiveId);
      await assignHandoff(leadId, executiveId);
      setSuccessMessage(`Handoff assigned to ${person?.name ?? "staff member"}.`);
      if (tab === "pending" && pagination.total === 1 && page > 1) setPage((current) => current - 1);
      else await loadHandoffs();
    } catch (error) { setActionError(error instanceof ApiError ? error.message : "Could not assign handoff."); }
    finally { setPendingActionId(""); }
  }

  async function handleResolve(leadId) {
    if (!window.confirm("Mark this handoff as resolved?")) return;
    setPendingActionId(leadId); setActionError(""); setSuccessMessage("");
    try {
      await resolveHandoff(leadId);
      setSuccessMessage("Handoff marked as resolved.");
      if (tab !== "resolved" && pagination.total === 1 && page > 1) setPage((current) => current - 1);
      else await loadHandoffs();
    } catch (error) { setActionError(error instanceof ApiError ? error.message : "Could not resolve handoff."); }
    finally { setPendingActionId(""); }
  }

  function changeTab(nextTab) { if (nextTab === tab) return; setPage(1); setTab(nextTab); }

  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden sm:gap-4">
    <header className="shrink-0">
      <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">Human handoff</h1>
      <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Understand the request, contact the buyer, assign an executive and close the loop.</p>
    </header>

    <section className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3" aria-label="Handoff statistics">
      <SummaryCard label="Pending" value={summary.pending} icon={HandHelping} />
      <SummaryCard label="Assigned" value={summary.assigned} icon={Users} />
      <SummaryCard label="Resolved" value={summary.resolved} icon={CheckCircle2} />
    </section>

    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200" aria-label="Handoff queues">
      {TABS.map((item) => <button key={item.id} type="button" onClick={() => changeTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium sm:text-sm ${tab === item.id ? "border-[#527A65] text-[#42634F]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
        {item.label}<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === item.id ? "bg-[#EDF3EE] text-[#42634F]" : "bg-gray-100 text-gray-500"}`}>{item.count(summary).toLocaleString()}</span>
      </button>)}
    </nav>

    {successMessage ? <p role="status" className="shrink-0 rounded-lg border border-[#527A65]/20 bg-[#EDF3EE] px-3 py-2 text-xs text-[#42634F]">{successMessage}</p> : null}
    {actionError ? <p role="alert" className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p> : null}

    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm" aria-label={`${tab} handoffs`}>
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2.5 sm:px-4">
        <p className="text-xs font-medium text-gray-600">{pagination.total.toLocaleString()} request{pagination.total === 1 ? "" : "s"}</p>
        <button type="button" onClick={loadHandoffs} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"><RefreshCw size={13} className={loading ? "animate-spin" : ""} />Refresh</button>
      </div>
      {loadError ? <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4" role="alert"><p className="text-sm font-medium text-red-800">Could not load handoffs</p><p className="mt-1 text-xs text-red-700">{loadError}</p><button type="button" onClick={loadHandoffs} className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-800">Try again</button></div>
      : loading ? <div className="grid flex-1 place-items-center"><p className="text-sm text-gray-500">Loading handoffs…</p></div>
      : handoffs.length === 0 ? <div className="grid flex-1 place-items-center px-4 text-center"><div><HandHelping size={30} className="mx-auto text-[#527A65]/60" strokeWidth={1.5} /><p className="mt-3 text-sm font-medium text-gray-800">No handoff requests in this queue.</p></div></div>
      : <><ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto overflow-x-hidden">{handoffs.map((item) => <HandoffCard key={item.leadId} item={item} staff={staff} busy={pendingActionId === item.leadId} onAssign={handleAssign} onResolve={handleResolve} />)}</ul>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-3 py-2.5 text-xs text-gray-500 sm:px-4">
          <span>Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span>
          <div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-40">Previous</button><button type="button" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-40">Next</button></div>
        </div></>}
    </section>
  </div>;
}

export default Handoffs;
