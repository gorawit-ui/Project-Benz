/**
 * หมวดหมู่ (Odoo "Category", `hr.expense.product_id`) and Acc name
 * (`hr.expense.account_id`) pairs, pulled from TDFB's real Odoo expense
 * history (read-only query, 2026-08-27) — the ~60 category/account
 * combinations covering the bulk of real usage (every pairing used 5+
 * times). For a category that historically posted to more than one
 * account, the most-frequently-used account was kept as its default —
 * category and acc name are NOT a strict 1:1 relationship in the real
 * data (e.g. "ค่าติดตั้งเครื่องมือเครื่องใช้อุปกรณ์ต่าง" has posted to 10
 * different accounts depending on context), so treat this as "the usual
 * pairing," not a hard constraint — both fields stay freely editable in
 * the form regardless of what's picked here.
 *
 * This only supplies the dropdown options and the category->accName
 * default-fill. The keyword-based auto-match (reading a receipt's vendor
 * name + expense detail right after OCR to guess which pair applies) is
 * intentionally left empty in CATEGORY_RULES below — that matching logic
 * is being designed separately, not by guessing keywords here.
 */
export interface CategoryAccPair {
  category: string;
  accName: string;
}

export const CATEGORY_ACC_PAIRS: CategoryAccPair[] = [
  { category: "Discount", accName: "420011 ส่วนลดรับ" },
  { category: "Logistics-วัสดุสิ้นเปลือง", accName: "513006 ค่าวัสดุสิ้นเปลืองใช้ไป - WH300" },
  { category: "Logistics-เครื่องมือเครื่องใช้(<3000บาทต่อชิ้น)", accName: "141003 เครื่องมือเครื่องใช้" },
  { category: "Production Cost", accName: "512000 ต้นทุนการผลิต-สินค้า" },
  { category: "Production-วัสดุสิ้นเปลือง", accName: "513019 ค่าวัสดุสิ้นเปลืองใช้ไป - FAC16" },
  { category: "Production-เครื่องมือเครื่องใช้(<3000บาทต่อชิ้น)", accName: "141003 เครื่องมือเครื่องใช้" },
  { category: "การตลาดและโฆษณา", accName: "520003 การตลาดและโฆษณา" },
  { category: "ค่ากระดาษA4 +อุปกรณ์เครื่องเขียน", accName: "532005 เครื่องเขียนแบบพิมพ์" },
  { category: "ค่าขนมพนักงาน Factory/WH-300/Exp Cafe", accName: "531008 ค่าสวัสดิการพนักงาน" },
  { category: "ค่าขนส่ง (ชา,อุปกรณ์,แพ็คเกจจิ้ง)", accName: "513003 ค่าขนส่งสินค้าขาซื้อ" },
  { category: "ค่าขนส่งสินค้าขาขาย", accName: "520002 ค่าขนส่งสินค้าขาขาย" },
  { category: "ค่าขยะมูลฝอย  Fac16", accName: "536004 ค่าธรรมเนียมอื่น" },
  { category: "ค่าคัดหนังสือรับรอง/ฟอร์มต่าง", accName: "536004 ค่าธรรมเนียมอื่น" },
  { category: "ค่าจัดส่งเอกสาร (DHL,EMS)", accName: "532003 ค่าจัดส่งไปรษณีย์" },
  { category: "ค่าจัดส่งไปรษณีย์", accName: "532003 ค่าจัดส่งไปรษณีย์" },
  { category: "ค่าซื้อของขวัญ", accName: "537003 ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ" },
  { category: "ค่าซื้อสินค้าตัวอย่าง", accName: "520006 ค่าสินค้าตัวอย่าง/ส่งเสริมการขาย" },
  { category: "ค่าซ่อมแซม/ค่าบำรุงรักษา", accName: "532007 ค่าซ่อมแซมบำรุงรักษา" },
  { category: "ค่าซ่อมแซมบำรุงรักษา", accName: "532007 ค่าซ่อมแซมบำรุงรักษา" },
  { category: "ค่าตรวจสุขภาพ", accName: "531008 ค่าสวัสดิการพนักงาน" },
  { category: "ค่าติดตั้งเครื่องมือเครื่องใช้อุปกรณ์ต่าง", accName: "532009 ค่าบริการงานทั่วไป" },
  { category: "ค่าทดสอบผลิตภัณฑ์", accName: "512000 ต้นทุนการผลิต-สินค้า" },
  { category: "ค่าทดสอบวิจัยตลาด", accName: "520012 ค่าทดสอบวิจัยตลาด" },
  { category: "ค่าธรรมเนียมขอใบอนุญาต", accName: "513007 ค่าธรรมเนียมขอใบอนุญาต" },
  { category: "ค่าธรรมเนียมอื่น", accName: "536004 ค่าธรรมเนียมอื่น" },
  { category: "ค่าน้ำยาทำความสะอาดพื้น", accName: "532006 ค่าวัสดุของใช้สิ้นเปลือง-สนง." },
  { category: "ค่าบริการ-ซ่อมแซม", accName: "532007 ค่าซ่อมแซมบำรุงรักษา" },
  { category: "ค่าบริการงานทั่วไป", accName: "532009 ค่าบริการงานทั่วไป" },
  { category: "ค่าบริการซักรีดเสื้อคลุม", accName: "510000 Cost of Revenue" },
  { category: "ค่าบริการโปรโมทสินค้า", accName: "520004 ค่าบริการโปรโมทสินค้า" },
  { category: "ค่าพัฒนาสินค้า", accName: "520007 ค่าพัฒนาสินค้า" },
  { category: "ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ", accName: "537003 ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ" },
  { category: "ค่าสัมมนา/ฝึกอบรม/หนังสือ", accName: "532004 ค่าสัมมนา/ฝึกอบรม/หนังสือ" },
  { category: "ค่าสินค้าตัวอย่าง/ส่งเสริมการขาย", accName: "520006 ค่าสินค้าตัวอย่าง/ส่งเสริมการขาย" },
  { category: "ค่าสื่อสิ่งพิมพ์การตลาด", accName: "520008 ค่าสื่อสิ่งพิมพ์การตลาด" },
  { category: "ค่าส่ง-รับคืนสินค้าให้ลูกค้า", accName: "520002 ค่าขนส่งสินค้าขาขาย" },
  { category: "ค่าส่งพัสดุไปต่างประเทศ", accName: "520002 ค่าขนส่งสินค้าขาขาย" },
  { category: "ค่าส่งสินค้า/อุปกรณ์สำหรับการตลาด", accName: "510000 Cost of Revenue" },
  { category: "ค่าส่วนลดโปรโมชั่น", accName: "520010 ค่าส่วนลดโปรโมชั่น" },
  { category: "ค่าหมึก HP 955XL M", accName: "532005 เครื่องเขียนแบบพิมพ์" },
  { category: "ค่าอาหาร", accName: "531008 ค่าสวัสดิการพนักงาน" },
  { category: "ค่าอุปกรณ์/วัตถุดิบถ่ายทำสื่อการตลาด", accName: "520003 การตลาดและโฆษณา" },
  { category: "ค่าอุปกรณ์ทำความสะอาด ทิชชู ถุงขยะ", accName: "532006 ค่าวัสดุของใช้สิ้นเปลือง-สนง." },
  { category: "ค่าเบิกค่า Mentor", accName: "531008 ค่าสวัสดิการพนักงาน" },
  { category: "ค่าเลี้ยงรับรอง", accName: "537003 ค่ารับรอง/เลี้ยงลูกค้า/ของขวัญ" },
  { category: "ค่าแม่บ้าน Factory/WH-300/Exp Cafe", accName: "532009 ค่าบริการงานทั่วไป" },
  { category: "ค่าโฆษณาสรรหาบุคลากร", accName: "531013 ค่าโฆษณา-รับสมัครงาน" },
  { category: "ค่าโทรศัพท์ Bria Mobile Call center บริษัท", accName: "533003 ค่าโทรศัพท์&อินเตอร์เน็ต" },
  { category: "ค่าโทรศัพท์&อินเตอร์เน็ต", accName: "533003 ค่าโทรศัพท์&อินเตอร์เน็ต" },
  { category: "ค่าใช้จ่าย Outing", accName: "531008 ค่าสวัสดิการพนักงาน" },
  { category: "ค่าใช้จ่ายในการเดินทาง (ค่าน้ำมัน,ทางด่วน,จอดรถ)", accName: "531007 ค่าเดินทางยานพาหนะ" },
  { category: "ซื้อ RM/PKG/Accessories", accName: "513001 ซื้อสินค้า-ในประเทศ" },
  { category: "ซื้อวัสดุสิ้นเปลือง,อุปกรณ์(<3000 THB) WH-300", accName: "513005 ค่าวัสดุบรรจภัณฑ์-ทางอ้อม" },
  { category: "ซื้อหมวกตัวหนอน,ถุงมือ,แมส,ถุงขยะ,น้ำยาความสะอาด", accName: "513006 ค่าวัสดุสิ้นเปลืองใช้ไป - WH300" },
  { category: "สวัสดิการ", accName: "531008 ค่าสวัสดิการพนักงาน" },
  { category: "สำนักงาน-วัสดุสิ้นเปลือง", accName: "532006 ค่าวัสดุของใช้สิ้นเปลือง-สนง." },
  { category: "อากรสแตมป์", accName: "536002 ค่าอากรสแตมป์" },
  { category: "เครื่องมือเครื่องใช้", accName: "513004 ค่าวัสดุบรรจภัณฑ์-ทางตรง" },
  { category: "เบิกเงินสดย่อย", accName: "111150 เงินสดย่อย" },
  { category: "โปรแกรม/ซอฟท์แวร์/แอพลิเคชั่น", accName: "520005 โปรแกรม/ซอฟท์แวร์/แอพลิเคชั่น" },
];

export const CATEGORY_OPTIONS: string[] = Array.from(new Set(CATEGORY_ACC_PAIRS.map((p) => p.category)));
export const ACC_NAME_OPTIONS: string[] = Array.from(new Set(CATEGORY_ACC_PAIRS.map((p) => p.accName)));

/** Looks up the default acc name for a given category (see the "not strictly 1:1" note above). */
export function getAccNameForCategory(category: string): string | undefined {
  return CATEGORY_ACC_PAIRS.find((p) => p.category === category)?.accName;
}

/**
 * Keyword-based auto-match: checks a receipt's vendor name + expense detail
 * against each rule's keywords (case-insensitive substring, first rule
 * wins) to auto-suggest a category + acc name pair right after OCR.
 * Intentionally EMPTY for now — this matching logic is being designed
 * separately, not guessed here. Populate CATEGORY_RULES once that design
 * is ready; CATEGORY_ACC_PAIRS above (the dropdown options + the
 * pick-a-category-get-its-acc-name convenience) doesn't depend on it.
 */
export interface CategoryRule {
  keywords: string[];
  category: string;
  accName: string;
}

export const CATEGORY_RULES: CategoryRule[] = [
  // { keywords: ["เซเว่น", "7-eleven"], category: "ค่าอาหาร", accName: "531008 ค่าสวัสดิการพนักงาน" },
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
