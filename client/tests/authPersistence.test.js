import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import {
  clearStaffToken,
  readStaffToken,
  writeStaffToken,
} from "../src/services/staffAuthStorage.js";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

afterEach(() => values.clear());

test("staff credentials use origin shared storage for fresh tabs", () => {
  writeStaffToken("jwt-token");
  assert.equal(readStaffToken(), "jwt-token");
  assert.equal(values.get("aarohan_staff_token"), "jwt-token");
  clearStaffToken();
  assert.equal(readStaffToken(), null);
});

test("protected routes wait for restoration before redirecting", async () => {
  const source = await readFile(new URL("../src/components/auth/RequireStaff.jsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("if (!ready)") < source.indexOf("if (!isAuthenticated)"));
});

test("auth provider revalidates shared sessions after tab changes and periodically", async () => {
  const source = await readFile(new URL("../src/context/AuthContext.jsx", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("storage", onStorage\)/);
  assert.match(source, /addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(source, /setInterval\(restoreFromSharedSession, 60_000\)/);
  assert.match(source, /fetchCurrentStaff\(\)/);
});
