import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Calendar,
  CalendarCheck,
  Clock,
  MapPin,
  User,
  X,
} from "lucide-react";
import { ApiError, createVisit, fetchAvailability } from "../../services/api.js";

const EXECUTIVES = ["Sneha Rao", "Arjun Nair", "Karan Mehta"];

function defaultVisitDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(isoDate) {
  if (!isoDate) return "—";
  const parsed = new Date(`${isoDate}T12:00:00`);
  return parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fieldClassName() {
  return "mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15";
}

function slotButtonClassName(selected, disabled) {
  if (disabled) {
    return "cursor-not-allowed rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-400 line-through";
  }
  return `rounded-lg border px-3 py-2 text-sm font-medium transition ${
    selected
      ? "border-[#527A65]/40 bg-[#EDF3EE] text-[#42634F] ring-1 ring-[#527A65]/20"
      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
  }`;
}

function BookSiteVisitModal({
  open,
  onClose,
  leadId,
  buyerName,
  project,
  defaultExecutive = "",
  onBooked,
}) {
  const titleId = useId();
  const [visitDate, setVisitDate] = useState(defaultVisitDate);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [executive, setExecutive] = useState(defaultExecutive);
  const [notes, setNotes] = useState("");
  const [availabilitySlots, setAvailabilitySlots] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(null);
  const [bookingError, setBookingError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const wasOpenRef = useRef(false);

  const minDate = new Date().toISOString().slice(0, 10);

  const loadAvailability = useCallback(async () => {
    if (!project || !visitDate) {
      return;
    }

    setAvailabilityLoading(true);
    setAvailabilityError(null);

    try {
      const data = await fetchAvailability(project, visitDate);
      setAvailabilitySlots(data.slots ?? []);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load availability. Please try again.";
      setAvailabilityError(message);
      setAvailabilitySlots([]);
    } finally {
      setAvailabilityLoading(false);
    }
  }, [project, visitDate]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setVisitDate(defaultVisitDate());
      setSelectedSlot("");
      setExecutive(
        defaultExecutive && EXECUTIVES.includes(defaultExecutive)
          ? defaultExecutive
          : "",
      );
      setNotes("");
      setBookingError("");
      setSubmitting(false);
    }

    wasOpenRef.current = open;
  }, [open, defaultExecutive]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(loadAvailability, 0);
    return () => window.clearTimeout(timer);
  }, [open, visitDate, loadAvailability]);

  if (!open) return null;

  const selectedSlotBooked = availabilitySlots.some(
    (entry) => entry.slot === selectedSlot && entry.booked,
  );

  const canConfirm =
    Boolean(visitDate && selectedSlot && executive && leadId) &&
    !submitting &&
    !availabilityLoading &&
    !availabilityError &&
    !selectedSlotBooked;

  async function handleConfirm() {
    if (!canConfirm || submitting) {
      return;
    }

    setSubmitting(true);
    setBookingError("");

    try {
      const data = await createVisit(leadId, {
        visitDate,
        slot: selectedSlot,
        executive,
        notes: notes.trim(),
      });

      if (onBooked) {
        await onBooked(data.visit);
      }
      onClose();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not create booking. Please try again.";
      setBookingError(message);

      if (error instanceof ApiError && error.status === 409) {
        await loadAvailability();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleVisitDateChange(nextDate) {
    setVisitDate(nextDate);
    setSelectedSlot("");
    setBookingError("");
  }

  function handleBackdropClose() {
    if (submitting) {
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-gray-900/40"
        onClick={handleBackdropClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col rounded-xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-gray-100 p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    id={titleId}
                    className="text-lg font-semibold text-gray-900"
                  >
                    Book site visit
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Schedule an on-site tour for this buyer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackdropClose}
                  disabled={submitting}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-4 rounded-lg bg-[#FAFAF8] px-4 py-3">
                <p className="text-sm font-medium text-gray-900">{buyerName}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
                  <MapPin size={14} className="shrink-0 text-gray-400" />
                  {project}
                </p>
              </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
          {bookingError && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {bookingError}
            </p>
          )}
          <div>
            <label
              htmlFor="visit-date"
              className="flex items-center gap-2 text-sm font-medium text-gray-700"
            >
              <Calendar size={16} className="text-[#527A65]" />
              Visit date
            </label>
            <input
              id="visit-date"
              type="date"
              min={minDate}
              value={visitDate}
              disabled={submitting}
              onChange={(e) => handleVisitDateChange(e.target.value)}
              className={`${fieldClassName()} disabled:bg-gray-50`}
            />
          </div>

          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Clock size={16} className="text-[#527A65]" />
              Available time slots
            </p>
            {availabilityLoading ? (
              <p className="mt-2 text-sm text-gray-500">Loading slots…</p>
            ) : availabilityError ? (
              <div className="mt-2 rounded-lg border border-gray-200 bg-[#FAFAF8] px-3 py-3">
                <p className="text-sm text-gray-600">{availabilityError}</p>
                <button
                  type="button"
                  onClick={loadAvailability}
                  className="mt-2 text-sm font-medium text-[#42634F] hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {availabilitySlots.map(({ slot, booked }) => (
                  <button
                    key={slot}
                    type="button"
                    disabled={booked || submitting}
                    onClick={() => setSelectedSlot(slot)}
                    className={slotButtonClassName(
                      selectedSlot === slot,
                      booked,
                    )}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <User size={16} className="text-[#527A65]" />
              Sales executive
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXECUTIVES.map((name) => (
                <button
                  key={name}
                  type="button"
                  disabled={submitting}
                  onClick={() => setExecutive(name)}
                  className={slotButtonClassName(executive === name, false)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="visit-notes"
              className="block text-sm font-medium text-gray-700"
            >
              Notes{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              id="visit-notes"
              rows={3}
              value={notes}
              disabled={submitting}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Parking preference, units to show, language for the tour…"
              className={`${fieldClassName()} resize-none disabled:bg-gray-50`}
            />
          </div>

          <div className="rounded-lg border border-[#527A65]/15 bg-[#EDF3EE]/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[#42634F]">
              Booking summary
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Date</dt>
                <dd className="font-medium text-gray-800">
                  {formatDisplayDate(visitDate)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Time slot</dt>
                <dd className="font-medium text-gray-800">
                  {selectedSlot || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Executive</dt>
                <dd className="font-medium text-gray-800">
                  {executive || "—"}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-100 p-5 sm:flex-row sm:justify-end sm:p-6">
          <button
            type="button"
            onClick={handleBackdropClose}
            disabled={submitting}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#527A65] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#42634F] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarCheck size={17} strokeWidth={1.75} />
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BookSiteVisitModal;
