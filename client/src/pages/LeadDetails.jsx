import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import BookSiteVisitModal from "../components/booking/BookSiteVisitModal";
import ChatBubble from "../components/chat/ChatBubble.jsx";
import {
  ApiError,
  assignHandoff,
  fetchEligibleStaff,
  fetchLeadById,
  resolveHandoff,
  sendLeadChatMessage,
  updateLead,
  updateVisitStatus,
} from "../services/api.js";
import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  HandHelping,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  Sparkles,
} from "lucide-react";

const PROJECTS = [
  "Skyline Residences",
  "Green Valley Phase 2",
  "Riverfront Heights",
  "Palm Grove Villas",
  "Orchid Park Residences",
  "Terrace Gardens",
];

const HANDOFF_STATUS_STYLES = {
  None: "bg-gray-50 text-gray-600 ring-gray-500/10",
  Pending: "bg-amber-50 text-amber-900 ring-amber-600/15",
  Assigned: "bg-violet-50 text-violet-800 ring-violet-600/10",
  Resolved: "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15",
};

const STATUS_STYLES = {
  New: "bg-sky-50 text-sky-700 ring-sky-600/10",
  Contacted: "bg-amber-50 text-amber-800 ring-amber-600/10",
  Qualified: "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15",
  "Visit booked": "bg-violet-50 text-violet-800 ring-violet-600/10",
};

const VISIT_STATUS_STYLES = {
  Scheduled: "bg-violet-50 text-violet-800 ring-violet-600/10",
  Completed: "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15",
  Cancelled: "bg-gray-100 text-gray-600 ring-gray-500/10",
};

function normalizeLead(lead) {
  return {
    ...lead,
    projectLabel: lead.projectLabel ?? lead.project ?? "General Inquiry",
    initialProject: lead.initialProject ?? null,
    interestedProjects: Array.isArray(lead.interestedProjects) ? lead.interestedProjects : [],
    interestEvidence: Array.isArray(lead.interestEvidence) ? lead.interestEvidence : [],
    email: lead.email?.trim() ? lead.email : "—",
    preferredConfiguration: lead.preferredConfiguration?.trim()
      ? lead.preferredConfiguration
      : "—",
    preferredLanguage: lead.preferredLanguage?.trim()
      ? lead.preferredLanguage
      : "—",
    buyerSummary: lead.buyerSummary?.trim() ? lead.buyerSummary : "—",
    qualification: {
      buyingTimeline: lead.qualification?.buyingTimeline?.trim()
        ? lead.qualification.buyingTimeline
        : "—",
      budgetFit: lead.qualification?.budgetFit?.trim()
        ? lead.qualification.budgetFit
        : "—",
      locationPreference: lead.qualification?.locationPreference?.trim()
        ? lead.qualification.locationPreference
        : "—",
      score: lead.qualification?.score ?? null,
    },
    timeline: Array.isArray(lead.timeline) ? lead.timeline : [],
    messages: Array.isArray(lead.messages) ? lead.messages : [],
    handoffStatus: lead.handoffStatus ?? "None",
    handoffReason: lead.handoffReason?.trim() ? lead.handoffReason : "",
    handoffAiReason: lead.handoffAiReason?.trim() ? lead.handoffAiReason : "",
    handoffRequestedAt: lead.handoffRequestedAt ?? null,
    handoffResolvedAt: lead.handoffResolvedAt ?? null,
    handoffType: lead.handoffType ?? "",
    handoffCallbackNote: lead.handoffCallbackNote?.trim()
      ? lead.handoffCallbackNote
      : "",
    handoffPreferredContactMethod: lead.handoffPreferredContactMethod ?? "",
  };
}

function formatHandoffTime(iso) {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status, styles = STATUS_STYLES }) {
  const className =
    styles[status] ?? "bg-gray-50 text-gray-700 ring-gray-600/10";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {status}
    </span>
  );
}

function Card({ title, children, icon: Icon }) {
  return (
    <section className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-gray-900/[0.02] sm:p-4">
      <div className="mb-3 flex items-center gap-2">
        {Icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FAFAF8] text-[#527A65]">
            <Icon size={17} strokeWidth={1.75} />
          </span>
        )}
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function TimelineIcon({ kind }) {
  const base =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white";
  if (kind === "created") {
    return (
      <span className={`${base} bg-gray-100 text-gray-600`}>
        <Sparkles size={15} />
      </span>
    );
  }
  if (kind === "ai") {
    return (
      <span className={`${base} bg-[#EDF3EE] text-[#42634F]`}>
        <Bot size={15} />
      </span>
    );
  }
  return (
    <span className={`${base} bg-sky-50 text-sky-700`}>
      <MessageSquare size={15} />
    </span>
  );
}

function messageKey(leadId, msg, index) {
  const id = msg.id ?? msg._id;
  if (id) {
    return `${leadId}-${id}`;
  }
  return `${leadId}-${index}-${msg.time}-${msg.from}`;
}

function AiConversationPanel({ lead, onLeadUpdated }) {
  const [messages, setMessages] = useState(() => [...lead.messages]);
  const [draft, setDraft] = useState("");
  const [sendPending, setSendPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [handoff, setHandoff] = useState({
    needsHumanHandoff: false,
    handoffReason: null,
  });
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sendPending]);

  async function sendMessage() {
    const trimmed = draft.trim();
    if (!trimmed || sendPending) {
      return;
    }

    setSendPending(true);
    setChatError("");

    try {
      const data = await sendLeadChatMessage(lead.id, trimmed);
      const savedMessages = Array.isArray(data.messages)
        ? data.messages
        : data.lead?.messages;

      if (data.lead) {
        onLeadUpdated(data.lead);
      }
      if (Array.isArray(savedMessages)) {
        setMessages(savedMessages);
      }

      setHandoff({
        needsHumanHandoff: data.needsHumanHandoff === true,
        handoffReason: data.handoffReason ?? null,
      });
      setDraft("");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not send your message. Check that the API server is running.";
      setChatError(message);
    } finally {
      setSendPending(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendMessage();
  }

  return (
    <>
      <div className="max-h-[min(52vh,620px)] space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && !sendPending ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No conversation history yet for this lead.
          </p>
        ) : (
          messages.map((msg, index) => (
              <ChatBubble
                id={msg._id || msg.id ? `conversation-message-${msg._id ?? msg.id}` : undefined}
              key={messageKey(lead.id, msg, index)}
              msg={msg}
            />
          ))
        )}
        {sendPending && (
          <p className="text-center text-xs text-gray-500">Sending your message…</p>
        )}
        <div ref={messagesEndRef} />
      </div>

      {handoff.needsHumanHandoff ||
      lead.handoffStatus === "Pending" ||
      lead.handoffStatus === "Assigned" ? (
        <p
          className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          <span className="font-medium">Human follow-up suggested: </span>
          {lead.handoffReason?.trim() ||
          handoff.handoffReason?.trim()
            ? lead.handoffReason || handoff.handoffReason
            : "A team member should reach out to this buyer."}
        </p>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="mt-4 flex gap-2 border-t border-gray-100 pt-4"
      >
        <label htmlFor="ai-message-input" className="sr-only">
          Message as buyer
        </label>
        <input
          id="ai-message-input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message as the buyer…"
          disabled={sendPending}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50 disabled:text-gray-500"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sendPending}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#527A65] px-3.5 py-2.5 text-sm font-medium text-white transition hover:bg-[#42634F] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={16} strokeWidth={2} />
          <span className="hidden sm:inline">
            {sendPending ? "Sending…" : "Send"}
          </span>
        </button>
      </form>

      {chatError && (
        <p
          className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {chatError}
        </p>
      )}
    </>
  );
}

function DetailsBreadcrumb() {
  return (
    <nav
      className="flex items-center gap-1.5 text-sm text-gray-500"
      aria-label="Breadcrumb"
    >
      <Link to="/leads" className="font-medium hover:text-[#42634F]">
        Leads
      </Link>
      <ChevronRight size={14} className="text-gray-300" aria-hidden />
      <span className="text-gray-700">Lead Details</span>
    </nav>
  );
}

function LeadNotFound() {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white px-6 py-16 text-center shadow-sm">
      <p className="text-base font-semibold text-gray-900">Lead not found</p>
      <p className="mt-2 text-sm text-gray-500">
        This lead may have been removed or the link is incorrect.
      </p>
      <Link
        to="/leads"
        className="mt-6 inline-flex rounded-lg bg-[#527A65] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#42634F]"
      >
        Back to leads
      </Link>
    </div>
  );
}

function LeadLoadError({ message, onRetry }) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white px-6 py-16 text-center shadow-sm">
      <p className="text-base font-semibold text-gray-900">Could not load lead</p>
      <p className="mt-2 text-sm text-gray-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Try again
      </button>
    </div>
  );
}

function formatDisplayVisitDate(isoDate) {
  if (!isoDate) return "—";
  const parsed = new Date(`${isoDate}T12:00:00`);
  return parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function HumanHandoffSection({ lead, onRefresh }) {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [staff, setStaff] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState("");
  const hasHandoff = Boolean(lead && lead.handoffStatus !== "None");

  useEffect(() => {
    if (!hasHandoff) return undefined;
    let active = true;
    fetchEligibleStaff().then((data) => { if (active) setStaff(data.staff ?? []); }).catch(() => { if (active) setStaff([]); });
    return () => { active = false; };
  }, [hasHandoff]);

  if (!lead || lead.handoffStatus === "None") {
    return null;
  }

  async function handleAssign() {
    if (!selectedStaff) return;
    setPending(true);
    setActionError("");
    try {
      await assignHandoff(lead.id, selectedStaff);
      setSelectedStaff("");
      await onRefresh();
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Could not assign handoff.",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleResolve() {
    if (!window.confirm("Mark this handoff as resolved?")) return;
    setPending(true);
    setActionError("");
    try {
      await resolveHandoff(lead.id);
      await onRefresh();
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Could not resolve handoff.",
      );
    } finally {
      setPending(false);
    }
  }

  const styles =
    HANDOFF_STATUS_STYLES[lead.handoffStatus] ??
    HANDOFF_STATUS_STYLES.None;

  return (
    <section className="rounded-xl border border-amber-200/60 bg-amber-50/30 p-5 shadow-sm shadow-gray-900/[0.02]">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-800">
          <HandHelping size={18} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">
              Human handoff
            </h2>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
            >
              {lead.handoffStatus}
            </span>
            {lead.handoffType === "buyer_callback" ? (
              <span className="inline-flex rounded-full bg-[#EDF3EE] px-2.5 py-0.5 text-xs font-medium text-[#42634F] ring-1 ring-[#527A65]/15 ring-inset">
                Buyer callback
              </span>
            ) : null}
          </div>
          {lead.handoffAiReason?.trim() ? (
            <p className="mt-2 text-sm text-gray-700">
              <span className="font-medium text-gray-600">
                Original AI reason:{" "}
              </span>
              {lead.handoffAiReason}
            </p>
          ) : (
            <p className="mt-2 text-sm text-gray-700">
              {lead.handoffReason?.trim()
                ? lead.handoffReason
                : "Human follow-up recommended"}
            </p>
          )}
          {lead.handoffAiReason?.trim() &&
          lead.handoffReason?.trim() &&
          lead.handoffReason.trim() !== lead.handoffAiReason.trim() ? (
            <p className="mt-2 text-sm text-gray-700">
              <span className="font-medium text-gray-600">Reason: </span>
              {lead.handoffReason}
            </p>
          ) : null}
          {lead.handoffType === "buyer_callback" &&
          (lead.handoffCallbackNote || lead.handoffPreferredContactMethod) ? (
            <dl className="mt-3 space-y-1.5 rounded-lg border border-amber-100 bg-white/60 px-3 py-2 text-sm">
              {lead.handoffPreferredContactMethod ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Preferred contact</dt>
                  <dd className="font-medium capitalize text-gray-800">
                    {lead.handoffPreferredContactMethod}
                  </dd>
                </div>
              ) : null}
              {lead.handoffCallbackNote ? (
                <div>
                  <dt className="text-gray-500">Buyer note</dt>
                  <dd className="mt-0.5 font-medium text-gray-800">
                    {lead.handoffCallbackNote}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Requested</dt>
              <dd className="font-medium text-gray-800">
                {formatHandoffTime(lead.handoffRequestedAt)}
              </dd>
            </div>
            {lead.handoffStatus === "Resolved" && (
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Resolved</dt>
                <dd className="font-medium text-gray-800">
                  {formatHandoffTime(lead.handoffResolvedAt)}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Executive</dt>
              <dd className="font-medium text-gray-800">
                {lead.executive?.trim() && lead.executive !== "Unassigned"
                  ? lead.executive
                  : "Unassigned"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            <Link to="/handoffs" className="font-medium text-[#42634F] hover:underline">
              Open handoff queue
            </Link>
          </p>
          {(lead.handoffStatus === "Pending" || lead.handoffStatus === "Assigned") && (
            <div className="mt-4 flex flex-wrap gap-2">
              <select aria-label="Assign executive" value={selectedStaff} disabled={pending || staff.length === 0} onChange={(event) => setSelectedStaff(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                <option value="">{lead.handoffStatus === "Assigned" ? `Assigned: ${lead.executive}` : "Choose executive"}</option>
                {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              <button type="button" disabled={pending || !selectedStaff} onClick={handleAssign} className="rounded-lg border border-amber-200/80 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-amber-50/80 disabled:opacity-50">
                {lead.handoffStatus === "Assigned" ? "Reassign" : "Assign"}
              </button>
            </div>
          )}
          {(lead.handoffStatus === "Pending" ||
            lead.handoffStatus === "Assigned") && (
            <button
              type="button"
              disabled={pending}
              onClick={handleResolve}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#527A65] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#42634F] disabled:opacity-50 sm:w-auto"
            >
              <CheckCircle2 size={16} />
              {pending ? "Saving…" : "Mark resolved"}
            </button>
          )}
          {actionError && (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {actionError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function LeadDetails() {
  const { id } = useParams();
  const [lead, setLead] = useState(null);
  const [visits, setVisits] = useState([]);
  const [activeVisit, setActiveVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [projectUpdatePending, setProjectUpdatePending] = useState(false);
  const [projectUpdateError, setProjectUpdateError] = useState("");

  const loadLead = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLead(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setNotFound(false);

    try {
      const data = await fetchLeadById(id);
      setLead(normalizeLead(data.lead));
      setVisits(data.visits ?? []);
      setActiveVisit(data.activeVisit ?? null);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 400)
      ) {
        setNotFound(true);
        setLead(null);
      } else {
        const message =
          error instanceof ApiError
            ? error.message
            : "Could not load this lead. Check that the API server is running.";
        setLoadError(message);
        setLead(null);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBookingOpen(false);
      loadLead();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLead]);

  if (loading) {
    return (
      <div className="space-y-6">
        <DetailsBreadcrumb />
        <div className="rounded-xl border border-gray-200/80 bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-sm text-gray-500">Loading lead…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <DetailsBreadcrumb />
        <LeadLoadError message={loadError} onRetry={loadLead} />
      </div>
    );
  }

  if (notFound || !lead) {
    return (
      <div className="space-y-6">
        <DetailsBreadcrumb />
        <LeadNotFound />
      </div>
    );
  }

  const displayExecutive = activeVisit?.executive ?? lead.executive;
  const historicalVisits = [...visits].sort((a, b) =>
    (b.visitDate ?? "").localeCompare(a.visitDate ?? "") ||
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );

  async function handleVisitBooked() {
    await loadLead();
    setBookingOpen(false);
  }

  async function handleCancelVisit() {
    if (!activeVisit || cancelPending) {
      return;
    }

    const confirmed = window.confirm(
      "Cancel this scheduled site visit? The buyer will need a new booking to visit the site.",
    );
    if (!confirmed) {
      return;
    }

    setCancelPending(true);
    setCancelError("");

    try {
      await updateVisitStatus(activeVisit.id, "Cancelled");
      await loadLead();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not cancel visit. Please try again.";
      setCancelError(message);
    } finally {
      setCancelPending(false);
    }
  }

  async function handlePrimaryProjectChange(event) {
    const project = event.target.value || null;
    if (project === lead.project || projectUpdatePending) return;
    setProjectUpdatePending(true);
    setProjectUpdateError("");
    try {
      const response = await updateLead(lead.id, { project });
      setLead(normalizeLead(response.lead));
    } catch (error) {
      setProjectUpdateError(
        error instanceof ApiError ? error.message : "Could not update the primary project.",
      );
    } finally {
      setProjectUpdatePending(false);
    }
  }

  return (
    <div className="space-y-6">
      <DetailsBreadcrumb />

      <header className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-gray-900/[0.02]">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">{lead.name}</h1>
              <StatusBadge status={lead.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
              <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 hover:text-[#42634F]"><Phone size={14} />{lead.phone}</a>
              {lead.email !== "—" && <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 hover:text-[#42634F]"><Mail size={14} />{lead.email}</a>}
              <label className="inline-flex items-center gap-1.5"><MapPin size={14} /><span className="sr-only">Primary project interest</span><select id="primary-project" aria-label="Primary project interest" value={lead.project ?? ""} onChange={handlePrimaryProjectChange} disabled={projectUpdatePending} className="max-w-[220px] rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700"><option value="">General Inquiry</option>{PROJECTS.map((project) => <option key={project} value={project}>{project}</option>)}</select></label>
              <span className="text-gray-500">Source: <span className="text-gray-700">{lead.source}</span></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <div><p className="text-[11px] text-gray-400">Assigned executive</p><p className="font-medium text-gray-800">{displayExecutive}</p></div>
            <div><p className="text-[11px] text-gray-400">Last activity</p><p className="font-medium text-gray-800">{lead.lastActivity || "—"}</p></div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-8">
          <Card title="Buyer overview" icon={MapPin}>
            <div className="rounded-lg bg-[#FAFAF8] p-3">
              <p className="text-xs text-gray-400">Initial project context</p>
              <p className="mt-1 text-sm font-medium text-gray-800">{lead.initialProject || "Not recorded"}</p>
            </div>            {projectUpdatePending && <p className="mt-2 text-xs text-gray-500">Updating primary interest…</p>}
            {projectUpdateError && <p className="mt-2 text-sm text-red-700" role="alert">{projectUpdateError}</p>}
            <div className="mt-4">
              <p className="text-xs text-gray-400">Interested projects</p>
              {lead.interestedProjects.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {lead.interestedProjects.map((project) => (
                    <span key={project} className="rounded-full bg-[#EDF3EE] px-2.5 py-1 text-xs font-medium text-[#42634F] ring-1 ring-inset ring-[#527A65]/15">{project}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-gray-500">No confirmed project interests recorded.</p>
              )}
            </div>
            {lead.interestEvidence.length > 0 ? (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-500">Interest evidence</p>
                <ul className="mt-2 space-y-2">
                  {lead.interestEvidence.map((evidence) => (
                    <li key={evidence.id ?? `${evidence.project}-${evidence.sourceBuyerMessageId}`} className="rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-600">
                      <span className="font-medium text-gray-800">{evidence.project}</span>
                      <span> · {evidence.type === "buyer_confirmation" ? "Buyer confirmation" : "Explicit buyer statement"}</span>
                      <a href={`#conversation-message-${evidence.sourceBuyerMessageId}`} onClick={(event) => { event.preventDefault(); document.getElementById(`conversation-message-${evidence.sourceBuyerMessageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="mt-1 inline-block text-[11px] font-medium text-[#527A65] hover:underline">View buyer message</a>
                      {evidence.recordedAt ? <time className="mt-1 block text-gray-400" dateTime={evidence.recordedAt}>{new Date(evidence.recordedAt).toLocaleString("en-IN")}</time> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500">Buyer information</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {[['Phone', lead.phone], ['Email', lead.email], ['Budget', lead.budget], ['Preferred configuration', lead.preferredConfiguration], ['Preferred language', lead.preferredLanguage]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] text-gray-400">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium text-gray-800">{value === "—" || !value ? <span className="font-normal text-gray-400">Not provided</span> : value}</dd></div>)}
              </dl>
            </div>
          </Card>

          <Card title="Lead qualification" icon={Sparkles}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {lead.qualification.buyingTimeline !== "—" && <div className="rounded-lg bg-[#FAFAF8] p-3"><p className="text-xs text-gray-400">Buying timeline</p><p className="mt-1 text-sm font-medium text-gray-800">{lead.qualification.buyingTimeline}</p></div>}
              {lead.qualification.budgetFit !== "—" && <div className="rounded-lg bg-[#FAFAF8] p-3"><p className="text-xs text-gray-400">Budget fit</p><p className="mt-1 text-sm font-medium text-gray-800">{lead.qualification.budgetFit}</p></div>}
              {lead.qualification.locationPreference !== "—" && <div className="rounded-lg bg-[#FAFAF8] p-3 sm:col-span-2"><p className="text-xs text-gray-400">Location preference</p><p className="mt-1 text-sm font-medium text-gray-800">{lead.qualification.locationPreference}</p></div>}
              {lead.qualification.buyingTimeline === "—" && lead.qualification.budgetFit === "—" && lead.qualification.locationPreference === "—" && <p className="text-sm text-gray-500 sm:col-span-2">No qualification details recorded.</p>}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-[#527A65]/15 bg-[#EDF3EE]/50 px-3 py-2">
              <span className="text-sm font-medium text-[#42634F]">Qualification score</span>
              {lead.qualification.score != null ? <span className="text-xl font-semibold text-[#42634F]">{lead.qualification.score}<span className="text-sm font-normal text-[#527A65]">/100</span></span> : <span className="text-sm font-medium text-gray-500">Not scored</span>}
            </div>
          </Card>
          <Card title="Activity timeline" icon={Clock}>
            {lead.timeline.length === 0 ? (
              <p className="text-sm text-gray-500">No activity recorded yet.</p>
            ) : (
              <ol className="relative space-y-0">
                {lead.timeline.map((event, index) => (
                  <li
                    key={`${event.title}-${index}`}
                    className="relative flex gap-3 pb-4 last:pb-0"
                  >
                    {index < lead.timeline.length - 1 && (
                      <span
                        className="absolute left-4 top-8 h-[calc(100%-1rem)] w-px bg-gray-200"
                        aria-hidden
                      />
                    )}
                    <TimelineIcon kind={event.kind} />
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-medium text-gray-900">
                        {event.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-gray-500" title={event.detail}>{event.detail}</p>
                      <p className="mt-1 text-xs text-gray-400">{event.time}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Site Visit History" icon={CalendarCheck}>
            {historicalVisits.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {historicalVisits.map((visit) => (
                  <li
                    key={visit.id}
                    className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-xs font-medium text-[#42634F]">{visit.project}</p>
                      <p className="text-sm font-medium text-gray-900">
                        {formatDisplayVisitDate(visit.visitDate)} · {visit.slot}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Executive: {visit.executive}
                      </p>
                    </div>
                    <StatusBadge
                      status={visit.status}
                      styles={VISIT_STATUS_STYLES}
                    />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-gray-500">No site visits recorded yet.</p>}
          </Card>
        </div>

        <div className="order-1 space-y-4 lg:order-2 lg:col-span-4">
          <Card title="Scheduled site visit" icon={CalendarCheck}>
            {activeVisit ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-base font-semibold text-gray-900">{activeVisit.project}</p><StatusBadge status={activeVisit.status} styles={VISIT_STATUS_STYLES} /></div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><dt className="text-xs text-gray-400">Date</dt><dd className="font-medium text-gray-800">{formatDisplayVisitDate(activeVisit.visitDate)}</dd></div>
                  <div><dt className="text-xs text-gray-400">Time</dt><dd className="font-medium text-gray-800">{activeVisit.slot}</dd></div>
                  <div><dt className="text-xs text-gray-400">Executive</dt><dd className="font-medium text-gray-800">{activeVisit.executive}</dd></div>
                  <div><dt className="text-xs text-gray-400">Booking ID</dt><dd className="truncate font-mono text-xs text-gray-700" title={activeVisit.id}>{activeVisit.id}</dd></div>
                </dl>
                <button type="button" onClick={handleCancelVisit} disabled={cancelPending} className="mt-3 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">{cancelPending ? "Cancelling…" : "Cancel visit"}</button>
              </>
            ) : <div className="flex items-center justify-between gap-3"><p className="text-sm text-gray-500">No scheduled visit.</p>{lead.project ? <button type="button" onClick={() => setBookingOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#527A65] px-3 py-2 text-sm font-medium text-white hover:bg-[#42634F]"><CalendarCheck size={15} />Book visit</button> : <p className="text-right text-xs text-gray-500">Set a primary project to book.</p>}</div>}
          </Card>
          {cancelError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{cancelError}</p>}
          <Card title="AI conversation" icon={Bot}>
            <AiConversationPanel
              key={lead.id}
              lead={lead}
              onLeadUpdated={(updatedLead) =>
                setLead(normalizeLead(updatedLead))
              }
            />
          </Card>

          <section className="rounded-xl border border-gray-200/80 bg-[#FAFAF8] p-5 shadow-sm shadow-gray-900/[0.02]">
            <h2 className="text-sm font-semibold text-gray-900">Buyer summary</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {lead.buyerSummary}
            </p>
          </section>

          <HumanHandoffSection lead={lead} onRefresh={loadLead} />

        </div>
      </div>

      <BookSiteVisitModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        leadId={lead.id}
        buyerName={lead.name}
        project={lead.project}
        defaultExecutive={displayExecutive}
        onBooked={handleVisitBooked}
      />
    </div>
  );
}

export default LeadDetails;
