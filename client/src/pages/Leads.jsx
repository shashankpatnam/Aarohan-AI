import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FloatingMenu from "../components/ui/FloatingMenu.jsx";import {
  ChevronDown,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  UserPlus,
  X,
} from "lucide-react";
import ProjectLabel from "../components/crm/ProjectLabel.jsx";
import { ApiError, assignHandoff, createLead, fetchEligibleStaff, fetchLeads, updateLead } from "../services/api.js";

const PROJECTS = [
  "Skyline Residences",
  "Green Valley Phase 2",
  "Riverfront Heights",
  "Palm Grove Villas",
  "Orchid Park Residences",
  "Terrace Gardens",
];

const SOURCES = ["99acres", "MagicBricks", "Website", "Referral", "Housing.com"];

const STATUSES = ["New", "Contacted", "Qualified", "Visit booked"];

const STATUS_STYLES = {
  New: "bg-sky-50 text-sky-700 ring-sky-600/10",
  Contacted: "bg-amber-50 text-amber-800 ring-amber-600/10",
  Qualified: "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15",
  "Visit booked": "bg-violet-50 text-violet-800 ring-violet-600/10",
};

const EMPTY_SUMMARY = {
  all: 0,
  new: 0,
  contacted: 0,
  qualified: 0,
  visitBooked: 0,
};

const SEARCH_DEBOUNCE_MS = 350;

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
    <article className="flex items-center justify-between gap-2 rounded-xl border border-gray-200/80 bg-white px-3 py-2.5 shadow-sm shadow-gray-900/[0.02]">
      <p className="text-xs font-medium text-gray-500 sm:text-sm">{label}</p>
      <p className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
        {value.toLocaleString()}
      </p>
    </article>
  );
}

function selectClassName() {
  return "w-full appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 outline-none transition focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15";
}

function Leads() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [interestedProjectFilter, setInterestedProjectFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [menuOpenId, setMenuOpenId] = useState(null);
  const menuAnchorRef = useRef(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [actionError, setActionError] = useState("");
  const [eligibleStaff, setEligibleStaff] = useState([]);

  useEffect(() => {
    let active = true;
    fetchEligibleStaff().then((data) => { if (active) setEligibleStaff(data.staff ?? []); }).catch(() => { if (active) setEligibleStaff([]); });
    return () => { active = false; };
  }, []);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    project: "",
    source: SOURCES[0],
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [search]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const data = await fetchLeads({
        search: debouncedSearch,
        status: statusFilter,
        project: projectFilter,
        interestedProject: interestedProjectFilter,
        source: sourceFilter,
      });

      setLeads(data.leads ?? []);
      setSummary(data.summary ?? EMPTY_SUMMARY);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load leads. Check that the API server is running.";
      setLoadError(message);
      setLeads([]);
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, projectFilter, interestedProjectFilter, sourceFilter]);

  useEffect(() => {
    const timer = window.setTimeout(loadLeads, 0);
    return () => window.clearTimeout(timer);
  }, [loadLeads]);

  const hasActiveFilters =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    projectFilter !== "all" ||
    interestedProjectFilter !== "all" ||
    sourceFilter !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setProjectFilter("all");
    setInterestedProjectFilter("all");
    setSourceFilter("all");
  }

  function closeRowMenu() {
    setMenuOpenId(null);
  }

  function openRowMenu(leadId, anchorEl) {
    menuAnchorRef.current = anchorEl;
    setMenuOpenId((prev) => (prev === leadId ? null : leadId));
  }

  const menuLead = menuOpenId
    ? leads.find((lead) => lead.id === menuOpenId)
    : null;

  function openLead(id) {
    navigate(`/leads/${id}`);
  }

  function openAddLeadModal() {
    setSubmitError("");
    setModalOpen(true);
  }

  async function handleAddLead(event) {
    event.preventDefault();
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || !phone) return;

    setSubmitting(true);
    setSubmitError("");

    try {
      await createLead({
        name,
        phone,
        project: form.project || null,
        source: form.source,
      });

      setForm({ name: "", phone: "", project: "", source: SOURCES[0] });
      setModalOpen(false);
      await loadLeads();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not save lead. Please try again.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignExecutive(leadId, executive) {
    closeRowMenu();
    setActionError("");

    try {
      const lead = leads.find((item) => item.id === leadId);
      if (lead?.handoffStatus === "Pending" || lead?.handoffStatus === "Assigned") {
        const person = eligibleStaff.find((item) => item.name === executive);
        if (!person) throw new Error("Choose an active staff account.");
        await assignHandoff(leadId, person.id);
      } else {
        await updateLead(leadId, { executive });
      }
      await loadLeads();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not assign executive. Please try again.";
      setActionError(message);
    }
  }

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-[1.625rem]">
            Leads
          </h1>
          <p className="mt-0.5 max-w-xl text-sm text-gray-500">
            Manage enquiries and turn buyer interest into site visits.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddLeadModal}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#527A65] px-3.5 py-2 text-sm font-medium text-white transition hover:bg-[#42634F]"
        >
          <Plus size={18} strokeWidth={2} />
          Add lead
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="All leads" value={summary.all} />
        <SummaryCard label="New" value={summary.new} />
        <SummaryCard label="Contacted" value={summary.contacted ?? 0} />
        <SummaryCard label="Qualified" value={summary.qualified} />
        <SummaryCard label="Site visit booked" value={summary.visitBooked} />
      </div>

      {actionError && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {actionError}
        </p>
      )}

      <section className="rounded-xl border border-gray-200/80 bg-white p-3 shadow-sm shadow-gray-900/[0.02]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-[190px] flex-1 basis-[230px]">
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, or project…"
              className="h-10 w-full rounded-lg border border-gray-200 pl-10 pr-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15"
            />
          </div>

          <div className="order-last ml-auto flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-500">
            <SlidersHorizontal size={16} className="hidden sm:block" />
            <span className="font-medium text-gray-700">
              {loading ? "—" : leads.length}
            </span>
            <span>shown</span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <div className="relative min-w-[135px] flex-1 basis-[140px]">
            <label htmlFor="filter-status" className="sr-only">
              Status
            </label>
            <select
              id="filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={selectClassName()}
            >
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
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

          <div className="relative min-w-[190px] flex-1 basis-[200px]">
            <label htmlFor="filter-project" className="sr-only">
              Primary project
            </label>
            <select
              id="filter-project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className={selectClassName()}
            >
              <option value="all">All leads (any primary project)</option>
              <option value="General Inquiry">General Inquiry</option>
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

          <div className="relative min-w-[175px] flex-1 basis-[180px]">
            <label htmlFor="filter-interested-project" className="sr-only">
              Interested project
            </label>
            <select
              id="filter-interested-project"
              value={interestedProjectFilter}
              onChange={(e) => setInterestedProjectFilter(e.target.value)}
              className={selectClassName()}
            >
              <option value="all">All interested projects</option>
              {PROJECTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>

          <div className="relative min-w-[125px] flex-1 basis-[130px]">
            <label htmlFor="filter-source" className="sr-only">
              Source
            </label>
            <select
              id="filter-source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className={selectClassName()}
            >
              <option value="all">All sources</option>
              {SOURCES.map((s) => (
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
        </div>
      </section>

      <section className="flex flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm shadow-gray-900/[0.02] lg:min-h-0 lg:flex-1">
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            <p className="text-sm text-gray-500">Loading leads…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            <h2 className="text-base font-semibold text-gray-900">
              Could not load leads
            </h2>
            <p className="mt-2 max-w-md text-sm text-gray-500">{loadError}</p>
            <button
              type="button"
              onClick={loadLeads}
              className="mt-5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Try again
            </button>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FAFAF8] text-[#527A65]">
              <UserPlus size={22} strokeWidth={1.75} />
            </div>
            <h2 className="mt-4 text-base font-semibold text-gray-900">
              No leads match your filters
            </h2>
            <p className="mt-2 max-w-sm text-sm text-gray-500">
              Try adjusting search or filters, or add a new enquiry to get
              started.
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
            <button
              type="button"
              onClick={openAddLeadModal}
              className="mt-3 rounded-lg bg-[#527A65] px-4 py-2 text-sm font-medium text-white hover:bg-[#42634F]"
            >
              Add lead
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-auto">
            <table className="min-w-[960px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-100 bg-[#FAFAF8]/80">
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Buyer</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Project</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Source</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Budget</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">Status</th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">
                    Executive
                  </th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-4 py-2.5 font-medium text-gray-500">
                    Last activity
                  </th>
                  <th className="border-b border-gray-100 bg-[#FAFAF8] px-3 py-2.5 font-medium text-gray-500">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => openLead(lead.id)}
                    className="cursor-pointer transition hover:bg-[#FAFAF8]/60"
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openLead(lead.id);
                        }}
                        className="text-left"
                      >
                        <p className="font-medium text-gray-900 hover:text-[#42634F]">
                          {lead.name}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {lead.phone}
                        </p>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                      <ProjectLabel project={lead.project} label={lead.projectLabel} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                      {lead.source}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                      {lead.budget}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                      {lead.executive}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-400">
                      {lead.lastActivity}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <button
                        type="button"
                        aria-label={`Actions for ${lead.name}`}
                        aria-expanded={menuOpenId === lead.id}
                        aria-haspopup="menu"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRowMenu(lead.id, e.currentTarget);
                        }}
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FloatingMenu
        open={Boolean(menuLead)}
        onClose={closeRowMenu}
        anchorRef={menuAnchorRef}
        menuWidth={200}
      >
        {menuLead && (
          <>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                closeRowMenu();
                openLead(menuLead.id);
              }}
            >
              View details
            </button>
            {menuLead.handoffStatus !== "Resolved" ? <p className="border-t border-gray-100 px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-gray-400">Assign executive</p> : null}
            {menuLead.handoffStatus !== "Resolved" && eligibleStaff.map(({ id, name }) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
                disabled={menuLead.executive === name}
                onClick={() => handleAssignExecutive(menuLead.id, name)}
              >
                {name}
                {menuLead.executive === name ? " (current)" : ""}
              </button>
            ))}
          </>
        )}
      </FloatingMenu>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-gray-900/40"
            onClick={() => !submitting && setModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-lead-title"
            className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="add-lead-title"
                  className="text-lg font-semibold text-gray-900"
                >
                  Add lead
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Capture a new buyer enquiry manually.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setModalOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddLead} className="mt-6 space-y-4">
              {submitError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {submitError}
                </p>
              )}
              <div>
                <label
                  htmlFor="lead-name"
                  className="block text-sm font-medium text-gray-700"
                >
                  Name
                </label>
                <input
                  id="lead-name"
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  disabled={submitting}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50"
                  placeholder="Buyer full name"
                />
              </div>
              <div>
                <label
                  htmlFor="lead-phone"
                  className="block text-sm font-medium text-gray-700"
                >
                  Phone
                </label>
                <input
                  id="lead-phone"
                  required
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  disabled={submitting}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50"
                  placeholder="+91 98765 43210"
                />
              </div>
              <div>
                <label
                  htmlFor="lead-project"
                  className="block text-sm font-medium text-gray-700"
                >
                  Project
                </label>
                <select
                  id="lead-project"
                  value={form.project}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, project: e.target.value }))
                  }
                  disabled={submitting}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50"
                >
                  <option value="">General Inquiry (no primary project)</option>
                  {PROJECTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="lead-source"
                  className="block text-sm font-medium text-gray-700"
                >
                  Source
                </label>
                <select
                  id="lead-source"
                  value={form.source}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, source: e.target.value }))
                  }
                  disabled={submitting}
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50"
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => !submitting && setModalOpen(false)}
                  disabled={submitting}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#527A65] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#42634F] disabled:opacity-60"
                >
                  {submitting ? "Saving…" : "Save lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Leads;
