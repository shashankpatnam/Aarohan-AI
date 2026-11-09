import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Shield, UserPlus, UserX } from "lucide-react";
import { useAuth } from "../context/useAuth.js";
import { ApiError, createStaffAccount, fetchStaffAccounts, updateStaffAccount } from "../services/api.js";
import {
  isLastActiveAdmin,
  sanitizeStaffUser,
} from "../utils/staffAccountGuards.js";

const INPUT_CLASS =
  "mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#527A65]/40 focus:ring-2 focus:ring-[#527A65]/15 disabled:bg-gray-50";

function formatStaffTime(iso) {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RoleBadge({ role }) {
  const isAdmin = role === "admin";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        isAdmin
          ? "bg-[#EDF3EE] text-[#42634F] ring-[#527A65]/15"
          : "bg-gray-50 text-gray-700 ring-gray-600/10"
      }`}
    >
      {isAdmin ? "Admin" : "Staff"}
    </span>
  );
}

function ActiveBadge({ isActive }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        isActive
          ? "bg-sky-50 text-sky-800 ring-sky-600/10"
          : "bg-gray-100 text-gray-600 ring-gray-500/10"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

const EMPTY_FORM = {
  name: "",
  email: "",
  password: "",
  role: "staff",
};

function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(isAdmin);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const loadStaff = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");

    try {
      const data = await fetchStaffAccounts();
      const list = Array.isArray(data.staff)
        ? data.staff.map(sanitizeStaffUser).filter(Boolean)
        : [];
      setStaff(list);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return;
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load staff accounts.";
      setLoadError(message);
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(loadStaff, 0);
    return () => window.clearTimeout(timer);
  }, [loadStaff]);

  const activeAdminCount = useMemo(
    () => staff.filter((person) => person.role === "admin" && person.isActive).length,
    [staff],
  );

  function updateFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (creating) {
      return;
    }

    const name = form.name.trim();
    const email = form.email.trim();
    const password = form.password;
    const role = form.role === "admin" ? "admin" : "staff";

    if (!name) {
      setFormError("Name is required.");
      setFormSuccess("");
      return;
    }
    if (name.length > 120) {
      setFormError("Name must be 120 characters or fewer.");
      setFormSuccess("");
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) {
      setFormError("A valid email is required.");
      setFormSuccess("");
      return;
    }
    if (password.length < 10) {
      setFormError("Password must be at least 10 characters.");
      setFormSuccess("");
      return;
    }

    setCreating(true);
    setFormError("");
    setFormSuccess("");
    setActionError("");

    try {
      const data = await createStaffAccount({ name, email, password, role });
      const created = sanitizeStaffUser(data.user);
      setForm(EMPTY_FORM);
      setFormSuccess(
        created
          ? `Created ${created.name} (${created.email}) as ${created.role}.`
          : "Staff account created.",
      );
      await loadStaff();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return;
      }
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Could not create the staff account.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(member) {
    if (pendingId || !member?.id) {
      return;
    }

    const nextActive = !member.isActive;
    if (!nextActive) {
      if (isLastActiveAdmin(staff, member)) {
        setActionError("Cannot deactivate the last active administrator.");
        setActionSuccess("");
        return;
      }
      const confirmed = window.confirm(
        `Deactivate ${member.name} (${member.email})? They will not be able to sign in until reactivated.`,
      );
      if (!confirmed) {
        return;
      }
    }

    setPendingId(member.id);
    setActionError("");
    setActionSuccess("");

    try {
      const data = await updateStaffAccount(member.id, { isActive: nextActive });
      const updated = sanitizeStaffUser(data.user);
      setStaff((current) =>
        current.map((person) =>
          person.id === member.id && updated ? updated : person,
        ),
      );
      setActionSuccess(
        nextActive
          ? `${member.name} is active again.`
          : `${member.name} has been deactivated.`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return;
      }
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Could not update the staff account.",
      );
    } finally {
      setPendingId("");
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-[1.625rem]">
            Settings
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-gray-500">
            Workspace preferences for your sales login.
          </p>
        </div>
        <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm shadow-gray-900/[0.02]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FAFAF8] text-[#527A65]">
              <Shield size={18} strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Staff management
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">
                Only administrators can view or change staff accounts. Ask an
                admin if you need access.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-[1.625rem]">
            Settings
          </h1>
         
        </div>
        <button
          type="button"
          onClick={loadStaff}
          disabled={loading}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm shadow-gray-900/[0.02]">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus size={18} className="text-[#527A65]" strokeWidth={1.75} />
          <h2 className="text-base font-semibold text-gray-900">
            Create staff account
          </h2>
        </div>
        <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => updateFormField("name", event.target.value)}
              autoComplete="name"
              maxLength={120}
              className={INPUT_CLASS}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateFormField("email", event.target.value)}
              autoComplete="off"
              className={INPUT_CLASS}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) =>
                updateFormField("password", event.target.value)
              }
              autoComplete="new-password"
              minLength={10}
              className={INPUT_CLASS}
              required
            />
            <span className="mt-1 block text-xs text-gray-500">
              At least 10 characters. The password is never displayed after save.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Role</span>
            <select
              value={form.role}
              onChange={(event) => updateFormField("role", event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {formError ? (
            <p
              className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              role="alert"
            >
              {formError}
            </p>
          ) : null}
          {formSuccess ? (
            <p
              className="sm:col-span-2 rounded-lg border border-[#527A65]/20 bg-[#EDF3EE] px-3 py-2 text-sm text-[#42634F]"
              role="status"
            >
              {formSuccess}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#527A65] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#42634F] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {creating ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <UserPlus size={16} aria-hidden />
              )}
              {creating ? "Creating…" : "Create staff"}
            </button>
          </div>
        </form>
      </section>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-800">
            Could not load staff
          </p>
          <p className="mt-1 text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={loadStaff}
            className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50"
          >
            Try again
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}
      {actionSuccess ? (
        <p
          className="rounded-lg border border-[#527A65]/20 bg-[#EDF3EE] px-3 py-2 text-sm text-[#42634F]"
          role="status"
        >
          {actionSuccess}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm shadow-gray-900/[0.02]">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Staff accounts
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {activeAdminCount} active admin{activeAdminCount === 1 ? "" : "s"}
          </p>
        </div>

        {loading ? (
          <p className="flex items-center justify-center gap-2 px-5 py-16 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Loading staff…
          </p>
        ) : staff.length === 0 ? (
          <p className="px-5 py-16 text-center text-sm text-gray-500">
            No staff accounts were returned.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#FAFAF8] text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3">Updated</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {staff.map((member) => {
                  const lastAdmin = isLastActiveAdmin(staff, member);
                  const isSelf = member.id === user?.id;
                  const busy = pendingId === member.id;
                  return (
                    <tr key={member.id} className="align-top">
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {member.name}
                        {member.id === user?.id ? (
                          <span className="ml-2 text-xs font-normal text-gray-400">
                            You
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-gray-700">{member.email}</td>
                      <td className="px-5 py-3">
                        <RoleBadge role={member.role} />
                      </td>
                      <td className="px-5 py-3">
                        <ActiveBadge isActive={member.isActive} />
                      </td>
                      <td className="px-5 py-3 text-gray-600">
                        {formatStaffTime(member.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-gray-600">
                        {formatStaffTime(member.updatedAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {member.isActive ? (
                          <button
                            type="button"
                            disabled={busy || lastAdmin || isSelf}
                            title={
                              isSelf
                                ? "You cannot deactivate your own account. Ask another administrator."
                                : lastAdmin
                                  ? "Cannot deactivate the last active administrator"
                                  : "Deactivate this account"
                            }
                            onClick={() => handleToggleActive(member)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <UserX size={14} />
                            )}
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleActive(member)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#527A65] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#42634F] disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : null}
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default Settings;
