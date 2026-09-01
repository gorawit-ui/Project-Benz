/**
 * runWithConcurrency backs the batch-OCR guardrail (BatchExpenseForm.tsx):
 * before this, OCR fired once per file with no cap, so a 20-file batch sent
 * 20 simultaneous Gemini requests. These tests pin the properties that
 * actually matter for that fix — every item still runs exactly once, the
 * pool never exceeds its limit, and one item's failure doesn't stall or
 * drop the rest of the batch.
 */
import { describe, it, expect, vi } from "vitest";
import { runWithConcurrency } from "../concurrency";

describe("runWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runWithConcurrency([10, 20, 30, 40], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  it("never runs more workers concurrently than the given limit", async () => {
    const items = [0, 1, 2, 3, 4, 5];
    let active = 0;
    let peak = 0;
    await runWithConcurrency(items, 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    expect(peak).toBe(2);
  });

  it("keeps processing remaining items when one worker throws", async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("boom");
      seen.push(item);
    });
    expect(seen.slice().sort()).toEqual([1, 3]);
  });

  it("never exceeds the item count even when the limit is larger", async () => {
    let active = 0;
    let peak = 0;
    await runWithConcurrency([1, 2], 10, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    expect(peak).toBe(2);
  });

  it("resolves immediately without calling the worker for an empty list", async () => {
    const worker = vi.fn();
    await runWithConcurrency([], 3, worker);
    expect(worker).not.toHaveBeenCalled();
  });

  describe("minIntervalMs pacing", () => {
    it("paces successive starts at least minIntervalMs apart when workers resolve fast", async () => {
      const starts: number[] = [];
      await runWithConcurrency(
        [1, 2, 3],
        1,
        async () => {
          starts.push(Date.now());
        },
        { minIntervalMs: 40 }
      );
      expect(starts).toHaveLength(3);
      for (let i = 1; i < starts.length; i++) {
        // A few ms of tolerance for timer jitter — the guarantee is a floor,
        // not exact-to-the-millisecond spacing.
        expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(35);
      }
    });

    it("does not add extra delay once a worker already exceeds minIntervalMs on its own", async () => {
      const start = Date.now();
      await runWithConcurrency(
        [1, 2],
        1,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
        },
        { minIntervalMs: 10 }
      );
      const elapsed = Date.now() - start;
      // Two ~60ms workers back to back should land near 120ms — if the 10ms
      // floor were wrongly re-applied on top of that, this would drift well
      // past it.
      expect(elapsed).toBeLessThan(160);
    });

    it("defaults to no pacing when minIntervalMs is omitted", async () => {
      const starts: number[] = [];
      await runWithConcurrency([1, 2, 3], 1, async () => {
        starts.push(Date.now());
      });
      // No floor between starts — this should finish near-instantly, not
      // spread out over any artificial interval.
      expect(Date.now() - starts[0]).toBeLessThan(50);
    });
  });
});
