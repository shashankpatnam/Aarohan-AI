/**
 * @param {import("../models/StaffUser.js").default} user
 */
export function serializeStaffUser(user) {
  const doc = user.toObject ? user.toObject() : user;
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    role: doc.role,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
