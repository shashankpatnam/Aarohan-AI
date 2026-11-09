const BUSINESS_TIME_ZONE = "Asia/Kolkata";

export function getBusinessDateRange(days, now = new Date()) {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError("days must be a positive integer");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const to = `${values.year}-${values.month}-${values.day}`;
  const [year, month, day] = to.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  const from = [
    start.getUTCFullYear(),
    String(start.getUTCMonth() + 1).padStart(2, "0"),
    String(start.getUTCDate()).padStart(2, "0"),
  ].join("-");

  return { from, to };
}
