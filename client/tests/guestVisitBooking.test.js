import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMonthLabel,
  getIndiaCurrentMonth,
  getIndiaTodayIso,
  getMillisecondsUntilNextIndiaMidnight,
  getMonthAvailabilityRange,
  getMonthCalendarCells,
  isSiteVisitIntent,
  isBookingResumeRequest,
  isSiteVisitAvailabilityQuestion,
  revalidateBookingDraft,
  resolveVisitProject,
  shiftMonth,
} from "../src/utils/guestVisitBooking.js";
import {
  clearGuestBookingDraft,
  readGuestBookingDraft,
  writeGuestBookingDraft,
} from "../src/services/guestSessionStorage.js";

describe("guest site visit booking helpers", () => {
  it("triggers only on booking actions and rejects informational or assistant messages", () => {
    for (const text of [
      "I want to book a site visit.",
      "I would like to have a visit.",
      "I want to visit Palm Grove Villas.",
      "Can I schedule a visit?",
      "I would like to visit the property.",
      "Book a slot for me.",
      "Can I come and see the property tomorrow?",
      "Can I visit this weekend?",
      "Which dates are available?",
      "What slots are available?",
    ]) assert.equal(isSiteVisitIntent(text), true, text);

    for (const text of [
      "How does a site visit work?",
      "What happens during a site visit?",
      "Can you explain your site visit process?",
      "Do you provide site visits?",
      "What is included in a site visit?",
    ]) assert.equal(isSiteVisitIntent(text), false, text);

    assert.equal(isSiteVisitIntent("I want to book a visit.", "ai"), false);
    assert.equal(isSiteVisitAvailabilityQuestion("Which dates are available?"), true);
    assert.equal(isSiteVisitAvailabilityQuestion("How does a site visit work?"), false);
    for (const text of ["Where do I enter my details?", "How do I share my details?", "Open the contact form.", "Show me the booking form.", "I want to continue booking."]) {
      assert.equal(isBookingResumeRequest(text), true, text);
      assert.equal(isSiteVisitIntent(text), true, text);
    }
  });

  it("gives an explicit project in the booking clause priority over confirmed interests", () => {
    const result = resolveVisitProject([], "I want to visit Riverfront Heights.", [
      "Skyline Residences",
      "Green Valley Phase 2",
    ]);
    assert.equal(result.project, "Riverfront Heights");
    assert.equal(result.source, "visit_request");
  });

  it("asks which project when the actual booking request names multiple projects", () => {
    const result = resolveVisitProject([], "Book a visit to Skyline Residences or Palm Grove Villas.");
    assert.equal(result.project, null);
    assert.equal(result.needsClarification, true);
    assert.equal(result.candidates.length, 2);
  });

  it("uses one currently confirmed interest but clarifies multiple confirmed interests", () => {
    const one = resolveVisitProject([], "I want to book a visit.", ["Riverfront Heights"]);
    assert.equal(one.project, "Riverfront Heights");
    assert.equal(one.source, "confirmed_interest");

    const buyerDiscussedThenRequested = resolveVisitProject([
      { from: "buyer", text: "I like Palm Grove Villas." },
      { from: "ai", text: "Palm Grove Villas has several home options." },
      { from: "buyer", text: "I would like to have a visit." },
      { from: "ai", text: "I can help you plan a visit." },
    ], "I would like to have a visit.", ["Palm Grove Villas"]);
    assert.equal(buyerDiscussedThenRequested.project, "Palm Grove Villas");
    assert.equal(buyerDiscussedThenRequested.source, "confirmed_interest");

    const multiple = resolveVisitProject([], "I want to book a visit.", ["Riverfront Heights", "Palm Grove Villas"]);
    assert.equal(multiple.project, null);
    assert.equal(multiple.needsClarification, true);

    const unknown = resolveVisitProject([], "I want to book a visit.");
    assert.equal(unknown.project, null);
    assert.equal(unknown.needsClarification, false);
    assert.equal(unknown.source, "no_confirmed_project");
  });

  it("asks for a new project instead of reusing the previous interest when the buyer says another project", () => {
    const result = resolveVisitProject([], "Actually, I want to visit another project.", ["Palm Grove Villas"]);
    assert.equal(result.project, null);
    assert.equal(result.needsClarification, true);
    assert.equal(result.source, "another_project");
  });

  it("does not promote rejected or merely mentioned projects to visit projects", () => {
    const rejected = resolveVisitProject([
      { from: "buyer", text: "I am not interested in Skyline Residences." },
    ], "I want to book a visit.", ["Skyline Residences"]);
    assert.equal(rejected.project, null);
    assert.equal(rejected.source, "no_confirmed_project");

    const informational = resolveVisitProject([
      { from: "buyer", text: "What is the location of Skyline Residences?" },
      { from: "ai", text: "I recommend Skyline Residences." },
    ], "I want to book a visit.");
    assert.equal(informational.project, null);
    assert.equal(informational.source, "no_confirmed_project");

    const explicitlyRequested = resolveVisitProject([
      { from: "buyer", text: "I am not interested in Skyline Residences." },
    ], "I want to visit Riverfront Heights.", ["Skyline Residences"]);
    assert.equal(explicitlyRequested.project, "Riverfront Heights");
  });

  it("restores only a session-scoped, non-sensitive booking draft", () => {
    const originalStorage = globalThis.sessionStorage;
    const entries = new Map();
    globalThis.sessionStorage = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    };
    try {
      const sessionId = "guest-session-1";
      assert.equal(writeGuestBookingDraft(sessionId, {
        project: "Skyline Residences",
        date: "2026-11-12",
        slot: "11:30 AM",
        sessionToken: "must-not-persist",
        phone: "9999999999",
      }), true);
      assert.deepEqual(readGuestBookingDraft(sessionId), {
        sessionId,
        project: "Skyline Residences",
        date: "2026-11-12",
        slot: "11:30 AM",
        state: "reviewing_booking",
      });
      assert.equal(readGuestBookingDraft("different-session"), null);
      assert.equal([...entries.values()].some((value) => /must-not-persist|9999999999/.test(value)), false);

      assert.deepEqual(revalidateBookingDraft(readGuestBookingDraft(sessionId), {
        "2026-11-12": ["11:30 AM", "2:00 PM"],
      }), { valid: true, date: "2026-11-12", slot: "11:30 AM", message: "" });

      const stale = revalidateBookingDraft(readGuestBookingDraft(sessionId), {
        "2026-11-12": ["2:00 PM"],
      });
      assert.equal(stale.valid, false);
      assert.equal(stale.date, "2026-11-12");
      assert.equal(stale.slot, "");
      assert.match(stale.message, /no longer available/i);

      clearGuestBookingDraft(sessionId); // Used for success and explicit cancel.
      assert.equal(readGuestBookingDraft(sessionId), null);

      assert.equal(writeGuestBookingDraft(sessionId, { project: "Skyline Residences", state: "awaiting_contact" }), true);
      assert.equal(readGuestBookingDraft(sessionId).state, "awaiting_contact");
      assert.equal(writeGuestBookingDraft(sessionId, { project: null, state: "identifying_project" }), true);
      assert.deepEqual(readGuestBookingDraft(sessionId), {
        sessionId,
        project: null,
        date: "",
        slot: "",
        state: "identifying_project",
      });
      clearGuestBookingDraft(sessionId);
    } finally {
      if (originalStorage === undefined) delete globalThis.sessionStorage;
      else globalThis.sessionStorage = originalStorage;
    }
  });

  it("uses India local dates, calendar ranges, month cells and midnight timing", () => {
    const date = new Date("2026-11-08T20:00:00.000Z");
    assert.equal(getIndiaTodayIso(date), "2026-11-09");
    assert.equal(getIndiaCurrentMonth(date), "2026-11");
    assert.deepEqual(getMonthAvailabilityRange("2026-11", "2026-11-09"), {
      from: "2026-11-09",
      to: "2026-11-30",
    });
    const cells = getMonthCalendarCells("2026-11");
    assert.equal(cells[0], "2026-11-01");
    assert.equal(cells.at(-1), null);
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.match(formatMonthLabel("2026-11"), /November 2026/);
    const beforeMidnight = Date.parse("2026-11-08T18:29:30.000Z");
    assert.equal(getMillisecondsUntilNextIndiaMidnight(beforeMidnight), 30_000);
  });
});
