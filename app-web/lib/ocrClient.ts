/**
 * The browser side of an OCR read: shrink, post, and turn every failure mode
 * into a message someone holding a receipt can act on.
 *
 * Shared by ExpenseForm and BatchExpenseForm so the two capture flows cannot
 * drift on timeout, error wording, or image handling — they previously
 * duplicated all three.
 */
import type { ExtractedReceiptData } from "./ocr";
import { prepareImageForOcr } from "./imageForOcr";
import { ocrFailureMessage, ocrHttpErrorMessage } from "./ocrErrorMessage";

/**
 * Client-side deadline, deliberately just under /api/ocr's own 60s
 * maxDuration.
 *
 * Without it the browser waits on a request the platform has already killed:
 * the tab sits on "กำลังอ่าน" indefinitely, and in a batch that one entry
 * blocks the queue behind it. Aborting at 55s means the browser always gives
 * up slightly before the server can, so the user gets a real timeout message
 * instead of a hang.
 */
export const OCR_CLIENT_TIMEOUT_MS = 55_000;

export const OCR_TIMEOUT_MESSAGE = "อ่านข้อมูลนานเกินไป (หมดเวลา) — ลองอ่านใหม่อีกครั้ง หรือกรอกข้อมูลเอง";

/**
 * Reads one receipt. Resolves with whatever Gemini extracted (possibly an
 * empty object, when the document simply had nothing readable), or throws an
 * Error whose message is already user-facing Thai.
 *
 * Callers are expected to keep manual entry available on every throw — a
 * failed read must never block someone from typing the bill in themselves.
 */
export async function requestOcr(
  file: File,
  { timeoutMs = OCR_CLIENT_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ExtractedReceiptData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A caller-supplied signal (e.g. the component unmounting) aborts too.
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const payload = new FormData();
    // Only the OCR copy is shrunk — the original file is what still goes to
    // Drive on submit. See lib/imageForOcr.ts.
    payload.append("file", await prepareImageForOcr(file));

    const res = await fetch("/api/ocr", { method: "POST", body: payload, signal: controller.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || ocrHttpErrorMessage(res.status));

    const failure = json.failure as { code: string; detail: string; status?: number } | undefined;
    if (failure) throw new Error(ocrFailureMessage(failure.code, failure.detail, failure.status));

    return (json.data ?? {}) as ExtractedReceiptData;
  } catch (err) {
    // fetch reports an abort as an AbortError regardless of which signal
    // fired, so the timeout has to be recognised here rather than trusted to
    // surface itself.
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(OCR_TIMEOUT_MESSAGE);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
