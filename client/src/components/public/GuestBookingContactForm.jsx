import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ApiError } from "../../services/api.js";
import { submitGuestContact } from "../../services/publicApi.js";
import { validateGuestBookingContact } from "../../utils/guestBookingContact.js";

const SESSION_INVALID_STATUSES = new Set([401, 404, 410]);
const inputClassName = "w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50 disabled:text-gray-500";

function GuestBookingContactForm({ sessionId, sessionToken, project, contactName, hasPhone, onSubmittingChange, onSaved, onSessionInvalid }) {
  const [name, setName] = useState(contactName ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [pending, setPending] = useState(false);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!pending) return undefined;
    function warnBeforeLeaving(event) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [pending]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || submitLock.current) return;
    const validated = validateGuestBookingContact({ name, phone, email });
    setFieldErrors(validated.errors);
    setSubmitError("");
    if (Object.keys(validated.errors).length) return;

    submitLock.current = true;
    setPending(true);
    onSubmittingChange?.(true);
    try {
      const data = await submitGuestContact(sessionId, sessionToken, validated.value);
      if (data?.success !== true || data.session?.contactCaptured !== true || data.session?.hasPhone !== true) {
        throw new Error("We could not verify that your details were saved. Please try again.");
      }
      onSaved(data.session);
    } catch (error) {
      if (error instanceof ApiError && SESSION_INVALID_STATUSES.has(error.status)) {
        onSessionInvalid();
        return;
      }
      setSubmitError(error instanceof ApiError ? error.message : error.message || "Could not save your details. Please try again.");
    } finally {
      submitLock.current = false;
      setPending(false);
      onSubmittingChange?.(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#527A65]/20 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="booking-contact-title">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#527A65]">Site visit details</p>
        <h3 id="booking-contact-title" className="mt-1 text-base font-semibold text-gray-900">Your Contact Details</h3>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">Please share your details so we can coordinate your site visit{project ? ` to ${project}` : ""}.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <div>
          <label htmlFor="booking-contact-name" className="mb-1.5 block text-sm font-medium text-gray-800">Full name <span aria-hidden="true">*</span></label>
          <input id="booking-contact-name" name="name" autoComplete="name" autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={pending} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "booking-contact-name-error" : undefined} className={inputClassName} />
          {fieldErrors.name ? <p id="booking-contact-name-error" className="mt-1 text-xs text-red-700" role="alert">{fieldErrors.name}</p> : null}
        </div>
        <div>
          <label htmlFor="booking-contact-phone" className="mb-1.5 block text-sm font-medium text-gray-800">Mobile number <span aria-hidden="true">*</span></label>
          <input id="booking-contact-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="Include country code if outside India" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={pending} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? "booking-contact-phone-error" : "booking-contact-phone-help"} className={inputClassName} />
          {fieldErrors.phone ? <p id="booking-contact-phone-error" className="mt-1 text-xs text-red-700" role="alert">{fieldErrors.phone}</p> : <p id="booking-contact-phone-help" className="mt-1 text-xs text-gray-500">Use 7 to 15 digits. Add a country code if needed.</p>}
          {hasPhone ? <p className="mt-1 text-xs text-gray-500">Add the mobile number needed to continue this booking.</p> : null}
        </div>
        <div>
          <label htmlFor="booking-contact-email" className="mb-1.5 block text-sm font-medium text-gray-800">Email address <span className="font-normal text-gray-500">(optional)</span></label>
          <input id="booking-contact-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "booking-contact-email-error" : undefined} className={inputClassName} />
          {fieldErrors.email ? <p id="booking-contact-email-error" className="mt-1 text-xs text-red-700" role="alert">{fieldErrors.email}</p> : null}
        </div>
        {submitError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{submitError}</p> : null}
        <button type="submit" disabled={pending} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#527A65] px-4 py-2 text-sm font-medium text-white hover:bg-[#42634F] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
          {pending ? <><Loader2 size={16} className="animate-spin" aria-hidden />Saving details…</> : "Continue to available dates"}
        </button>
      </form>
    </section>
  );
}

export default GuestBookingContactForm;
