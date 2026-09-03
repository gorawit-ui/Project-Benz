"use client";

import BilliMascot from "./BilliMascot";

/**
 * The "กำลังอ่านเอกสาร" overlay shown while OCR runs.
 *
 * Shared by both capture flows on purpose: the multi-file screen had this
 * centred overlay while a single receipt only got a thin strip inside the
 * attachment box, which was easy to miss on a desktop screen and made the
 * two flows feel like different products.
 *
 * With `total` given it shows real progress ("อ่านแล้ว 3 จาก 5 ใบ"); without
 * it there is nothing to count, so the bar is indeterminate.
 */
export default function OcrProgressOverlay({
  completed,
  total,
  currentFileName,
  onDismiss,
}: {
  /** Files finished so far. Omit for a single-file read. */
  completed?: number;
  /** Total files. Omit for a single-file read — the bar goes indeterminate. */
  total?: number;
  currentFileName?: string;
  /**
   * Lets the user drop the overlay and start typing while OCR keeps running
   * in the background. Worth offering because a busy Gemini is retried with
   * backoff (see lib/ocr.ts), so a slow read can now hold the screen for
   * tens of seconds — long enough that blocking the form outright would be
   * worse than an unread field. Omit to make the overlay non-dismissable.
   */
  onDismiss?: () => void;
}) {
  const determinate = typeof completed === "number" && typeof total === "number" && total > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-5 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/70 bg-white p-6 text-center shadow-2xl">
        <BilliMascot mood="scan" size="lg" speech="กำลังอ่านเอกสาร" className="mx-auto" />

        {determinate && (
          <p className="mt-2 text-sm text-[var(--muted)]">
            อ่านแล้ว {completed} จาก {total} ใบ
          </p>
        )}

        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100"
          role="progressbar"
          {...(determinate
            ? { "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": completed }
            : {})}
        >
          {determinate ? (
            <div
              className="h-full rounded-full bg-emerald-700 transition-all duration-500"
              style={{ width: `${((completed ?? 0) / (total ?? 1)) * 100}%` }}
            />
          ) : (
            // Nothing to measure for one file — a moving bar just says "still working".
            <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-700" />
          )}
        </div>

        <p className="mt-4 text-sm text-[var(--ink)]">ระบบกำลังดึงข้อมูลจาก OCR รอสักครู่นะครับ</p>
        {currentFileName && <p className="mt-1 truncate text-xs text-[var(--muted)]">{currentFileName}</p>}

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="mt-4 text-xs font-semibold text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)]"
          >
            ปิดหน้าต่างนี้ แล้วกรอกเองระหว่างรอ
          </button>
        )}
      </div>
    </div>
  );
}
