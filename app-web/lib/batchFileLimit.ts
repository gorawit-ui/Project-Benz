/**
 * The batch-upload file-count guard, pulled out of CaptureStep.tsx so it's
 * checkable without a DOM/React test setup (this project has none — every
 * other guard lives as a plain function in lib/ for the same reason).
 *
 * Mirrors the server-side cap in app/api/expenses/batch/route.ts. A single
 * file always goes to the one-file ExpenseForm regardless of this limit
 * (CaptureFlow only switches to BatchExpenseForm for >1 file) — this only
 * needs to catch the upper end, and catch it before OCR/upload ever starts
 * rather than after the user has reviewed every entry and hit the batch
 * endpoint's own 20-file cap at the very last step.
 */
export const MAX_BATCH_FILES = 20;

/** Returns a Thai error message if `count` files can't be accepted, or null if it's fine. */
export function getBatchFileCountError(count: number): string | null {
  if (count > MAX_BATCH_FILES) {
    return `เลือกได้ครั้งละไม่เกิน ${MAX_BATCH_FILES} ไฟล์ (เลือกมา ${count} ไฟล์) กรุณาเลือกใหม่`;
  }
  return null;
}
