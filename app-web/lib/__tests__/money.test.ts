/**
 * Tests for the money logic — the rules that decide how much has been spent,
 * which pot a bill comes out of, and whether a bill is a duplicate.
 *
 * These exist because this is the code that fails SILENTLY. A typo here does
 * not crash and does not look wrong on screen: the page renders a confident,
 * incorrect number, and nobody notices until the month-end total disagrees
 * with what accounting counted. `next build` cannot catch that, and neither
 * can a screenshot.
 */
import { describe, it, expect } from "vitest";
import { sumPettyCashForMonth, classifyFundType, PETTY_CASH_MONTHLY_THRESHOLD } from "../pettyCash";
import { findDuplicateExpense } from "../duplicateCheck";
import { monthLabelForBillDate, isMonthTabName } from "../month";
import { numberToThaiBahtText } from "../thaiBahtText";
import { driveFileIdFromLink } from "../driveLinks";
import type { ExpenseRow } from "../sheets";

/** Minimal row with only the fields the logic under test actually reads. */
function row(overrides: Partial<ExpenseRow>): ExpenseRow {
  return {
    id: "GM00001",
    recordedAt: "2026-08-01T00:00:00.000Z",
    recordedBy: "tester",
    status: "รอตรวจ",
    fundType: "เงินสดย่อย",
    documentType: "ใบเสร็จรับเงิน",
    documentNumber: "",
    poNumber: "",
    billDate: "2026-08-10",
    supplierNameTh: "ร้านค้า",
    supplierNameEn: "",
    expenseDetail: "",
    odooCategory: "",
    costCenter: "",
    accName: "",
    amountBeforeVat: 0,
    vatAmount: 0,
    grandTotal: 1000,
    receiptFileLink: "",
    receiptDocLink: "",
    duplicateWarning: "",
    odooId: "",
    reviewedBy: "",
    reviewedAt: "",
    note: "",
    repaymentStatus: "ยังไม่จ่ายคืน",
    ...overrides,
  };
}

describe("sumPettyCashForMonth", () => {
  it("adds up only เงินสดย่อย rows in the reference month", () => {
    const rows = [
      row({ grandTotal: 1000 }),
      row({ grandTotal: 2000 }),
      row({ grandTotal: 500, fundType: "เงินทดรองจ่าย" }), // different pot
      row({ grandTotal: 9999, billDate: "2026-07-31" }), // previous month
      row({ grandTotal: 8888, billDate: "2026-09-01" }), // next month
    ];
    expect(sumPettyCashForMonth(rows, "2026-08-15")).toBe(3000);
  });

  it("excludes cancelled rows — cancelling returns the amount to the wallet", () => {
    const rows = [
      row({ grandTotal: 1000 }),
      row({ grandTotal: 2000, status: "ยกเลิก" }),
      row({ grandTotal: 500 }),
    ];
    // The regression this guards: a cancelled 2,000 baht bill must NOT keep
    // consuming the month's เงินสดย่อย allowance.
    expect(sumPettyCashForMonth(rows, "2026-08-01")).toBe(1500);
  });

  it("counts every non-cancelled status", () => {
    const rows = [
      row({ grandTotal: 100, status: "รอตรวจ" }),
      row({ grandTotal: 200, status: "ตรวจแล้ว" }),
      row({ grandTotal: 300, status: "นับเข้าระบบ" }),
      row({ grandTotal: 400, status: "ต้องแก้ไข" }),
    ];
    expect(sumPettyCashForMonth(rows, "2026-08-01")).toBe(1000);
  });

  it("returns 0 for a malformed reference date rather than guessing", () => {
    expect(sumPettyCashForMonth([row({})], "not-a-date")).toBe(0);
  });

  it("ignores rows whose own bill date is malformed", () => {
    expect(sumPettyCashForMonth([row({ billDate: "??" }), row({ grandTotal: 250 })], "2026-08-01")).toBe(250);
  });
});

describe("classifyFundType", () => {
  it("keeps a bill as เงินสดย่อย when the running total still fits", () => {
    expect(classifyFundType(19000, 500)).toBe("เงินสดย่อย");
  });

  it("treats landing exactly on the threshold as still fitting", () => {
    // ป๊อป's rule verbatim: "ถ้ามีรายการไหนที่ยอดพอดี ให้ตีเป็น petty cash"
    expect(classifyFundType(19500, 500)).toBe("เงินสดย่อย");
    expect(classifyFundType(0, PETTY_CASH_MONTHLY_THRESHOLD)).toBe("เงินสดย่อย");
  });

  it("moves the WHOLE bill to เงินทดรองจ่าย when it would overflow", () => {
    // Never split: 19,500 used + 1,000 exceeds 20,000, so all 1,000 moves.
    expect(classifyFundType(19500, 1000)).toBe("เงินทดรองจ่าย");
  });

  it("classifies a bill that overflows on its own", () => {
    expect(classifyFundType(0, PETTY_CASH_MONTHLY_THRESHOLD + 1)).toBe("เงินทดรองจ่าย");
  });
});

describe("findDuplicateExpense", () => {
  const existing = [row({ id: "GM00007", supplierNameTh: "ร้าน ก", grandTotal: 1200, billDate: "2026-08-09" })];

  it("flags an exact vendor + amount + date match", () => {
    const hit = findDuplicateExpense(existing, {
      supplierNameTh: "ร้าน ก",
      grandTotal: 1200,
      billDate: "2026-08-09",
    });
    expect(hit?.id).toBe("GM00007");
  });

  it("ignores case and surrounding spaces in the vendor name", () => {
    const hit = findDuplicateExpense(
      [row({ id: "GM00008", supplierNameTh: "Seven Eleven", grandTotal: 50, billDate: "2026-08-09" })],
      { supplierNameTh: "  seven eleven ", grandTotal: 50, billDate: "2026-08-09" }
    );
    expect(hit?.id).toBe("GM00008");
  });

  it("does not flag when any one of the three differs", () => {
    const candidate = { supplierNameTh: "ร้าน ก", grandTotal: 1200, billDate: "2026-08-09" };
    expect(findDuplicateExpense(existing, { ...candidate, grandTotal: 1201 })).toBeNull();
    expect(findDuplicateExpense(existing, { ...candidate, billDate: "2026-08-10" })).toBeNull();
    expect(findDuplicateExpense(existing, { ...candidate, supplierNameTh: "ร้าน ข" })).toBeNull();
  });

  it("returns null on incomplete input instead of matching everything", () => {
    expect(findDuplicateExpense(existing, { supplierNameTh: "", grandTotal: 1200, billDate: "2026-08-09" })).toBeNull();
    expect(findDuplicateExpense(existing, { supplierNameTh: "ร้าน ก", grandTotal: NaN, billDate: "2026-08-09" })).toBeNull();
  });
});

describe("monthLabelForBillDate", () => {
  it("routes a bill to its own month tab, in Buddhist-era form", () => {
    // 2026 CE = 2569 BE; the tab name is what decides where the row lands.
    expect(monthLabelForBillDate("2026-08-10")).toBe("2569-08 สิงหาคม");
  });

  it("keeps a December bill in December, not the next year", () => {
    expect(monthLabelForBillDate("2026-12-31")).toBe("2569-12 ธันวาคม");
  });

  it("accepts its own output as a valid month tab name", () => {
    expect(isMonthTabName(monthLabelForBillDate("2026-08-10"))).toBe(true);
    expect(isMonthTabName("_DriveFolders")).toBe(false);
    expect(isMonthTabName("_PayeeTemplates")).toBe(false);
  });
});

describe("numberToThaiBahtText", () => {
  it("writes whole amounts with ถ้วน", () => {
    expect(numberToThaiBahtText(202)).toBe("สองร้อยสองบาทถ้วน");
    expect(numberToThaiBahtText(1250)).toBe("หนึ่งพันสองร้อยห้าสิบบาทถ้วน");
  });

  it("handles the Thai เอ็ด / ยี่ special cases", () => {
    expect(numberToThaiBahtText(21)).toBe("ยี่สิบเอ็ดบาทถ้วน");
    expect(numberToThaiBahtText(11)).toBe("สิบเอ็ดบาทถ้วน");
  });

  it("writes satang instead of ถ้วน when there are any", () => {
    expect(numberToThaiBahtText(1.5)).toBe("หนึ่งบาทห้าสิบสตางค์");
  });
});

describe("driveFileIdFromLink", () => {
  it("reads the id out of a Drive webViewLink", () => {
    expect(driveFileIdFromLink("https://drive.google.com/file/d/1AbC_-xyz/view?usp=drivesdk")).toBe("1AbC_-xyz");
  });

  it("reads the id out of an ?id= style link", () => {
    expect(driveFileIdFromLink("https://drive.google.com/open?id=1AbC_-xyz")).toBe("1AbC_-xyz");
  });

  it("returns null for anything unrecognisable, so callers can fall back", () => {
    expect(driveFileIdFromLink("")).toBeNull();
    expect(driveFileIdFromLink("https://example.com/nope")).toBeNull();
  });
});
