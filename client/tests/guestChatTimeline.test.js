import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeBookingChatEvents } from "../src/utils/guestChatTimeline.js";

describe("guest chat booking timeline events", () => {
  it("keeps a confirmed booking message in the conversation after the booking panel is gone", () => {
    const buyerMessage = { id: "message-1", from: "buyer", text: "Book my site visit." };
    const confirmation = {
      id: "booking-confirmation-1",
      from: "ai",
      text: "Your site visit is confirmed for Palm Grove Villas.",
      afterMessageKey: "message-1",
    };
    assert.deepEqual(
      mergeBookingChatEvents("session-1", [buyerMessage], [confirmation]),
      [buyerMessage, confirmation],
    );
    assert.deepEqual(
      mergeBookingChatEvents("session-1", [buyerMessage, { id: "message-2", from: "buyer", text: "Thanks." }], [confirmation]),
      [buyerMessage, confirmation, { id: "message-2", from: "buyer", text: "Thanks." }],
    );
  });
});
