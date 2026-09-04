/**
 * Partial batch submit.
 *
 * A user attached 20 PDFs, reviewed 3, and could not save any of them: the
 * button stayed disabled while the other 17 were still reading or had timed
 * out. isEntryReady is what decides which entries a save actually acts on,
 * so it has to include "finished reading" alongside "fields complete" — a
 * still-loading entry could otherwise have its own OCR response land on top
 * of the values being submitted.
 */
import { describe, it, expect } from "vitest";
import { isEntryReady } from "../BatchExpenseForm";

type Entry = Parameters<typeof isEntryReady>[0];

const completeForm = {
  fundType: "เงินสดย่อย" as const,
  documentType: "ใบเสร็จรับเงิน" as const,
  documentNumber: "INV-001",
  poNumber: "",
  billDate: "2026-09-01",
  supplierNameTh: "ร้านทดสอบ",
  supplierNameEn: "",
  expenseDetail: "ค่าอุปกรณ์สำนักงาน",
  odooCategory: "[EXP00000000030] ค่าอาหาร",
  accName: "[531008] ค่าสวัสดิการพนักงาน",
  amountBeforeVat: "100",
  vatAmount: "7",
  grandTotal: "107",
  hasVat: true,
};

const entry = (over: Partial<Entry> = {}): Entry =>
  ({
    key: "k",
    file: new File(["x"], "a.pdf", { type: "application/pdf" }),
    form: { ...completeForm },
    ocrState: "done",
    ocrText: "",
    ...over,
  }) as Entry;

describe("isEntryReady", () => {
  it("accepts a complete entry whose read has finished", () => {
    expect(isEntryReady(entry())).toBe(true);
  });

  it("accepts a complete entry whose read failed — the user filled it in by hand", () => {
    // This is the case the original bug punished: a timed-out read left the
    // entry unsaveable even after the user typed everything themselves.
    expect(isEntryReady(entry({ ocrState: "warning" }))).toBe(true);
  });

  it("rejects an entry that is still reading, even when it already looks complete", () => {
    expect(isEntryReady(entry({ ocrState: "loading" }))).toBe(false);
  });

  it("rejects an entry missing a required field", () => {
    expect(isEntryReady(entry({ form: { ...completeForm, supplierNameTh: "  " } }))).toBe(false);
    expect(isEntryReady(entry({ form: { ...completeForm, odooCategory: "" } }))).toBe(false);
    expect(isEntryReady(entry({ form: { ...completeForm, billDate: "" } }))).toBe(false);
  });

  it("rejects an entry with no amount", () => {
    expect(isEntryReady(entry({ form: { ...completeForm, grandTotal: "0" } }))).toBe(false);
  });

  it("accepts a VAT-off entry carrying only a net total", () => {
    expect(
      isEntryReady(
        entry({ form: { ...completeForm, hasVat: false, amountBeforeVat: "107", vatAmount: "0", grandTotal: "107" } })
      )
    ).toBe(true);
  });

  it("picks exactly the reviewed bills out of a mixed batch", () => {
    // The reported scenario: 3 reviewed, the rest still reading.
    const batch = [
      entry({ key: "a" }),
      entry({ key: "b" }),
      entry({ key: "c" }),
      ...Array.from({ length: 17 }, (_, i) =>
        entry({ key: `pending-${i}`, ocrState: "loading", form: { ...completeForm, supplierNameTh: "" } })
      ),
    ];
    expect(batch.filter(isEntryReady).map((e) => e.key)).toEqual(["a", "b", "c"]);
  });
});
