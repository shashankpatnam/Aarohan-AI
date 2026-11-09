import StaffUser from "../../models/StaffUser.js";
import { hashStaffPassword } from "../../utils/staffPassword.js";
import { signStaffToken } from "../../utils/staffJwt.js";

export const TEST_STAFF_JWT_SECRET = "test-staff-jwt-secret-key-32bytes-min!!";
export const TEST_STAFF_SETUP_SECRET = "test-staff-setup-secret-value";
export const TEST_STAFF_PASSWORD = "StaffPass12";

export function applyTestAuthEnv() {
  process.env.STAFF_JWT_SECRET = TEST_STAFF_JWT_SECRET;
  process.env.STAFF_SETUP_SECRET = TEST_STAFF_SETUP_SECRET;
  process.env.STAFF_BCRYPT_ROUNDS = "4";
  process.env.AUTH_RATE_LIMIT_DISABLED = "true";
}

/**
 * @param {import("supertest").Agent} agent
 * @param {() => string} getToken
 */
export function attachStaffAuth(agent, getToken) {
  const methods = ["get", "post", "put", "patch", "delete"];
  for (const method of methods) {
    const original = agent[method].bind(agent);
    agent[method] = (url) =>
      original(url).set("Authorization", `Bearer ${getToken()}`);
  }
  return agent;
}

export async function createTestStaffUser(overrides = {}) {
  const password = overrides.password || TEST_STAFF_PASSWORD;
  const passwordHash =
    overrides.passwordHash || (await hashStaffPassword(password));

  const user = await StaffUser.create({
    name: overrides.name || "Test Staff",
    email: (overrides.email || "staff@aarohan.test").toLowerCase(),
    passwordHash,
    role: overrides.role || "staff",
    isActive: overrides.isActive ?? true,
    bootstrapSlot: overrides.bootstrapSlot,
    tokenVersion: overrides.tokenVersion ?? 0,
  });

  return user;
}

export function staffBearerHeader(userOrToken) {
  const token =
    typeof userOrToken === "string" ? userOrToken : signStaffToken(userOrToken);
  return { Authorization: `Bearer ${token}` };
}

export async function seedCrmStaffToken() {
  applyTestAuthEnv();
  const user = await createTestStaffUser({
    name: "CRM Test Staff",
    email: "crm.staff@aarohan.test",
    role: "staff",
  });
  return { user, token: signStaffToken(user) };
}
