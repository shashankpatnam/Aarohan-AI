const STORAGE_KEY = "aarohan_staff_token";

export function readStaffToken() {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function writeStaffToken(token) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearStaffToken() {
  localStorage.removeItem(STORAGE_KEY);
}
