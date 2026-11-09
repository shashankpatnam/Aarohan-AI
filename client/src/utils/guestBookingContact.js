const PHONE_ALLOWED_CHARACTERS = /^[\d\s+\-().]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function hasRequiredGuestBookingContact(contact = {}) {
  return (contact.captured === true || contact.contactCaptured === true) && contact.hasPhone === true;
}

export function getInitialGuestBookingPhase({ project, contactReady, draftDate }) {
  if (!project) return "selecting_project";
  if (!contactReady) return "collecting_contact";
  return draftDate ? "restoring" : "selecting_date";
}

export function getGuestBookingPhaseAfterContact({ restoringDraft, selectedDate, selectedSlot }) {
  if (restoringDraft && selectedDate && selectedSlot) return "restoring";
  if (restoringDraft && selectedDate) return "restoring";
  return "selecting_date";
}

export function getGuestBookingPhaseForResume({ project, contactReady, selectedDate, selectedSlot }) {
  if (!project) return "selecting_project";
  if (!contactReady) return "collecting_contact";
  if (selectedSlot) return "review";
  if (selectedDate) return "selecting_slot";
  return "selecting_date";
}

export function validateGuestBookingContact({ name, phone, email }) {
  const errors = {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedPhone = typeof phone === "string" ? phone.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";

  if (!trimmedName) errors.name = "Enter your full name.";
  else if (trimmedName.length > 120) errors.name = "Name must be 120 characters or fewer.";

  if (!trimmedPhone) errors.phone = "Enter your mobile number.";
  else {
    const digits = (trimmedPhone.match(/\d/g) ?? []).length;
    if (trimmedPhone.length > 40 || !PHONE_ALLOWED_CHARACTERS.test(trimmedPhone) || digits < 7 || digits > 15) {
      errors.phone = "Enter a valid number with 7 to 15 digits.";
    }
  }

  if (trimmedEmail && (trimmedEmail.length > 254 || !EMAIL_PATTERN.test(trimmedEmail))) {
    errors.email = "Enter a valid email address.";
  }

  return {
    errors,
    value: { name: trimmedName, phone: trimmedPhone, email: trimmedEmail },
  };
}
