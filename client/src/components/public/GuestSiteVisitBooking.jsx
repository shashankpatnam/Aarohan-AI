import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Loader2, MapPin, RotateCcw } from "lucide-react";
import { GUEST_PROJECTS } from "../../constants/projects.js";
import { ApiError } from "../../services/api.js";
import { bookGuestSiteVisit, fetchGuestVisitAvailability } from "../../services/publicApi.js";
import {
  clearGuestBookingDraft,
  readGuestBookingDraft,
  writeGuestBookingDraft,
} from "../../services/guestSessionStorage.js";
import {
  formatMonthLabel,
  formatVisitDate,
  getIndiaCurrentMonth,
  getIndiaTodayIso,
  getMillisecondsUntilNextIndiaMidnight,
  getMonthAvailabilityRange,
  getMonthCalendarCells,
  revalidateBookingDraft,
  asksToVisitAnotherProject,
  isBookingResumeRequest,
  isSiteVisitAvailabilityQuestion,
  isSiteVisitIntent,
  resolveVisitProject,
  shiftMonth,
} from "../../utils/guestVisitBooking.js";
import GuestBookingContactForm from "./GuestBookingContactForm.jsx";
import {
  getGuestBookingPhaseAfterContact,
  getInitialGuestBookingPhase,
  getGuestBookingPhaseForResume,
  hasRequiredGuestBookingContact,
} from "../../utils/guestBookingContact.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SESSION_INVALID_STATUSES = new Set([401, 404, 410]);

function persistedBookingState(phase, selectedDate, selectedSlot) {
  if (phase === "selecting_project") return "identifying_project";
  if (phase === "collecting_contact") return "awaiting_contact";
  if (phase === "selecting_date") return "selecting_date";
  if (phase === "selecting_slot") return "selecting_slot";
  if (selectedSlot) return "reviewing_booking";
  return selectedDate ? "selecting_slot" : "selecting_date";
}

function GuestSiteVisitBooking({
  sessionId,
  sessionToken,
  messages,
  interestedProjects = [],
  requestText,
  contactCaptured,
  hasPhone,
  contactName,
  onContactCaptured,
  onSubmittingChange,
  onContactPrompt,
  onBookingConfirmed,
  onSessionInvalid,
  onHide,
  onCancel,
  onComplete,
  isBusy = false,
}) {
  const resolution = useMemo(
    () => resolveVisitProject(messages, requestText, interestedProjects),
    [interestedProjects, messages, requestText],
  );
  const [initialDraft] = useState(() => readGuestBookingDraft(sessionId));
  const startingProject = initialDraft ? initialDraft.project : resolution.project;
  const [clockNow, setClockNow] = useState(() => Date.now());
  const today = getIndiaTodayIso(new Date(clockNow));
  const currentMonth = getIndiaCurrentMonth(new Date(clockNow));
  const [project, setProject] = useState(startingProject);
  const [showAllProjects, setShowAllProjects] = useState(!startingProject);
  const [month, setMonth] = useState(initialDraft?.date && initialDraft.date >= today
    ? initialDraft.date.slice(0, 7)
    : currentMonth);
  const [availabilityResult, setAvailabilityResult] = useState({ key: "", status: "idle", dates: {}, error: "" });
  const [refreshAvailability, setRefreshAvailability] = useState(0);
  const [selectedDate, setSelectedDate] = useState(initialDraft?.date ?? "");
  const [selectedSlot, setSelectedSlot] = useState(initialDraft?.slot ?? "");
  const [contactOverride, setContactOverride] = useState(null);
  const contact = contactOverride ?? { captured: contactCaptured, hasPhone, name: contactName };
  const contactReady = hasRequiredGuestBookingContact(contact);
  const [phase, setPhase] = useState(() => getInitialGuestBookingPhase({
    project: startingProject,
    contactReady,
    draftDate: initialDraft?.date,
    draftState: initialDraft?.state,
  }));
  const [bookingError, setBookingError] = useState("");
  const [bookingConflict, setBookingConflict] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const bookingLock = useRef(false);
  const restoreDraftPending = useRef(Boolean(initialDraft?.date));
  const contactPromptProject = useRef("");
  const lastHandledVisitRequest = useRef(requestText);

  const monthRange = useMemo(() => getMonthAvailabilityRange(month, today), [month, today]);
  const availabilityKey = `${project ?? ""}|${month}|${refreshAvailability}|${monthRange.from}|${monthRange.to}`;
  const availabilityState = !project || !contactReady
    ? "empty"
    : availabilityResult.key === availabilityKey
      ? availabilityResult.status
      : "loading";
  const availability = availabilityResult.key === availabilityKey ? availabilityResult.dates : {};
  const availabilityError = availabilityResult.key === availabilityKey ? availabilityResult.error : "";
  // A new buyer booking request is a prop-driven state transition; reset only stale visit selections.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (lastHandledVisitRequest.current === requestText) return;
    lastHandledVisitRequest.current = requestText;
    if (!isSiteVisitIntent(requestText)) return;

    if (isBookingResumeRequest(requestText) || isSiteVisitAvailabilityQuestion(requestText)) {
      setShowAllProjects(!project);
      setPhase(getGuestBookingPhaseForResume({ project, contactReady, selectedDate, selectedSlot }));
      if (isSiteVisitAvailabilityQuestion(requestText) && project && contactReady) {
        setRefreshAvailability((value) => value + 1);
      }
      return;
    }

    const mustClarifyDifferentProject = asksToVisitAnotherProject(requestText);
    if (resolution.needsClarification || mustClarifyDifferentProject) {
      restoreDraftPending.current = false;
      setProject(null);
      setShowAllProjects(true);
      setSelectedDate("");
      setSelectedSlot("");
      setBookingError("");
      setPhase("selecting_project");
      return;
    }
    if (resolution.project && resolution.project !== project) {
      restoreDraftPending.current = false;
      setProject(resolution.project);
      setShowAllProjects(false);
      setSelectedDate("");
      setSelectedSlot("");
      setBookingError("");
      setBookingConflict(false);
      setMonth(currentMonth);
      setPhase(contactReady ? "selecting_date" : "collecting_contact");
    }
  }, [contactReady, currentMonth, project, requestText, resolution, selectedDate, selectedSlot]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (phase !== "collecting_contact" || !project || showAllProjects || contactReady) return;
    if (contactPromptProject.current === project) return;
    contactPromptProject.current = project;
    onContactPrompt?.(project);
  }, [contactReady, onContactPrompt, phase, project, showAllProjects]);

  useEffect(() => {
    if (!project || !contactReady || !monthRange.from || monthRange.from > monthRange.to) return undefined;
    const controller = new AbortController();
    fetchGuestVisitAvailability(sessionId, sessionToken, project, monthRange.from, monthRange.to, controller.signal)
      .then((data) => {
        const next = Object.fromEntries((data.availability ?? []).map((day) => [day.date, day.slots ?? []]));
        setAvailabilityResult({ key: availabilityKey, status: "ready", dates: next, error: "" });
        if (
          restoreDraftPending.current &&
          initialDraft?.project === project
        ) {
          restoreDraftPending.current = false;
          if (initialDraft.date < monthRange.from || initialDraft.date > monthRange.to) {
            clearGuestBookingDraft(sessionId);
            setSelectedDate("");
            setSelectedSlot("");
            setBookingError("That saved date is no longer available. Please choose another date.");
            setPhase("selecting_date");
            return;
          }
          const restored = revalidateBookingDraft(initialDraft, next);
          setSelectedDate(restored.date);
          setSelectedSlot(restored.slot);
          if (restored.valid) {
            setPhase("review");
          } else if (restored.date && !restored.slot && !restored.message) {
            setPhase("selecting_slot");
          } else {
            clearGuestBookingDraft(sessionId);
            setBookingError(restored.message);
            setPhase(restored.date ? "selecting_slot" : "selecting_date");
          }
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && SESSION_INVALID_STATUSES.has(error.status)) {
          onSessionInvalid();
          return;
        }
        setAvailabilityResult({
          key: availabilityKey,
          status: "error",
          dates: {},
          error: error instanceof ApiError ? error.message : "Could not load available dates. Please try again.",
        });
      });
    return () => controller.abort();
  }, [availabilityKey, contactReady, initialDraft, monthRange.from, monthRange.to, onSessionInvalid, project, sessionId, sessionToken]);

  useEffect(() => {
    if (phase === "confirmed") {
      clearGuestBookingDraft(sessionId);
      return;
    }
    const state = persistedBookingState(phase, selectedDate, selectedSlot);
    writeGuestBookingDraft(sessionId, { project, date: selectedDate, slot: selectedSlot, state });
  }, [phase, project, selectedDate, selectedSlot, sessionId]);

  useEffect(() => {
    const delay = getMillisecondsUntilNextIndiaMidnight(clockNow);
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const nextToday = getIndiaTodayIso(new Date(now));
      const nextMonth = getIndiaCurrentMonth(new Date(now));
      setClockNow(now);
      setMonth((current) => current < nextMonth ? nextMonth : current);
      setRefreshAvailability((value) => value + 1);
      if (phase !== "submitting" && selectedDate && selectedDate < nextToday) {
        setSelectedDate("");
        setSelectedSlot("");
        setPhase("selecting_date");
        setBookingError("The selected date has passed. Please choose a new date.");
      }
    }, delay + 25);
    return () => window.clearTimeout(timer);
  }, [clockNow, phase, selectedDate]);

  useEffect(() => {
    if (phase !== "submitting") return undefined;
    function warnBeforeNavigation(event) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeNavigation);
    return () => window.removeEventListener("beforeunload", warnBeforeNavigation);
  }, [phase]);

  const calendarCells = useMemo(() => getMonthCalendarCells(month), [month]);
  const canGoPrevious = shiftMonth(month, -1) >= currentMonth;
  const availableDates = Object.keys(availability);
  const isSubmitting = phase === "submitting";
  const selectedSlotAvailable = Boolean(selectedDate && selectedSlot && (availability[selectedDate] ?? []).includes(selectedSlot));

  function chooseProject(nextProject) {
    restoreDraftPending.current = false;
    setProject(nextProject);
    setShowAllProjects(false);
    setSelectedDate("");
    setSelectedSlot("");
    setBookingError("");
    setBookingConflict(false);
    setMonth(currentMonth);
    setPhase(contactReady ? "selecting_date" : "collecting_contact");
  }

  async function submitBooking(slot = selectedSlot, contactReady = contact) {
    if (!project || !selectedDate || !slot || phase === "submitting" || bookingLock.current) return;
    if (!contactReady.captured || !contactReady.hasPhone) {
      setSelectedSlot(slot);
      setPhase("collecting_contact");
      return;
    }
    bookingLock.current = true;
    onSubmittingChange?.(true);
    setPhase("submitting");
    setBookingError("");
    setBookingConflict(false);
    try {
      const data = await bookGuestSiteVisit(sessionId, sessionToken, {
        project,
        date: selectedDate,
        slot,
      });
      if (!data?.success || !data.booking?.id || data.booking.status !== "Scheduled") {
        throw new Error("We could not confirm that booking. Please retry or choose another slot.");
      }
      setConfirmedBooking(data.booking);
      clearGuestBookingDraft(sessionId);
      onBookingConfirmed?.(data.booking);
      onComplete?.();
    } catch (error) {
      if (error instanceof ApiError && SESSION_INVALID_STATUSES.has(error.status)) {
        onSessionInvalid();
        return;
      }
      if (error instanceof ApiError && error.status === 422 && error.data?.code === "contact_required") {
        setPhase("collecting_contact");
        setBookingError("Please share your name and phone number before booking.");
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        setSelectedSlot("");
        setBookingConflict(true);
        setBookingError(error.data?.code === "visit_already_scheduled"
          ? "A site visit is already scheduled for this enquiry. Please contact the sales team if you need to change it."
          : "That slot was just taken. Availability has been refreshed; please choose another slot.");
        setRefreshAvailability((value) => value + 1);
        setPhase("selecting_slot");
        return;
      }
      const uncertain = !(error instanceof ApiError) || error.status >= 500;
      setBookingError(uncertain
        ? "We couldn't verify whether the booking was saved. Retry this same selection to safely check the result."
        : error.message || "Could not confirm the booking. Please retry.");
      setPhase("booking_error");
    } finally {
      bookingLock.current = false;
      onSubmittingChange?.(false);
    }
  }

  function handleSlotSelect(slot) {
    setSelectedSlot(slot);
    setBookingError("");
    setPhase("review");
  }

  function handleContactCaptured(data) {
    const updated = {
      captured: data?.contactCaptured !== false,
      hasPhone: data?.hasPhone === true,
      name: data?.contactName ?? contact.name,
    };
    setContactOverride(updated);
    onContactCaptured(data);
    if (updated.captured && updated.hasPhone) {
      setPhase(getGuestBookingPhaseAfterContact({
        restoringDraft: restoreDraftPending.current,
        selectedDate,
        selectedSlot,
      }));
    }
  }

  function refreshDates() {
    setRefreshAvailability((value) => value + 1);
  }

  function hideBooking() {
    if (isSubmitting || isBusy) return;
    writeGuestBookingDraft(sessionId, {
      project,
      date: selectedDate,
      slot: selectedSlot,
      state: persistedBookingState(phase, selectedDate, selectedSlot),
    });
    onHide?.();
  }

  function cancelBooking() {
    if (isSubmitting || isBusy) return;
    clearGuestBookingDraft(sessionId);
    onCancel?.();
  }

  return (
    <section className="mx-auto my-5 w-full max-w-3xl overflow-hidden rounded-2xl border border-[#527A65]/20 bg-white shadow-sm" aria-label="Book a site visit">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 bg-[#F7F9F6] px-4 py-3 sm:px-5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 rounded-lg bg-[#EDF3EE] p-2 text-[#527A65]"><CalendarDays size={18} aria-hidden /></span>
          <div><h2 className="font-semibold text-gray-900">Plan a site visit</h2><p className="mt-0.5 text-xs text-gray-600">Choose a project, date and available time in this conversation.</p></div>
        </div>
        <button type="button" onClick={hideBooking} disabled={isSubmitting || isBusy} className="min-h-9 rounded-lg px-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50">Hide booking</button>
      </div>

      {phase === "confirmed" && confirmedBooking ? (
        <div className="p-4 sm:p-5" role="status" aria-live="polite">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <p className="text-sm font-semibold">Site visit confirmed</p>
            <p className="mt-1 text-sm">{confirmedBooking.confirmation}</p>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-emerald-800">Project</dt><dd className="font-medium">{confirmedBooking.project}</dd></div>
              <div><dt className="text-xs text-emerald-800">Date</dt><dd className="font-medium">{formatVisitDate(confirmedBooking.date)}</dd></div>
              <div><dt className="text-xs text-emerald-800">Time</dt><dd className="font-medium">{confirmedBooking.slot} IST</dd></div>
              {contact.name ? <div><dt className="text-xs text-emerald-800">Buyer</dt><dd className="font-medium">{contact.name}</dd></div> : null}
              <div><dt className="text-xs text-emerald-800">Status</dt><dd className="font-medium">{confirmedBooking.status}</dd></div>
            </dl>
          </div>
          <button type="button" onClick={onComplete} className="mt-4 min-h-10 rounded-lg bg-[#527A65] px-4 py-2 text-sm font-medium text-white hover:bg-[#42634F]">Continue chatting</button>
        </div>
      ) : (
        <div className="space-y-4 p-4 sm:p-5">
          {showAllProjects || !project ? (
            <div>
              <p className="mb-3 text-sm font-medium text-gray-900">
                {resolution.needsClarification
                  ? `Which project would you like to visit${resolution.candidates.length ? `: ${resolution.candidates.join(" or ")}` : "?"}`
                  : "Which project would you like to visit?"}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {GUEST_PROJECTS.map((name) => (
                  <button key={name} type="button" onClick={() => chooseProject(name)} className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-left text-sm text-gray-800 transition hover:border-[#527A65]/50 hover:bg-[#F7F9F6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65]/40">
                    <MapPin size={15} className="shrink-0 text-[#527A65]" aria-hidden />{name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F7F9F6] px-3 py-2.5">
              <p className="text-sm text-gray-700">Visit project: <span className="font-semibold text-gray-900">{project}</span></p>
                  <button type="button" disabled={isSubmitting} onClick={() => { setShowAllProjects(true); setPhase("selecting_project"); }} className="min-h-9 rounded-lg px-2 text-xs font-medium text-[#42634F] underline decoration-[#527A65]/40 underline-offset-2 disabled:opacity-50">Change project</button>
            </div>
          )}

          {project && !showAllProjects && contactReady ? (
            <>
              <div className="rounded-xl border border-gray-200 p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <button type="button" aria-label="Previous month" disabled={isSubmitting || !canGoPrevious || availabilityState === "loading"} onClick={() => { setMonth((value) => shiftMonth(value, -1)); setSelectedDate(""); setSelectedSlot(""); }} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={18} aria-hidden /></button>
                  <h3 className="text-sm font-semibold text-gray-900" aria-live="polite">{formatMonthLabel(month)}</h3>
                  <button type="button" aria-label="Next month" disabled={isSubmitting || availabilityState === "loading"} onClick={() => { setMonth((value) => shiftMonth(value, 1)); setSelectedDate(""); setSelectedSlot(""); }} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={18} aria-hidden /></button>
                </div>
                {availabilityState === "loading" ? <p className="mb-2 flex items-center justify-center gap-2 text-xs text-gray-500" role="status"><Loader2 size={14} className="animate-spin" aria-hidden />Checking available dates…</p> : null}
                <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`${formatMonthLabel(month)} calendar`}>
                  {WEEKDAYS.map((day) => <span key={day} className="py-1 text-[11px] font-medium text-gray-500" role="columnheader">{day}</span>)}
                  {calendarCells.map((date, index) => {
                    if (!date) return <span key={`empty-${index}`} className="min-h-10" aria-hidden="true" />;
                    const slots = availability[date] ?? [];
                    const beforeToday = date < today;
                    const enabled = availabilityState === "ready" && slots.length > 0 && !beforeToday && !isSubmitting;
                    const selected = selectedDate === date;
                    return (
                      <button key={date} type="button" role="gridcell" disabled={!enabled} aria-label={`${formatVisitDate(date)}${enabled ? ", available" : ", unavailable"}`} aria-pressed={selected} onClick={() => { setSelectedDate(date); setSelectedSlot(""); setBookingError(""); setPhase("selecting_slot"); }} className={`relative mx-auto flex min-h-10 w-full max-w-12 flex-col items-center justify-center rounded-lg text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65]/50 ${selected ? "bg-[#527A65] font-semibold text-white" : enabled ? "bg-[#EDF3EE] text-[#365744] hover:bg-[#dce9df]" : "cursor-not-allowed text-gray-300"}`}>
                        {Number(date.slice(-2))}{enabled && !selected ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#527A65]" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#527A65]" />Available dates</span><span>Unavailable dates are disabled</span></div>
                {availabilityState === "ready" && availableDates.length === 0 ? <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-center text-sm text-gray-600">No dates are currently available this month. Try another month.</p> : null}
                {availabilityState === "error" ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert"><span>{availabilityError}</span><button type="button" onClick={refreshDates} className="font-medium underline underline-offset-2">Retry</button></div> : null}
              </div>

              {selectedDate ? (
                <div className="rounded-xl border border-gray-200 p-3 sm:p-4">
                  <p className="mb-3 text-sm font-medium text-gray-900">Available slots for {formatVisitDate(selectedDate)}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(availability[selectedDate] ?? []).map((slot) => <button key={slot} type="button" disabled={isSubmitting} onClick={() => handleSlotSelect(slot)} className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#527A65]/40 ${selectedSlot === slot ? "border-[#527A65] bg-[#EDF3EE] text-[#365744]" : "border-gray-200 text-gray-700 hover:border-[#527A65]/50 hover:bg-[#F7F9F6]"}`}>{slot} IST</button>)}
                  </div>
                  {bookingConflict ? <p className="mt-3 text-sm text-amber-800" role="status">{bookingError}</p> : null}
                  {availabilityState === "ready" && (availability[selectedDate] ?? []).length === 0 ? <p className="text-sm text-gray-600">No available times remain for this date. Choose another date.</p> : null}
                </div>
              ) : null}
            </>
          ) : null}

          {phase === "collecting_contact" && project && !showAllProjects ? (
            <GuestBookingContactForm
              sessionId={sessionId}
              sessionToken={sessionToken}
              project={project}
              contactName={contact.name}
              hasPhone={contact.hasPhone}
              onSubmittingChange={onSubmittingChange}
              onSaved={handleContactCaptured}
              onSessionInvalid={onSessionInvalid}
            />
          ) : null}

          {phase === "review" && selectedSlot ? (
            <div className="rounded-xl border border-[#527A65]/25 bg-[#F7F9F6] p-4" aria-label="Review site visit booking">
              <p className="text-sm font-semibold text-gray-900">Review your visit</p>
              <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-gray-500">Project</dt><dd className="font-medium text-gray-900">{project}</dd></div>
                <div><dt className="text-xs text-gray-500">Date</dt><dd className="font-medium text-gray-900">{formatVisitDate(selectedDate)}</dd></div>
                <div><dt className="text-xs text-gray-500">Time</dt><dd className="font-medium text-gray-900">{selectedSlot} IST</dd></div>
                {contact.name ? <div><dt className="text-xs text-gray-500">Buyer</dt><dd className="font-medium text-gray-900">{contact.name}</dd></div> : null}
              </dl>
              <p className="mt-3 text-xs text-gray-600">The time is checked again when you confirm.</p>
              {!selectedSlotAvailable && availabilityState !== "loading" ? <p className="mt-2 text-sm text-amber-800" role="status">This selection is no longer available. Choose another time.</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void submitBooking(selectedSlot)} disabled={isSubmitting || isBusy || !selectedSlotAvailable} className="min-h-10 rounded-lg bg-[#527A65] px-4 py-2 text-sm font-medium text-white hover:bg-[#42634F] disabled:cursor-not-allowed disabled:opacity-50">Confirm site visit</button>
                <button type="button" onClick={() => setPhase("selecting_slot")} className="min-h-10 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white">Change date or time</button>
              </div>
            </div>
          ) : null}

          {phase === "restoring" ? <p className="flex items-center justify-center gap-2 rounded-lg bg-[#F7F9F6] px-3 py-3 text-sm text-gray-700" role="status"><Loader2 size={16} className="animate-spin" aria-hidden />Checking your saved date and time…</p> : null}
          {phase === "submitting" ? <p className="flex items-center justify-center gap-2 rounded-lg bg-[#F7F9F6] px-3 py-3 text-sm text-gray-700" role="status"><Loader2 size={16} className="animate-spin" aria-hidden />Confirming your site visit…</p> : null}
          {phase === "booking_error" ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800" role="alert"><p>{bookingError}</p><div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => void submitBooking()} disabled={!selectedSlot} className="font-medium underline underline-offset-2 disabled:opacity-50">Retry booking</button><button type="button" onClick={refreshDates} className="font-medium underline underline-offset-2">Refresh availability</button></div></div> : null}
          {bookingError && phase !== "booking_error" && !bookingConflict ? <p className="text-sm text-red-700" role="alert">{bookingError}</p> : null}

          {project ? <button type="button" disabled={isSubmitting || isBusy} onClick={() => { restoreDraftPending.current = false; setProject(null); setShowAllProjects(true); setSelectedDate(""); setSelectedSlot(""); setPhase("selecting_project"); }} className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50"><ArrowLeft size={14} aria-hidden />Choose another project</button> : null}
          {phase !== "confirmed" ? <button type="button" disabled={isSubmitting || isBusy} onClick={cancelBooking} className="ml-3 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw size={14} aria-hidden />Cancel booking</button> : null}
        </div>
      )}
    </section>
  );
}

export default GuestSiteVisitBooking;
