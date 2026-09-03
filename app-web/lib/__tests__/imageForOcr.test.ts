/**
 * shouldDownscaleForOcr decides whether a captured file gets re-encoded
 * before being sent to /api/ocr. The two things it must never get wrong:
 * a PDF must not be run through an image canvas, and the receipt originals
 * that go to Drive are chosen elsewhere — this only ever gates the OCR copy.
 */
import { describe, it, expect } from "vitest";
import { shouldDownscaleForOcr } from "../imageForOcr";

const MB = 1_000_000;

describe("shouldDownscaleForOcr", () => {
  it("downscales a large phone photo", () => {
    expect(shouldDownscaleForOcr({ type: "image/jpeg", size: 6 * MB })).toBe(true);
  });

  it("downscales a large PNG screenshot", () => {
    expect(shouldDownscaleForOcr({ type: "image/png", size: 5 * MB })).toBe(true);
  });

  it("never touches a PDF, however large", () => {
    // Re-encoding a PDF through a canvas would destroy it — the OCR route
    // accepts PDFs directly and Gemini reads them natively.
    expect(shouldDownscaleForOcr({ type: "application/pdf", size: 9 * MB })).toBe(false);
  });

  it("leaves an already-small image alone", () => {
    expect(shouldDownscaleForOcr({ type: "image/jpeg", size: 300_000 })).toBe(false);
  });

  it("uses the given threshold when one is passed", () => {
    expect(shouldDownscaleForOcr({ type: "image/jpeg", size: 300_000 }, 200_000)).toBe(true);
  });
});
