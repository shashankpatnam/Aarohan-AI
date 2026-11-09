import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, UserRound } from "lucide-react";
import { ApiError } from "../../services/api.js";
import { submitGuestContact } from "../../services/publicApi.js";

const inputClassName =
  "w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50 disabled:text-gray-500";

/**
 * @param {{
 *   sessionId: string,
 *   sessionToken: string,
 *   project: string|null,
 *   contactCaptured: boolean,
 *   hasPhone?: boolean,
 *   contactName?: string|null,
 *   requirePhone?: boolean,
 *   onContactCaptured: (contact: { message?: string, contactName?: string|null, hasPhone?: boolean }) => void,
 *   onSessionInvalid: () => void,
 *   expandRequest?: number,
 * }} props
 */
function GuestContactPanel({
  sessionId,
  sessionToken,
  project,
  contactCaptured,
  hasPhone = false,
  contactName = null,
  requirePhone = false,
  onContactCaptured,
  onSessionInvalid,
  expandRequest = 0,
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissedExpandRequest, setDismissedExpandRequest] = useState(0);
  const [name, setName] = useState(contactName ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitPending, setSubmitPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmationMessage, setConfirmationMessage] = useState("");

  const SESSION_INVALID_STATUSES = new Set([401, 404, 410]);

  const phoneNeeded = requirePhone && !hasPhone;
  const isExpanded =
    phoneNeeded ||
    expanded ||
    (expandRequest > dismissedExpandRequest && !contactCaptured);

  function toggleExpanded() {
    if (isExpanded) {
      setExpanded(false);
      setDismissedExpandRequest(expandRequest);
    } else {
      setExpanded(true);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitPending || (contactCaptured && !phoneNeeded)) {
      return;
    }

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setFormError("Please enter your name.");
      return;
    }
    if (requirePhone && !trimmedPhone) {
      setFormError("Please enter a phone number to book your site visit.");
      return;
    }
    if (!trimmedPhone && !trimmedEmail) {
      setFormError("Please enter a phone number or email address.");
      return;
    }

    setSubmitPending(true);
    setFormError("");

    try {
      const data = await submitGuestContact(sessionId, sessionToken, {
        name: trimmedName,
        phone: trimmedPhone,
        email: trimmedEmail,
      });

      const message =
        data.confirmation?.message ??
        "Thank you. Our team will follow up with you soon.";
      setConfirmationMessage(message);
      setExpanded(false);
      onContactCaptured({
        ...(data.session ?? {}),
        contactName: data.session?.contactName ?? trimmedName,
        hasPhone: data.session?.hasPhone ?? Boolean(trimmedPhone),
        confirmation: data.confirmation ?? { message },
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        SESSION_INVALID_STATUSES.has(error.status)
      ) {
        onSessionInvalid();
        return;
      }
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Could not save your details. Please try again.",
      );
    } finally {
      setSubmitPending(false);
    }
  }

  if ((contactCaptured || confirmationMessage) && !phoneNeeded) {
    return (
      <div
        className="mt-3 rounded-lg border border-[#527A65]/20 bg-[#EDF3EE] px-3 py-2.5 text-sm text-[#42634F]"
        role="status"
      >
        <span className="font-medium">Details received.</span>{" "}
        {confirmationMessage ||
          "Our sales team can follow up about your enquiry."}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200/80 bg-[#FAFAF8]">
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm font-medium text-gray-900"
        aria-expanded={isExpanded}
      >
        <span className="inline-flex items-center gap-2">
          <UserRound size={16} strokeWidth={1.75} className="text-[#527A65]" />
          {phoneNeeded ? (contactCaptured ? "Add a phone number to book" : "Share contact details to book") : "Share contact details"}
        </span>
        {isExpanded ? (
          <ChevronUp size={16} aria-hidden />
        ) : (
          <ChevronDown size={16} aria-hidden />
        )}
      </button>

      {isExpanded ? (
        <form onSubmit={handleSubmit} className="border-t border-gray-200/80 px-3 pb-3 pt-3">
          <p className="mb-3 text-xs leading-relaxed text-gray-600">
            {phoneNeeded
              ? contactCaptured
                ? "Please add your phone number to continue booking. It will be added to your existing enquiry."
                : `Share your name and phone number to create your enquiry and book a visit${project ? ` to ${project}` : ""}.`
              : requirePhone
                ? `Share your name and phone number to book a visit${project ? ` to ${project}` : ""}.`
                : `Optional—share your name and phone or email so our team can follow up ${project ? `about ${project}` : "about your Aarohan enquiry"}. You can keep chatting without submitting this.`}
          </p>

          <div className="space-y-3">
            <div>
              <label htmlFor="guest-contact-name" className="mb-1 block text-xs font-medium text-gray-700">
                Name
              </label>
              <input
                id="guest-contact-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={submitPending}
                className={inputClassName}
              />
            </div>
            <div>
              <label htmlFor="guest-contact-phone" className="mb-1 block text-xs font-medium text-gray-700">
                Phone
              </label>
              <input
                id="guest-contact-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={submitPending}
                className={inputClassName}
                placeholder="Include country code if outside India"
              />
            </div>
            <div>
              <label htmlFor="guest-contact-email" className="mb-1 block text-xs font-medium text-gray-700">
                Email
              </label>
              <input
                id="guest-contact-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitPending || (contactCaptured && !phoneNeeded)}
                className={inputClassName}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitPending}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#527A65] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[#42634F] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {submitPending ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              phoneNeeded && contactCaptured ? "Save phone number" : requirePhone ? "Continue with booking" : "Send details to sales team"
            )}
          </button>

          {formError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export default GuestContactPanel;
