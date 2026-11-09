import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBusinessDateRange } from "../src/utils/analyticsDateRange.js";

describe("analytics business date presets", () => {
  const now = new Date("2026-06-01T18:30:00.000Z"); // June 2 in Ahmedabad.

  it("includes today and the prior six calendar dates for Last 7 days", () => {
    assert.deepEqual(getBusinessDateRange(7, now), {
      from: "2026-05-27",
      to: "2026-06-02",
    });
  });

  it("includes today and the prior 29 calendar dates for Last 30 days", () => {
    assert.deepEqual(getBusinessDateRange(30, now), {
      from: "2026-05-04",
      to: "2026-06-02",
    });
  });
});
