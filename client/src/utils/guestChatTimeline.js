export function guestMessageKey(sessionId, message, index) {
  return message.id || `${sessionId}-${index}-${message.from}-${message.time ?? ""}`;
}

export function mergeBookingChatEvents(sessionId, transcript, events) {
  const eventsByAnchor = new Map();
  for (const event of events) {
    if (!event.afterMessageKey) continue;
    const list = eventsByAnchor.get(event.afterMessageKey) ?? [];
    list.push(event);
    eventsByAnchor.set(event.afterMessageKey, list);
  }
  const merged = [];
  const matched = new Set();
  transcript.forEach((message, index) => {
    const key = guestMessageKey(sessionId, message, index);
    merged.push(message);
    for (const event of eventsByAnchor.get(key) ?? []) {
      merged.push(event);
      matched.add(event.id);
    }
  });
  for (const event of events) {
    if (!matched.has(event.id)) merged.push(event);
  }
  return merged;
}
