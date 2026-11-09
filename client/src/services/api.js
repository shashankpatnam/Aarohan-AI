import { clearStaffToken, readStaffToken } from "./staffAuthStorage.js";
import { buildApiUrl } from "./apiConfig.js";

let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === "function" ? handler : null;
}

export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch(path, options = {}) {
  const {
    searchParams,
    headers: customHeaders,
    body,
    skipAuth = false,
    skipUnauthorizedHandler = false,
    ...rest
  } = options;

  const headers = new Headers(customHeaders);
  if (body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!skipAuth && !headers.has("Authorization")) {
    const token = readStaffToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(buildApiUrl(path, searchParams), {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const inactiveStaff =
      response.status === 403 && data?.message === "Staff account is inactive";
    if ((response.status === 401 || inactiveStaff) && !skipAuth && !skipUnauthorizedHandler) {
      clearStaffToken();
      unauthorizedHandler?.();
    }

    const message =
      data?.message ||
      (Array.isArray(data?.errors) ? data.errors.join(". ") : null) ||
      response.statusText ||
      "Request failed";

    throw new ApiError(message, response.status, data);
  }

  return data;
}

export async function fetchLeads(filters = {}) {
  const searchParams = new URLSearchParams();

  const search = filters.search?.trim();
  if (search) {
    searchParams.set("search", search);
  }
  if (filters.status && filters.status !== "all") {
    searchParams.set("status", filters.status);
  }
  if (filters.project && filters.project !== "all") {
    searchParams.set("project", filters.project);
  }
  if (filters.interestedProject && filters.interestedProject !== "all") {
    searchParams.set("interestedProject", filters.interestedProject);
  }
  if (filters.source && filters.source !== "all") {
    searchParams.set("source", filters.source);
  }

  return apiFetch("/leads", { searchParams });
}

export async function createLead(payload) {
  return apiFetch("/leads", {
    method: "POST",
    body: payload,
  });
}

export async function fetchLeadById(id) {
  return apiFetch(`/leads/${encodeURIComponent(id)}`);
}

export async function updateLead(id, payload) {
  return apiFetch(`/leads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
  });
}

export async function sendLeadChatMessage(leadId, message) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  return apiFetch(`/leads/${encodeURIComponent(leadId)}/chat`, {
    method: "POST",
    body: { message: trimmed },
  });
}

export async function fetchAvailability(project, date) {
  const searchParams = new URLSearchParams();
  searchParams.set("project", project);
  searchParams.set("date", date);
  return apiFetch("/availability", { searchParams });
}

export async function createVisit(leadId, payload) {
  return apiFetch(`/leads/${encodeURIComponent(leadId)}/visits`, {
    method: "POST",
    body: payload,
  });
}

export async function fetchVisits(filters = {}) {
  const searchParams = new URLSearchParams();

  const search = filters.search?.trim();
  if (search) {
    searchParams.set("search", search);
  }
  if (filters.project && filters.project !== "all") {
    searchParams.set("project", filters.project);
  }
  if (filters.status && filters.status !== "all") {
    searchParams.set("status", filters.status);
  }
  if (filters.date && filters.date !== "all") {
    searchParams.set("date", filters.date);
  }

  return apiFetch("/visits", { searchParams });
}

export async function fetchAnalytics(filters = {}) {
  const searchParams = new URLSearchParams();

  const from = filters.from?.trim();
  const to = filters.to?.trim();
  if (from) {
    searchParams.set("from", from);
  }
  if (to) {
    searchParams.set("to", to);
  }

  return apiFetch("/analytics", { searchParams });
}

export async function fetchHandoffs(filters = {}) {
  const searchParams = new URLSearchParams();
  const status = filters.status?.trim();
  if (status) {
    searchParams.set("status", status);
  }
  if (filters.page) searchParams.set("page", String(filters.page));
  if (filters.pageSize) searchParams.set("pageSize", String(filters.pageSize));
  return apiFetch("/handoffs", { searchParams });
}

export async function assignHandoff(leadId, executiveId) {
  return apiFetch(`/handoffs/${encodeURIComponent(leadId)}/assign`, {
    method: "PATCH",
    body: { executiveId },
  });
}

export async function resolveHandoff(leadId) {
  return apiFetch(`/handoffs/${encodeURIComponent(leadId)}/resolve`, {
    method: "PATCH",
    body: {},
  });
}

export async function updateVisitStatus(visitId, status) {
  return apiFetch(`/visits/${encodeURIComponent(visitId)}/status`, {
    method: "PATCH",
    body: { status },
  });
}

export async function fetchStaffAccounts() {
  return apiFetch("/staff");
}

export async function fetchEligibleStaff() {
  return apiFetch("/staff/eligible");
}

export async function createStaffAccount(payload) {
  return apiFetch("/staff", {
    method: "POST",
    body: payload,
  });
}

export async function updateStaffAccount(id, payload) {
  return apiFetch(`/staff/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
  });
}
