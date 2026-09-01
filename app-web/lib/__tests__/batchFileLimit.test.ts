/**
 * Guards the client-side batch file-count check: selecting more than 20
 * files must be rejected before CaptureFlow ever switches to
 * BatchExpenseForm — otherwise a user OCRs and uploads every file only to
 * hit the server's own 20-file cap at the very last step.
 */
import { describe, it, expect } from "vitest";
import { MAX_BATCH_FILES, getBatchFileCountError } from "../batchFileLimit";

describe("getBatchFileCountError", () => {
  it("allows a single file", () => {
    expect(getBatchFileCountError(1)).toBeNull();
  });

  it("allows exactly the max", () => {
    expect(getBatchFileCountError(MAX_BATCH_FILES)).toBeNull();
  });

  it("rejects one more than the max", () => {
    const error = getBatchFileCountError(MAX_BATCH_FILES + 1);
    expect(error).not.toBeNull();
    expect(error).toContain(String(MAX_BATCH_FILES));
    expect(error).toContain(String(MAX_BATCH_FILES + 1));
  });

  it("rejects a much larger selection", () => {
    expect(getBatchFileCountError(50)).not.toBeNull();
  });
});
