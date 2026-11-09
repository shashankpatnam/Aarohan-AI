import { useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { ApiError } from "../../services/api.js";
import { requestGuestCallback } from "../../services/publicApi.js";

const inputClassName =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50";

/**
 * @param {{
 *   sessionId: string,
 *   sessionToken: string,
 *   contactCaptured: boolean,
 *   callbackPending: boolean,
 *   callbackRequested: boolean,
 *   onContactRequired: () => void,
 *   onCallbackUpdated: (payload: { confirmation?: { message?: string }, session?: Record<string, unknown> }) => void,
 *   onSessionInvalid: () => void,
 * }} props
 */
function GuestCallbackPanel({
  sessionId,
  sessionToken,
  contactCaptured,
  callbackPending,
  callbackRequested,
  onContactRequired,
  onCallbackUpdated,
  onSessionInvalid,
}) {
  const [expanded, setExpanded] = useState(false);
  const [preferredContactMethod, setPreferredContactMethod] = useState("");
  const [message, setMessage] = useState("");
  const [submitPending, setSubmitPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmationMessage, setConfirmationMessage] = useState("");

  const SESSION_INVALID_STATUSES = new Set([401, 404, 410]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitPending) {
      return;
    }

    if (!contactCaptured) {
      onContactRequired();
      setFormError(
        "Share your contact details first so our team can reach you.",
      );
      return;
    }

    setSubmitPending(true);
    setFormError("");

    try {
      const data = await requestGuestCallback(sessionId, sessionToken, {
        preferredContactMethod: preferredContactMethod || undefined,
        message: message.trim() || undefined,
      });

      const text =
        data.confirmation?.message ??
        "Your callback request has been received.";
      setConfirmationMessage(text);
      setExpanded(false);
      onCallbackUpdated(data);
    } catch (error) {
      if (
        error instanceof ApiError &&
        SESSION_INVALID_STATUSES.has(error.status)
      ) {
        onSessionInvalid();
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
        onContactRequired();
      }
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Could not submit your callback request. Please try again.",
      );
    } finally {
      setSubmitPending(false);
    }
  }

  if (confirmationMessage || (callbackRequested && callbackPending)) {
    return (
      <div
        className="mt-3 rounded-lg border border-[#527A65]/20 bg-[#EDF3EE] px-3 py-2.5 text-sm text-[#42634F]"
        role="status"
      >
        <span className="font-medium">Callback request received.</span>{" "}
        {confirmationMessage ||
          "Our sales team will contact you soon. You can keep chatting here."}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200/80 bg-[#FAFAF8]">
      <button
        type="button"
        onClick={() => {
          if (!contactCaptured) {
            onContactRequired();
            setFormError(
              "Share your contact details first so our team can reach you.",
            );
            return;
          }
          setExpanded((open) => !open);
        }}
        className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm font-medium text-gray-900"
        aria-expanded={expanded}
      >
        <span className="inline-flex items-center gap-2">
          <PhoneCall size={16} strokeWidth={1.75} className="text-[#527A65]" />
          Request a callback
        </span>
      </button>

      {expanded && contactCaptured ? (
        <form onSubmit={handleSubmit} className="border-t border-gray-200/80 px-3 pb-3 pt-3">
          <p className="mb-3 text-xs leading-relaxed text-gray-600">
            Ask our sales team to call or email you. This uses the same follow-up
            queue as other human handoffs.
          </p>
          <label
            htmlFor="guest-callback-method"
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Preferred contact method (optional)
          </label>
          <select
            id="guest-callback-method"
            value={preferredContactMethod}
            onChange={(event) => setPreferredContactMethod(event.target.value)}
            disabled={submitPending}
            className={`${inputClassName} mb-3`}
          >
            <option value="">No preference</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
          <label
            htmlFor="guest-callback-note"
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Short note (optional)
          </label>
          <textarea
            id="guest-callback-note"
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={submitPending}
            maxLength={500}
            placeholder="Best time to reach you, questions for the team…"
            className={`${inputClassName} resize-y`}
          />
          <button
            type="submit"
            disabled={submitPending}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#527A65] px-3 py-2.5 text-sm font-medium text-white hover:bg-[#42634F] disabled:opacity-50 sm:w-auto"
          >
            {submitPending ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden />
                Submitting…
              </>
            ) : (
              "Submit callback request"
            )}
          </button>
          {formError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
      ) : null}

      {!expanded && formError ? (
        <p className="px-3 pb-3 text-sm text-amber-800" role="status">
          {formError}
        </p>
      ) : null}
    </div>
  );
}

export default GuestCallbackPanel;
