/**
 * หมวดหมู่ (Odoo "Category") and Acc name options for the capture form.
 *
 * This is GM's own working list, supplied by the product owner (2026-08-27)
 * — the categories and accounts the team actually uses day to day. It
 * REPLACES the earlier list that was inferred from Odoo expense history:
 * that one was a wide dump of every pairing seen in the data, this one is
 * the curated set GM works from.
 *
 * The `[CODE]` prefix is the part that matters and must stay: it's what's
 * bound to Odoo (`product.product.default_code` for categories,
 * `account.account.code` for accounts) and what accounting pulls against.
 * Two categories even share a label under different codes
 * ("ค่าธรรมเนียมขอใบอนุญาต" as EXP…007 and SER…003), so the code is the only
 * thing that disambiguates them.
 *
 * Strings are kept BYTE-IDENTICAL to Odoo, quirks included — trailing spaces
 * on EXP…026 / EXP…039 / EXP…042, a double space in "ค่าขยะมูลฝอย  Fac16",
 * a stray tone mark on "่ค่ากระดาษโน๊ต". All of these were verified to be
 * Odoo's own stored values, not typos in transit, so please don't "tidy" them.
 *
 * VERIFIED against live Odoo (read-only, 2026-08-27): all 18 account codes
 * and all 41 category codes exist and their labels match, except as noted:
 *
 *   - "สวัสดิการ" and "สำนักงาน-วัสดุสิ้นเปลือง" genuinely have NO code in
 *     Odoo (default_code is unset on both) — not an omission here.
 *   - EXP00000000004, EXP00000000007 and SER00000000020 exist with matching
 *     labels but are ARCHIVED (active = false) in Odoo, so they can't be
 *     picked on a new Odoo expense. Kept in the list because the team asked
 *     for them; if they're still in use they need un-archiving in Odoo.
 *   - [513006] is named "ค่าวัสดุสิ้นเปลืองใช้ไป - WH300" in Odoo; the label
 *     kept here is the team's shorter name for it. The code is correct.
 *
 * Category and Acc name are picked INDEPENDENTLY and manually for now — the
 * logic for pairing them (and for auto-matching from a receipt's vendor
 * name / expense detail after OCR) is being designed separately and will
 * land here later. Until it does, CATEGORY_ACC_PAIRS and CATEGORY_RULES stay
 * empty and both fields are simply free-text inputs with a dropdown of these
 * options.
 */

export const CATEGORY_OPTIONS: string[] = [
  "สวัสดิการ",
  "สำนักงาน-วัสดุสิ้นเปลือง",
  "[EXP00000000004] เครื่องมือเครื่องใช้",
  "[EXP00000000007] ค่าธรรมเนียมขอใบอนุญาต",
  "[EXP00000000023] ค่าส่วนลดโปรโมชั่น",
  "[EXP00000000025] ค่าใช้จ่ายในการเดินทาง (ค่าน้ำมัน,ทางด่วน,จอดรถ)",
  "[EXP00000000026] ค่าขนมพนักงาน Factory/WH-300/Exp Cafe ",
  "[EXP00000000029] ค่าชุดตรวจโควิด/ชุดตรวจกัญชา",
  "[EXP00000000030] ค่าอาหาร",
  "[EXP00000000031] ค่าจัดส่งเอกสาร (DHL,EMS)",
  "[EXP00000000032] ค่ากระดาษA4 +อุปกรณ์เครื่องเขียน",
  "[EXP00000000033] ่ค่ากระดาษโน๊ต ปากกา ไวท์บอร์ด",
  "[EXP00000000034] ค่าหมึก HP 955XL M",
  "[EXP00000000035] ค่าอุปกรณ์ทำความสะอาด ทิชชู ถุงขยะ",
  "[EXP00000000036] ค่าน้ำยาทำความสะอาดพื้น",
  "[EXP00000000037] ค่าซ่อมแซม/ค่าบำรุงรักษา",
  "[EXP00000000038] ค่าล้างแอร์ WH300",
  "[EXP00000000039] ค่าแม่บ้าน Factory/WH-300/Exp Cafe ",
  "[EXP00000000040] ค่าติดตั้งเครื่องมือเครื่องใช้อุปกรณ์ต่าง",
  "[EXP00000000041] ค่าโทรศัพท์ Bria Mobile Call center บริษัท",
  "[EXP00000000042] อากรสแตมป์ ",
  "[EXP00000000043] ค่าภาษีป้าย TDFB Factory",
  "[EXP00000000044] ค่าคัดหนังสือรับรอง/ฟอร์มต่าง",
  "[EXP00000000045] ค่าขยะมูลฝอย  Fac16",
  "[EXP00000000046] ค่าเลี้ยงรับรอง",
  "[EXP00000000047] ค่าซื้อของขวัญ",
  "[EXP00000000048] เบิกเงินสดย่อย",
  "[EXP00000000053] ค่าเงินมัดจำ/เงินประกันงาน",
  "[EXP00000000058] ค่าใช้จ่าย Outing",
  "[SER00000000002] ค่าบริการ-ซ่อมแซม",
  "[SER00000000003] ค่าธรรมเนียมขอใบอนุญาต",
  "[SER00000000018] ค่าจัดส่งไปรษณีย์",
  "[SER00000000019] ค่าสัมมนา/ฝึกอบรม/หนังสือ",
  "[SER00000000020] ค่าเครื่องเขียนแบบพิมพ์",
  "[SER00000000022] ค่าซ่อมแซมบำรุงรักษา",
  "[SER00000000023] ค่าบริการงานทั่วไป",
  "[SER00000000025] ค่าจ้างแม่บ้าน",
  "[SER00000000027] ค่าไฟฟ้า",
  "[SER00000000028] ค่าน้ำประปา",
  "[SER00000000029] ค่าโทรศัพท์&อินเตอร์เน็ต",
  "[SER00000000030] ค่าเบี้ยประกันภัย",
  "[SER00000000032] ค่าธรรมเนียมอื่น",
  "[SER00000000033] ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ",
];

export const ACC_NAME_OPTIONS: string[] = [
  "[141002] ส่วนปรับปรุงอาคารเช่า",
  "[141005] อุปกรณ์สำนักงาน",
  "[513006] ค่าวัสดุสิ้นเปลืองใช้ไป",
  "[513013] ค่าซ่อมแซมบำรุงรักษา",
  "[531006] ค่าจ้างที่ปรึกษา",
  "[531007] ค่าเดินทางยานพาหนะ",
  "[531008] ค่าสวัสดิการพนักงาน",
  "[532001] ค่าเช่าออฟฟิศ",
  "[532004] ค่าสัมมนา/ฝึกอบรม/หนังสือ",
  "[532005] เครื่องเขียนแบบพิมพ์",
  "[532006] ค่าวัสดุของใช้สิ้นเปลือง-สนง.",
  "[532009] ค่าบริการงานทั่วไป",
  "[533001] ค่าไฟฟ้า",
  "[533002] ค่าน้ำประปา",
  "[533003] ค่าโทรศัพท์&อินเตอร์เน็ต",
  "[535000] ค่าเบี้ยประกันภัย",
  "[536004] ค่าธรรมเนียมอื่น",
  "[537003] ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ",
];

/**
 * Category -> default acc name pairing. Intentionally EMPTY: which account
 * each category should post to is part of the matching logic still being
 * designed, so for now the two fields are chosen independently by hand.
 * Filling this in is all it takes to switch the auto-fill back on — the form
 * already calls getAccNameForCategory() on every category change.
 */
export interface CategoryAccPair {
  category: string;
  accName: string;
}

export const CATEGORY_ACC_PAIRS: CategoryAccPair[] = [];

/** Looks up the default acc name for a category; undefined until pairs are defined. */
export function getAccNameForCategory(category: string): string | undefined {
  return CATEGORY_ACC_PAIRS.find((p) => p.category === category)?.accName;
}

/**
 * Keyword-based auto-match: would check a receipt's vendor name + expense
 * detail against each rule's keywords (case-insensitive substring, first
 * rule wins) to auto-suggest a category + acc name right after OCR. Also
 * intentionally EMPTY — same reason as above. With no rules, this returns
 * null and the form simply leaves both fields for the user to pick.
 */
export interface CategoryRule {
  keywords: string[];
  category: string;
  accName: string;
}

export const CATEGORY_RULES: CategoryRule[] = [
  // { keywords: ["เซเว่น", "7-eleven"], category: "[EXP00000000030] ค่าอาหาร", accName: "[531008] ค่าสวัสดิการพนักงาน" },
];

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
