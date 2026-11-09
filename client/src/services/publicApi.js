import { ApiError } from "./api.js";
import { buildApiUrl } from "./apiConfig.js";

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, sessionToken?: string, signal?: AbortSignal }} [options]
 */
async function publicFetch(path, options = {}) {
  const { method = "GET", body, sessionToken, signal } = options;

  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }

  const response = await fetch(buildApiUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = null;
  const text = await response.text();

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = guestSafeErrorMessage(response.status, data);
    throw new ApiError(message, response.status, data);
  }

  return data;
}

/**
 * @param {number} status
 * @param {Record<string, unknown>|null} data
 */
function guestSafeErrorMessage(status, data) {
  if (status === 410) {
    return "This conversation has expired. Please start a new chat.";
  }
  if (status === 401) {
    return "This conversation session is no longer valid. Please start a new chat.";
  }
  if (status === 404) {
    return "We could not find this conversation. Please start a new chat.";
  }
  if (status === 422) {
    if (data?.code === "contact_required") {
      return "Please share your contact details before requesting a callback.";
    }
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message;
    }
    return "Please complete the required information and try again.";
  }
  if (status === 409) {
    if (data?.code === "slot_unavailable") {
      return "That time slot is no longer available. Please choose another.";
    }
    if (data?.code === "visit_already_scheduled") {
      return "A site visit is already scheduled for this enquiry.";
    }
    return "We could not save your details right now. Please try again.";
  }
  if (status === 400) {
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      return data.errors.join(". ");
    }
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message;
    }
    return "Please check your message and try again.";
  }
  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message;
  }
  return "Something went wrong. Please try again.";
}

export async function createGuestSession(intent) {
  return publicFetch("/public/sessions", {
    method: "POST",
    body: intent,
  });
}

export async function fetchPublicProjects() {
  return publicFetch("/public/projects");
}

export async function fetchGuestSession(sessionId, sessionToken) {
  return publicFetch(
    `/public/sessions/${encodeURIComponent(sessionId)}`,
    { sessionToken },
  );
}

export async function submitGuestContact(sessionId, sessionToken, payload) {
  return publicFetch(
    `/public/sessions/${encodeURIComponent(sessionId)}/contact`,
    {
      method: "POST",
      sessionToken,
      body: payload,
    },
  );
}

export async function requestGuestCallback(sessionId, sessionToken, payload) {
  return publicFetch(
    `/public/sessions/${encodeURIComponent(sessionId)}/callback`,
    {
      method: "POST",
      sessionToken,
      body: payload,
    },
  );
}

export async function sendGuestChatMessage(sessionId, sessionToken, message) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  return publicFetch(
    `/public/sessions/${encodeURIComponent(sessionId)}/chat`,
    {
      method: "POST",
      sessionToken,
      body: { message: trimmed },
    },
  );
}

export async function fetchGuestVisitAvailability(sessionId, sessionToken, project, from, to, signal) {
  const query = new URLSearchParams({ project, from, to });
  return publicFetch(
    `/public/sessions/${encodeURIComponent(sessionId)}/visit-availability?${query}`,
    { sessionToken, signal },
  );
}

export async function bookGuestSiteVisit(sessionId, sessionToken, booking) {
  return publicFetch(`/public/sessions/${encodeURIComponent(sessionId)}/visits`, {
    method: "POST",
    sessionToken,
    body: booking,
  });
}
