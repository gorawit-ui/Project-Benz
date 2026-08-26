/**
 * Duplicate-bill detection, per docs/02-requirements-from-pop.md
 * ("การแจ้งเตือนรายการซ้ำ"): flag when ชื่อบริษัท (vendor) + จำนวนเงิน (amount) +
 * วันที่เอกสาร (bill date) all match an existing row exactly. Needs no Odoo
 * data, so it can run entirely against the Sheet rows already on hand.
 *
 * `import type`-only elsewhere (see ExpenseRow), so this file stays safe to
 * import from a client component without pulling googleapis into the bundle.
 */
import type { ExpenseRow } from "./sheets";

/** Normalizes a vendor name for comparison: trim + case-insensitive. */
function normalizeVendorName(name: string): string {
  return name.trim().toLowerCase();
}

export interface DuplicateCandidate {
  supplierNameTh: string;
  grandTotal: number;
  billDate: string;
}

/**
 * Returns the first existing row that matches `candidate` on vendor name +
 * amount + bill date, or null if there's no match. Amount and date are
 * compared exactly; only the vendor name is normalized.
 */
export function findDuplicateExpense(rows: ExpenseRow[], candidate: DuplicateCandidate): ExpenseRow | null {
  const candidateVendor = normalizeVendorName(candidate.supplierNameTh);
  if (!candidateVendor || !candidate.billDate || !Number.isFinite(candidate.grandTotal)) {
    return null;
  }

  return (
    rows.find(
      (row) =>
        normalizeVendorName(row.supplierNameTh) === candidateVendor &&
        row.grandTotal === candidate.grandTotal &&
        row.billDate === candidate.billDate
    ) ?? null
  );
}
