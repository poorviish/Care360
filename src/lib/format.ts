const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

function clock12(hours: number, minutes: string) {
  const suffix = hours >= 12 ? "pm" : "am";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${suffix}`;
}

/** An ISO date renders as "2 Jan 2000, 8:00 am". Text that is not a date passes through. */
export function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = ISO.exec(iso);
  if (!match) return iso;
  const [, y, mo, d, h, mi] = match;
  const date = `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
  return h === undefined ? date : `${date}, ${clock12(Number(h), mi)}`;
}

export function weekdayOf(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "Mon 2 Jan, 8:00 am": the header's as-of format, also used for return times. */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = ISO.exec(iso);
  if (!match) return iso;
  const [, , mo, d, h, mi] = match;
  const date = `${weekdayOf(iso)} ${Number(d)} ${MONTHS[Number(mo) - 1]}`;
  return h === undefined ? date : `${date}, ${clock12(Number(h), mi)}`;
}

/** "08:00" */
export const fmtTime = (iso: string) => iso.slice(11, 16);

export const fmtValue = (value: string | number | null) => (value === null ? "" : typeof value === "string" ? fmt(value) : String(value));

/** Shortens a person label, for example "Son A B (city)" to "Son A B". */
export const shortPerson = (value: string | number | null) => String(value ?? "").replace(/\s*\(.*\)\s*$/, "").trim();

export const pluralise = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
