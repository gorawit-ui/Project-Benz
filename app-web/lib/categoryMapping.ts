/**
 * หมวดหมู่ (Odoo category) and Acc name always pair together — this table is
 * the single source of truth for both the dropdown options offered on the
 * capture form and the keyword-based auto-match run right after OCR reads a
 * receipt's vendor name and expense detail.
 *
 * Empty for now: blocked on the real Odoo chart-of-accounts mapping (see
 * docs/04-open-items.md, item A — "หมวดหมู่ + Cost Center + Acc name จริงจาก
 * Odoo"). Once that data is available, populate CATEGORY_RULES below; no
 * other code needs to change. Until then this quietly behaves like a plain
 * free-text field (no options, no auto-match) — same as before.
 */
export interface CategoryRule {
  /** Case-insensitive substrings checked against the vendor name + expense detail. */
  keywords: string[];
  category: string;
  accName: string;
}

export const CATEGORY_RULES: CategoryRule[] = [
  // Example shape once real data comes in:
  // { keywords: ["เซเว่น", "7-eleven"], category: "ค่าอาหารและเครื่องดื่ม", accName: "ค่าใช้จ่ายเบ็ดเตล็ด" },
];

export const CATEGORY_OPTIONS: string[] = Array.from(new Set(CATEGORY_RULES.map((rule) => rule.category)));
export const ACC_NAME_OPTIONS: string[] = Array.from(new Set(CATEGORY_RULES.map((rule) => rule.accName)));

/** Looks up the acc name paired with a given category — they always match 1:1 per CATEGORY_RULES. */
export function getAccNameForCategory(category: string): string | undefined {
  return CATEGORY_RULES.find((rule) => rule.category === category)?.accName;
}

/**
 * Matches a receipt's vendor name + expense detail against CATEGORY_RULES
 * keywords (case-insensitive substring, first rule wins) to auto-suggest a
 * category + acc name pair right after OCR. Returns null when nothing
 * matches — an unrecognized vendor is left for the user to pick manually
 * rather than guessing.
 */
export function matchCategoryAndAccName(
  vendorName: string,
  description: string
): { category: string; accName: string } | null {
  const haystack = `${vendorName} ${description}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return { category: rule.category, accName: rule.accName };
    }
  }
  return null;
}
