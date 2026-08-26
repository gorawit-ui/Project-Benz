/**
 * Shared "calendar month" label used as BOTH the Drive per-month folder name
 * (lib/drive.ts's uploadReceiptFile) and the Google Sheet per-month tab name
 * (lib/sheets.ts's ensureMonthTabExists) — kept in one place so the two stay
 * in lockstep and always agree on what "this month" is called.
 *
 * Format: "<Buddhist year>-<zero-padded month> <Thai month name>", e.g.
 * "2569-08 สิงหาคม". The leading "YYYY-MM" numeric prefix is fixed-width and
 * zero-padded, so plain string-sort on the label still sorts chronologically
 * — the Thai name after the space is purely for human readability.
 */

export const THAI_MONTH_NAMES = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

/** Buddhist-year, zero-padded-month, Thai-month-name label for a given Date. */
export function formatThaiMonthLabel(date: Date): string {
  const buddhistYear = date.getFullYear() + 543;
  const monthIndex0 = date.getMonth(); // 0-11
  const monthNumber = String(monthIndex0 + 1).padStart(2, "0");
  const monthName = THAI_MONTH_NAMES[monthIndex0];
  return `${buddhistYear}-${monthNumber} ${monthName}`;
}

/**
 * Same label, from a "YYYY-MM-DD" billDate string (or undefined, defaulting
 * to today) — for server-side callers that only have a plain date string,
 * not a Date object. Parses the year/month directly out of the string
 * (rather than `new Date(billDate)`) to avoid any timezone-shift risk around
 * local midnight.
 */
export function monthLabelForBillDate(billDate?: string): string {
  if (billDate) {
    const match = /^(\d{4})-(\d{2})-\d{2}/.exec(billDate.trim());
    if (match) {
      const year = Number(match[1]);
      const monthNumber = match[2];
      const monthIndex0 = Number(monthNumber) - 1;
      if (monthIndex0 >= 0 && monthIndex0 <= 11) {
        const buddhistYear = year + 543;
        return `${buddhistYear}-${monthNumber} ${THAI_MONTH_NAMES[monthIndex0]}`;
      }
    }
  }
  return formatThaiMonthLabel(new Date());
}
