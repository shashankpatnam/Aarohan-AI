import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLastActiveAdmin,
  sanitizeStaffUser,
} from "../../client/src/utils/staffAccountGuards.js";

describe("staffAccountGuards", () => {
  const admin = {
    id: "1",
    name: "Rahul",
    email: "admin@example.com",
    role: "admin",
    isActive: true,
  };
  const staff = {
    id: "2",
    name: "Sneha",
    email: "staff@example.com",
    role: "staff",
    isActive: true,
  };

  it("blocks deactivation UI for the only active admin", () => {
    assert.equal(isLastActiveAdmin([admin, staff], admin), true);
    assert.equal(isLastActiveAdmin([admin, staff], staff), false);
  });

  it("allows deactivation when another active admin remains", () => {
    const secondAdmin = { ...admin, id: "3", email: "admin2@example.com" };
    assert.equal(isLastActiveAdmin([admin, secondAdmin], admin), false);
  });

  it("strips unexpected secret fields from staff DTOs", () => {
    const sanitized = sanitizeStaffUser({
      id: "abc",
      name: "Rahul",
      email: "rahul@example.com",
      role: "admin",
      isActive: true,
      createdAt: "2026-11-07T08:33:01.744Z",
      updatedAt: "2026-11-07T08:33:01.744Z",
      password: "should-not-leak",
      passwordHash: "$2a$should-not-leak",
      tokenVersion: 3,
    });

    assert.deepEqual(Object.keys(sanitized).sort(), [
      "createdAt",
      "email",
      "id",
      "isActive",
      "name",
      "role",
      "updatedAt",
    ]);
    assert.equal(sanitized.password, undefined);
    assert.equal(sanitized.passwordHash, undefined);
  });
});
