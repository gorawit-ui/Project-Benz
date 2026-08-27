/**
 * Row-addressing tests for the saved-payee templates.
 *
 * Update and delete address rows by NUMBER, while the reader drops blank
 * rows. If those two disagree, the app rewrites or deletes a different
 * person's saved ID details — with no error, and nothing on screen to
 * suggest anything went wrong. That is exactly the failure these pin down.
 */
import { describe, it, expect } from "vitest";
import { parseTemplateRows } from "../payeeTemplates";

describe("parseTemplateRows", () => {
  it("numbers rows from 2, since values start below the header", () => {
    const entries = parseTemplateRows([["สมชาย", "1234567890123", "", "", "", ""]]);
    expect(entries).toHaveLength(1);
    expect(entries[0].rowNumber).toBe(2);
    expect(entries[0].template.payeeName).toBe("สมชาย");
  });

  it("keeps real row numbers when a blank row sits in the middle", () => {
    // The regression: with the blank row skipped, สมหญิง is the second
    // ENTRY but lives on the third data row. Addressing her by list
    // position would hit the blank row instead.
    const entries = parseTemplateRows([
      ["สมชาย", "1", "", "", "", ""],
      [], // cleared by hand in the Sheet
      ["สมหญิง", "2", "", "", "", ""],
    ]);
    expect(entries.map((e) => e.template.payeeName)).toEqual(["สมชาย", "สมหญิง"]);
    expect(entries.map((e) => e.rowNumber)).toEqual([2, 4]);
  });

  it("survives several blanks, including a leading one", () => {
    const entries = parseTemplateRows([
      [],
      ["ก", "1", "", "", "", ""],
      [],
      [],
      ["ข", "2", "", "", "", ""],
    ]);
    expect(entries.map((e) => e.rowNumber)).toEqual([3, 6]);
  });

  it("treats a whitespace-only name as blank", () => {
    const entries = parseTemplateRows([["   ", "1", "", "", "", ""], ["ก", "2", "", "", "", ""]]);
    expect(entries).toHaveLength(1);
    expect(entries[0].rowNumber).toBe(3);
  });

  it("tolerates short rows without throwing", () => {
    const entries = parseTemplateRows([["ก"]]);
    expect(entries[0].template).toEqual({
      payeeName: "ก",
      idNumber: "",
      idCardFileId: "",
      idCardLink: "",
      savedAt: "",
      savedBy: "",
    });
  });
});
