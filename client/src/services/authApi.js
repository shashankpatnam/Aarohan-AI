import { apiFetch } from "./api.js";

export async function loginStaff(email, password) {
  return apiFetch("/auth/login", {
    method: "POST",
    body: { email, password },
    skipAuth: true,
    skipUnauthorizedHandler: true,
  });
}

export async function fetchCurrentStaff() {
  return apiFetch("/auth/me", {
    skipUnauthorizedHandler: true,
  });
}

export async function logoutStaff() {
  return apiFetch("/auth/logout", {
    method: "POST",
    body: {},
    skipUnauthorizedHandler: true,
  });
}
