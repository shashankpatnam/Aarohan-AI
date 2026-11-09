import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setUnauthorizedHandler } from "../services/api.js";
import { AuthContext } from "./AuthContextValue.js";
import {
  fetchCurrentStaff,
  loginStaff as loginStaffRequest,
  logoutStaff as logoutStaffRequest,
} from "../services/authApi.js";
import {
  clearStaffToken,
  readStaffToken,
  writeStaffToken,
} from "../services/staffAuthStorage.js";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const clearSession = useCallback(() => {
    clearStaffToken();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearStaffToken();
      setUser(null);
    });

    let cancelled = false;

    async function restore() {
      const token = readStaffToken();
      if (!token) {
        if (!cancelled) {
          setReady(true);
        }
        return;
      }

      try {
        const data = await fetchCurrentStaff();
        if (!cancelled) {
          setUser(data.user ?? null);
        }
      } catch {
        clearStaffToken();
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    restore();

    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  // localStorage is shared by tabs. Revalidate on changes and when a tab
  // becomes active so logout and server-side account revocation propagate.
  useEffect(() => {
    let requestId = 0;
    let active = true;

    async function restoreFromSharedSession() {
      const id = ++requestId;
      if (!readStaffToken()) {
        setUser(null);
        setReady(true);
        return;
      }
      try {
        const data = await fetchCurrentStaff();
        if (active && id === requestId) setUser(data.user ?? null);
      } catch {
        clearStaffToken();
        if (active && id === requestId) setUser(null);
      }
    }

    function onStorage(event) {
      if (event.key === "aarohan_staff_token") {
        setReady(false);
        restoreFromSharedSession();
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") restoreFromSharedSession();
    }

    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(restoreFromSharedSession, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await loginStaffRequest(email, password);
    if (!data?.token || !data?.user) {
      throw new Error("Login did not return credentials");
    }
    writeStaffToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (readStaffToken()) {
        await logoutStaffRequest();
      }
    } catch {
      // Client session is cleared regardless of network errors.
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      ready,
      isAuthenticated: Boolean(user),
      login,
      logout,
    }),
    [user, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

