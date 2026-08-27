/**
 * Thai national ID formatting.
 *
 * Thirteen unbroken digits are genuinely hard to read and to check against a
 * card — the official grouping is 1-4-5-2-1 (e.g. 1-8907-00262-57-1), which
 * is how it appears on the card itself, so that's what people can actually
 * verify against.
 */

/**
 * Groups a 13-digit national ID as 1-4-5-2-1. Anything that isn't exactly 13
 * digits is returned unchanged rather than mangled — partially-typed and
 * non-standard values must still display as entered.
 */
export function formatThaiNationalId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 13) return id;
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits[12]}`;
}
