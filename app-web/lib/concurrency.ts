export interface RunWithConcurrencyOptions {
  /**
   * Minimum time (ms) between successive worker *starts*, enforced across
   * the whole run — not per lane, and not "time between finishes". 0
   * (default) means no pacing, only the concurrency cap applies.
   *
   * This exists because a concurrency cap alone doesn't bound requests per
   * minute: if each call resolves quickly, even `limit: 1` can still fire
   * far more than N times a minute. Gemini's free tier is capped by RPM
   * (requests/minute), not by how many are in flight at once, so batch OCR
   * (BatchExpenseForm.tsx) needs this floor, not just the concurrency cap.
   */
  minIntervalMs?: number;
}

/**
 * Runs `worker` over every item in `items`, at most `limit` running at once
 * (and, if `minIntervalMs` is set, no more often than one start per that
 * interval — see RunWithConcurrencyOptions above).
 *
 * Built for batch OCR (see BatchExpenseForm.tsx): firing one Gemini request
 * per file in parallel with no cap meant a 20-file batch could hit the API
 * with 20 simultaneous calls. This bounds that without changing what each
 * call does or how its result is handled — callers still process one item
 * at a time, they just don't all start together (and, with pacing, don't
 * start faster than the given floor either).
 *
 * A worker that throws is swallowed here and does not stop the rest of the
 * queue (it must not: the pool that hit the failing item would otherwise
 * stop pulling new work and silently starve whatever's left). Callers that
 * need to observe/report a failure should catch it themselves inside
 * `worker` — that's the normal path, since each item's own error usually
 * needs to update that item's own UI state, not the whole batch's.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  options: RunWithConcurrencyOptions = {}
): Promise<void> {
  if (items.length === 0) return;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  const minIntervalMs = options.minIntervalMs ?? 0;
  let nextIndex = 0;
  // Next wall-clock time (ms) a worker is allowed to start. Reserved
  // synchronously inside waitForSlot, before its own `await`, so concurrent
  // lanes calling it back-to-back still claim non-overlapping slots instead
  // of racing on a stale read of this value.
  let nextAllowedStartAt = 0;

  async function waitForSlot(): Promise<void> {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const start = Math.max(now, nextAllowedStartAt);
    nextAllowedStartAt = start + minIntervalMs;
    const delay = start - now;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async function runOne(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await waitForSlot();
      try {
        await worker(items[index], index);
      } catch (err) {
        console.error("runWithConcurrency: worker threw for item", index, err);
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, runOne));
}
