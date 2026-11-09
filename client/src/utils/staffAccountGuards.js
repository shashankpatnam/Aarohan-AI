/**
 * UI helper only. The API still rejects deactivating the last active admin.
 *
 * @param {Array<{ id?: string, role?: string, isActive?: boolean }>} staffList
 * @param {{ id?: string, role?: string, isActive?: boolean }} member
 */
export function isLastActiveAdmin(staffList, member) {
  if (!member || member.role !== "admin" || member.isActive !== true) {
    return false;
  }

  const list = Array.isArray(staffList) ? staffList : [];
  const activeAdmins = list.filter(
    (person) => person?.role === "admin" && person.isActive === true,
  );

  if (activeAdmins.length === 0) {
    return true;
  }

  return (
    activeAdmins.length === 1 &&
    String(activeAdmins[0].id) === String(member.id)
  );
}

/**
 * Allowlisted staff DTO. Never keep password or hash fields if a response includes them.
 *
 * @param {unknown} user
 */
export function sanitizeStaffUser(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  const record = /** @type {Record<string, unknown>} */ (user);
  return {
    id: record.id != null ? String(record.id) : "",
    name: typeof record.name === "string" ? record.name : "",
    email: typeof record.email === "string" ? record.email : "",
    role: record.role === "admin" ? "admin" : "staff",
    isActive: record.isActive === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}
