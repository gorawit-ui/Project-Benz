/**
 * Guards CATEGORY_ACC_PAIRS against the failure mode that matters most
 * here: a category or acc-name string that's a near-miss of the real Odoo
 * value (wrong code, missing trailing space, wrong Thai label) would not
 * throw anywhere — the form would just silently offer/fill an option the
 * dropdown itself doesn't recognise. These tests catch that before it ships,
 * by checking every pair against the single source of truth (the options
 * arrays), not by re-typing the expected strings a second time.
 */
import { describe, it, expect } from "vitest";
import { CATEGORY_OPTIONS, ACC_NAME_OPTIONS, CATEGORY_ACC_PAIRS, getAccNameForCategory } from "../categoryMapping";

describe("CATEGORY_ACC_PAIRS", () => {
  it("only references categories that exist in CATEGORY_OPTIONS", () => {
    for (const pair of CATEGORY_ACC_PAIRS) {
      expect(CATEGORY_OPTIONS).toContain(pair.category);
    }
  });

  it("only references acc names that exist in ACC_NAME_OPTIONS", () => {
    // This is the guard that matters most: it fails loudly if a group-B
    // account (real Odoo usage, not yet added to the app's account list —
    // see SUMMARY.md §5) is ever wired in before ACC_NAME_OPTIONS is updated.
    for (const pair of CATEGORY_ACC_PAIRS) {
      expect(ACC_NAME_OPTIONS).toContain(pair.accName);
    }
  });

  it("has no duplicate category keys", () => {
    const categories = CATEGORY_ACC_PAIRS.map((p) => p.category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("covers the 31 categories confirmed against real Odoo usage, no more", () => {
    // Deliberately not 43: 12 categories are still pending (see
    // lib/categoryMapping.ts's CATEGORY_ACC_PAIRS comment) — this pins the
    // count so a future addition is a deliberate edit, not an accident.
    expect(CATEGORY_ACC_PAIRS).toHaveLength(31);
  });
});

describe("getAccNameForCategory", () => {
  it("resolves a mapped category to its real-usage account", () => {
    expect(getAccNameForCategory("[EXP00000000030] ค่าอาหาร")).toBe("[531008] ค่าสวัสดิการพนักงาน");
    expect(getAccNameForCategory("[EXP00000000025] ค่าใช้จ่ายในการเดินทาง (ค่าน้ำมัน,ทางด่วน,จอดรถ)")).toBe(
      "[531007] ค่าเดินทางยานพาหนะ"
    );
    expect(getAccNameForCategory("สวัสดิการ")).toBe("[531008] ค่าสวัสดิการพนักงาน");
  });

  it("returns undefined for a category still pending a decision (not a guess)", () => {
    // EXP00000000048 เบิกเงินสดย่อย: real usage posts to the petty-cash GL
    // account (111150), which isn't in ACC_NAME_OPTIONS yet — must stay
    // unmapped rather than falling back to something wrong.
    expect(getAccNameForCategory("[EXP00000000048] เบิกเงินสดย่อย")).toBeUndefined();
  });

  it("returns undefined for a category that doesn't exist at all", () => {
    expect(getAccNameForCategory("ไม่มีหมวดหมู่นี้จริง")).toBeUndefined();
  });
});
