export const PRODUCT_TIME_ZONE = "America/New_York";

function wallParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRODUCT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Formats an instant for a datetime-local input in the product timezone. */
export function isoToProductWallClock(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid ISO timestamp.");
  return wallParts(date);
}

/**
 * Converts a New York wall-clock minute to UTC. Nonexistent spring-forward
 * times are rejected; the earlier instant is chosen during the repeated fall hour.
 */
export function productWallClockToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Use a date and time.");
  const [, year, month, day, hour, minute] = match;
  const nominal = Date.UTC(+year, +month - 1, +day, +hour, +minute);
  const matches: number[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 30) {
    const candidate = nominal + offsetMinutes * 60_000;
    if (wallParts(new Date(candidate)) === value) matches.push(candidate);
  }
  if (!matches.length) throw new Error("That local time does not exist in America/New_York.");
  return new Date(Math.min(...matches)).toISOString();
}

export function reminderPresetIso(preset: "LATER_TODAY" | "TOMORROW_MORNING" | "NEXT_BUSINESS_DAY", now = new Date()) {
  if (preset === "LATER_TODAY") return new Date(now.getTime() + 2 * 60 * 60_000).toISOString();
  const [date] = wallParts(now).split("T");
  const cursor = new Date(`${date}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  if (preset === "NEXT_BUSINESS_DAY") while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return productWallClockToIso(`${cursor.toISOString().slice(0, 10)}T09:00`);
}
