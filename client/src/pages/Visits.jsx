import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import FloatingMenu from "../components/ui/FloatingMenu.jsx";
import {
  ApiError,
  fetchVisits,
  updateVisitStatus as updateVisitStatusApi,
} from "../services/api.js";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Eye,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

const PROJECTS = [
  "Skyline Residences",
  "Green Valley Phase 2",
  "Riverfront Heights",
  "Palm Grove Villas",
  "Orchid Park Residences",
  "Terrace Gardens",
];

const VISIT_STATUSES = ["Scheduled", "Completed", "Cancelled"];

const STATUS_STYLES = {
  Scheduled: "bg-violet-50 text-violet-800 ring-violet-600/10",
  Completed: "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15",
  Cancelled: "bg-gray-100 text-gray-600 ring-gray-500/10",
};

const EMPTY_SUMMARY = {
  total: 0,
  activeScheduled: 0,
  overdueScheduled: 0,
  upcoming: 0,
  today: 0,
  completed: 0,
  cancelled: 0,
};

const SEARCH_DEBOUNCE_MS = 350;

function formatVisitDateTime(isoDate, slot) {
  const parsed = new Date(`${isoDate}T12:00:00`);
  const dateLabel = parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${dateLabel} · ${slot}`;
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

function SummaryCard({ label, value }) {
  return (
    <article className="min-w-0 rounded-xl border border-gray-200/80 bg-white px-3 py-2.5 shadow-sm shadow-gray-900/[0.02] sm:px-4 sm:py-3">
      <p className="truncate text-xs font-medium text-gray-500 sm:text-sm">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
        {value.toLocaleString()}
      </p>
    </article>
  );
}

function selectClassName() {
  return "h-10 w-full appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-9 text-sm text-gray-700 outline-none transition focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15";
}

function Visits() {
  const navigate = useNavigate();
  const [visits, setVisits] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [pendingActionId, setPendingActionId] = useState(null);
  const menuAnchorRef = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [search]);

  const loadVisits = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const data = await fetchVisits({
        search: debouncedSearch,
        project: projectFilter,
        status: statusFilter,
        date: dateFilter,
      });

      setVisits(data.visits ?? []);
      setSummary(data.summary ?? EMPTY_SUMMARY);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load visits. Check that the API server is running.";
      setLoadError(message);
      setVisits([]);
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, projectFilter, statusFilter, dateFilter]);

  useEffect(() => {
    const timer = window.setTimeout(loadVisits, 0);
    return () => window.clearTimeout(timer);
  }, [loadVisits]);

  const hasActiveFilters =
    search.trim() !== "" ||
    projectFilter !== "all" ||
    statusFilter !== "all" ||
    dateFilter !== "all";

  function clearFilters() {
    setSearch("");
    setProjectFilter("all");
    setStatusFilter("all");
    setDateFilter("all");
  }

  function closeRowMenu() {
    setMenuOpenId(null);
  }

  function openRowMenu(visitId, anchorEl) {
    menuAnchorRef.current = anchorEl;
    setMenuOpenId((prev) => (prev === visitId ? null : visitId));
  }

  const menuVisit = menuOpenId
    ? visits.find((visit) => visit.id === menuOpenId)
    : null;

  async function applyStatusUpdate(visitId, status) {
    setPendingActionId(visitId);
    setActionError("");
    setMenuOpenId(null);

    try {
      await updateVisitStatusApi(visitId, status);
      await loadVisits();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not update visit status. Please try again.";

      if (error instanceof ApiError && error.status === 409) {
        setActionError(
          message || "This visit was already updated. The list has been refreshed.",
        );
        await loadVisits();
      } else {
        setActionError(message);
      }
    } finally {
      setPendingActionId(null);
    }
  }

  function cancelVisit(visitId) {
    applyStatusUpdate(visitId, "Cancelled");
  }

  function completeVisit(visitId) {
    applyStatusUpdate(visitId, "Completed");
  }

  function viewDetails(visit) {
    setMenuOpenId(null);
    navigate(`/leads/${visit.leadId}`);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-[1.625rem]">
          Site Visits
        </h1>
        <p className="mt-0.5 max-w-xl text-sm text-gray-500">
          Manage upcoming property tours and follow-ups.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Active scheduled"
          value={summary.activeScheduled ?? summary.upcoming + summary.today}
        />
        <SummaryCard label="Today" value={summary.today} />
        <SummaryCard label="Completed" value={summary.completed} />
        <SummaryCard label="Cancelled" value={summary.cancelled} />
      </div>

      <p className="shrink-0 text-[11px] leading-4 text-gray-500">
        Active scheduled counts today and future Scheduled tours. Past-due
        scheduled visits remain available in the list but are not counted as
        upcoming.
      </p>

      <section className="rounded-xl border border-gray-200/80 bg-white p-3 shadow-sm shadow-gray-900/[0.02]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-[190px] flex-1 basis-[250px]">
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by buyer name or project…"
              className="h-10 w-full rounded-lg border border-gray-200 py-2 pl-10 pr-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15"
            />
          </div>
          <div className="order-last ml-auto flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-500">
            <SlidersHorizontal size={16} className="hidden sm:block" />
            <span className="font-medium text-gray-700">
              {loading ? "—" : visits.length}
            </span>
            <span>shown</span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <div className="relative min-w-[145px] flex-1 basis-[165px]">
            <label htmlFor="visit-filter-project" className="sr-only">
              Project
            </label>
            <select
              id="visit-filter-project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className={selectClassName()}
            >
              <option value="all">All projects</option>
              {PROJECTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
          </div>

          <div className="relative min-w-[135px] flex-1 basis-[145px]">
            <label htmlFor="visit-filter-status" className="sr-only">
              Visit status
            </label>
            <select
              id="visit-filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={selectClassName()}
            >
              <option value="all">All statuses</option>
              {VISIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
          </div>

          <div className="relative min-w-[125px] flex-1 basis-[135px]">
            <label htmlFor="visit-filter-date" className="sr-only">
              Date
            </label>
            <select
              id="visit-filter-date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className={selectClassName()}
            >
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="this-week">This week</option>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
          </div>
        </div>
      </section>

      {actionError && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {actionError}
        </p>
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm shadow-gray-900/[0.02]">
        {loading ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm text-gray-500">Loading visits…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <h2 className="text-base font-semibold text-gray-900">
              Could not load visits
            </h2>
            <p className="mt-2 max-w-md text-sm text-gray-500">{loadError}</p>
            <button
              type="button"
              onClick={loadVisits}
              className="mt-5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Try again
            </button>
          </div>
        ) : visits.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FAFAF8] text-[#527A65]">
              <CalendarDays size={22} strokeWidth={1.75} />
            </div>
            <h2 className="mt-4 text-base font-semibold text-gray-900">
              No visits match your filters
            </h2>
            <p className="mt-2 max-w-sm text-sm text-gray-500">
              Try adjusting search or filters to find scheduled tours and
              follow-ups.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
            <table className="min-w-[820px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-100 bg-[#FAFAF8]/80">
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Buyer</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Project</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">
                    Date &amp; time
                  </th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">
                    Sales executive
                  </th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Status</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-3 py-2.5 font-medium text-gray-500">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visits.map((visit) => {
                  const actionPending = pendingActionId === visit.id;

                  return (
                    <tr key={visit.id} className="hover:bg-[#FAFAF8]/50">
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => viewDetails(visit)}
                          className="font-medium text-gray-900 hover:text-[#42634F]"
                        >
                          {visit.buyer}
                        </button>
                        <p className="mt-0.5 font-mono text-xs text-gray-400">
                          {visit.id}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                        {visit.project}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                        {formatVisitDateTime(visit.visitDate, visit.slot)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                        {visit.executive}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <StatusBadge status={visit.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button
                          type="button"
                          aria-label={`Actions for ${visit.buyer}`}
                          aria-expanded={menuOpenId === visit.id}
                          aria-haspopup="menu"
                          disabled={actionPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            openRowMenu(visit.id, e.currentTarget);
                          }}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FloatingMenu
        open={Boolean(menuVisit)}
        onClose={closeRowMenu}
        anchorRef={menuAnchorRef}
        menuWidth={176}
      >
        {menuVisit && (
          <>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => viewDetails(menuVisit)}
            >
              <Eye size={15} />
              View details
            </button>
            {menuVisit.status === "Scheduled" && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={pendingActionId === menuVisit.id}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#42634F] hover:bg-[#EDF3EE]/60 disabled:opacity-50"
                  onClick={() => completeVisit(menuVisit.id)}
                >
                  <CheckCircle2 size={15} />
                  {pendingActionId === menuVisit.id
                    ? "Updating…"
                    : "Mark completed"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={pendingActionId === menuVisit.id}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  onClick={() => cancelVisit(menuVisit.id)}
                >
                  <XCircle size={15} />
                  {pendingActionId === menuVisit.id
                    ? "Updating…"
                    : "Cancel visit"}
                </button>
              </>
            )}
          </>
        )}
      </FloatingMenu>

      <p className="shrink-0 text-xs text-gray-400">
        Book new visits from a lead profile via{" "}
        <Link to="/leads" className="font-medium text-[#42634F] hover:underline">
          Leads
        </Link>
        .
      </p>
    </div>
  );
}

export default Visits;
