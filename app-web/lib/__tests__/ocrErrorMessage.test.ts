/**
 * The failures that actually happen in production (Vercel timeout, oversized
 * body, Gemini quota) come back as HTML, not JSON — so this mapping is the
 * only thing standing between the user and an undiagnosable generic error.
 * Each case must stay distinguishable from the others.
 */
import { describe, it, expect } from "vitest";
import { ocrHttpErrorMessage } from "../ocrErrorMessage";

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
