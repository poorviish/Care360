/**
 * Date helpers. Everything is plain "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" text with arithmetic
 * in UTC, so results never depend on the machine's timezone and the real clock is never read.
 */

const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/;
const MS_PER_MIN = 60000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const pad = (n: number) => String(n).padStart(2, "0");

export function serialToIso(serial: number): string {
  const minutes = Math.round(serial * 1440);
  const date = new Date(EXCEL_EPOCH + minutes * MS_PER_MIN);
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  return h === 0 && m === 0 ? day : `${day}T${pad(h)}:${pad(m)}`;
}

/** Accepts ISO text with an optional suffix such as "2000-01-31 (monthly)". Anything else is null. */
export function parseLooseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = ISO_PREFIX.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return h !== undefined ? `${y}-${mo}-${d}T${h}:${mi}` : `${y}-${mo}-${d}`;
}

export const hasTime = (iso: string) => iso.includes("T");
export const dateOnly = (iso: string) => iso.slice(0, 10);

/** Minutes since the epoch. A date with no time is 00:00. */
export function toMin(iso: string): number {
  const match = ISO_PREFIX.exec(iso);
  if (!match) return NaN;
  const [, y, mo, d, h, mi] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0)) / MS_PER_MIN;
}

/**
 * Arrival-side minutes. A date with no time is treated as 23:59, because a feed stamped with a
 * date may have landed at any point that day and urgency should not be understated.
 */
export const toArrivalMin = (iso: string) => (hasTime(iso) ? toMin(iso) : toMin(iso) + 1439);

export function fromMin(min: number): string {
  const date = new Date(min * MS_PER_MIN);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export const hoursBetween = (from: string, to: string) => (toMin(to) - toMin(from)) / 60;

/** Whole calendar days from one date to another, ignoring any time of day. */
export const daysBetween = (from: string, to: string) =>
  Math.round((toMin(dateOnly(to)) - toMin(dateOnly(from))) / 1440);

export function addDays(iso: string, days: number): string {
  const out = fromMin(toMin(iso) + days * 1440);
  return hasTime(iso) ? out : dateOnly(out);
}

/** 0 is Sunday and 6 is Saturday. */
export const weekday = (iso: string) => new Date(toMin(iso) * MS_PER_MIN).getUTCDay();

/** Adds Monday-to-Friday days, keeping the time of day. A step that lands on a weekend moves to Monday. */
export function addBusinessDays(iso: string, days: number): string {
  let current = iso;
  for (let i = 0; i < days; i++) {
    current = addDays(current, 1);
    while (weekday(current) === 0 || weekday(current) === 6) current = addDays(current, 1);
  }
  return current;
}

/** The first Monday 08:00 strictly after the given moment. */
export function nextMondayAt8(iso: string): string {
  let candidate = `${dateOnly(iso)}T08:00`;
  while (weekday(candidate) !== 1 || toMin(candidate) <= toMin(iso)) candidate = addDays(candidate, 1);
  return candidate;
}

export function ageInYears(dob: string, asOf: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ay, am, ad] = dateOnly(asOf).split("-").map(Number);
  return ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
}

export const minutesOfDay = (iso: string) => {
  const match = ISO_PREFIX.exec(iso);
  return match ? Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0) : 0;
};

/** "HH:mm" to minutes after midnight. */
export const hmToMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export function inWindow(minuteOfDay: number, start: string, end: string): boolean {
  const s = hmToMinutes(start);
  const e = hmToMinutes(end);
  return s <= e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
}

/** Human duration: "19 h 40 m", "3 d 2 h", "45 m". */
export function formatDuration(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} m` : `${h} h`;
  return `${m} m`;
}
