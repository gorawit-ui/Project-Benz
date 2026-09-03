/**
 * The failures that actually happen in production (Vercel timeout, oversized
 * body, Gemini quota) come back as HTML, not JSON — so this mapping is the
 * only thing standing between the user and an undiagnosable generic error.
 * Each case must stay distinguishable from the others.
 */
import { describe, it, expect } from "vitest";
import { ocrFailureMessage, ocrHttpErrorMessage } from "../ocrErrorMessage";

describe("ocrHttpErrorMessage", () => {
  it("names the size limit for a 413", () => {
    expect(ocrHttpErrorMessage(413)).toContain("4.5MB");
  });

  it("names the timeout for a 504", () => {
    expect(ocrHttpErrorMessage(504)).toContain("หมดเวลา");
  });

  it("names the quota for a 429", () => {
    expect(ocrHttpErrorMessage(429)).toContain("โควตา");
  });

  it("tells the user to sign in again on a 401", () => {
    expect(ocrHttpErrorMessage(401)).toContain("เข้าสู่ระบบ");
  });

  it("still carries the status code for anything unmapped", () => {
    expect(ocrHttpErrorMessage(500)).toContain("500");
  });

  it("gives every mapped status a distinct message", () => {
    const messages = [413, 429, 504, 401, 500].map(ocrHttpErrorMessage);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("ocrFailureMessage", () => {
  it("names a missing API key distinctly from an API error", () => {
    const missing = ocrFailureMessage("missing_api_key", "GEMINI_API_KEY is not configured");
    const apiError = ocrFailureMessage("api_error", "404 model not found");
    expect(missing).toContain("API key");
    expect(apiError).not.toBe(missing);
  });

  it("carries the upstream detail through so the cause is visible", () => {
    // Without the detail there is no way to tell a dead model name from a
    // quota block — both previously showed as a green success.
    expect(ocrFailureMessage("api_error", "404 model gemini-x not found")).toContain("gemini-x");
  });

  it("always tells the user they can still type it in themselves", () => {
    for (const code of ["missing_api_key", "api_error", "empty_response", "bad_json", "weird"]) {
      expect(ocrFailureMessage(code, "")).toContain("กรอกข้อมูลเอง");
    }
  });
});

describe("ocrFailureMessage transient upstream statuses", () => {
  it("explains a 503 as temporary load, not as a broken system", () => {
    const message = ocrFailureMessage("api_error", '{"error":{"code":503}}', 503);
    expect(message).toContain("หนาแน่น");
    // The raw API body must not be dumped on someone holding a receipt.
    expect(message).not.toContain("{");
  });

  it("keeps 429 quota wording distinct from 503 load wording", () => {
    expect(ocrFailureMessage("api_error", "", 429)).not.toBe(ocrFailureMessage("api_error", "", 503));
  });

  it("still shows the raw detail for statuses that need diagnosing", () => {
    expect(ocrFailureMessage("api_error", "404 model gone", 404)).toContain("404 model gone");
  });
});
