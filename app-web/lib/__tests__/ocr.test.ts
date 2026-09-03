/**
 * `enum` in RESPONSE_SCHEMA is meant to stop Gemini from ever returning a
 * suggestedCategory/suggestedAccName outside CATEGORY_OPTIONS/
 * ACC_NAME_OPTIONS, but the schema constraint lives on Google's side, not
 * ours — a model quirk, an API change, or a future edit to the option lists
 * could all let a stale or invented value through. sanitize() is the code's
 * own backstop: these tests prove it actually drops anything that isn't a
 * real, current option, rather than trusting the model's JSON blindly.
 */
import { describe, it, expect } from "vitest";
import { sanitize, extractReceiptData } from "../ocr";
import { CATEGORY_OPTIONS, ACC_NAME_OPTIONS } from "../categoryMapping";

describe("sanitize", () => {
  it("keeps a suggestedCategory/suggestedAccName that are real, current options", () => {
    const result = sanitize({
      suggestedCategory: CATEGORY_OPTIONS[0],
      suggestedAccName: ACC_NAME_OPTIONS[0],
    });
    expect(result.suggestedCategory).toBe(CATEGORY_OPTIONS[0]);
    expect(result.suggestedAccName).toBe(ACC_NAME_OPTIONS[0]);
  });

  it("drops a suggestedCategory that isn't in CATEGORY_OPTIONS (model hallucination)", () => {
    const result = sanitize({
      suggestedCategory: "[EXP99999999999] หมวดหมู่ที่ไม่มีจริง",
      suggestedAccName: ACC_NAME_OPTIONS[0],
    });
    expect(result.suggestedCategory).toBeUndefined();
    expect(result.suggestedAccName).toBe(ACC_NAME_OPTIONS[0]);
  });

  it("drops a suggestedAccName that isn't in ACC_NAME_OPTIONS (model hallucination)", () => {
    const result = sanitize({ suggestedAccName: "[999999] บัญชีที่ไม่มีจริง" });
    expect(result.suggestedAccName).toBeUndefined();
  });

  it("leaves both fields out entirely when the model omits them", () => {
    const result = sanitize({ documentType: "ใบเสร็จรับเงิน" });
    expect("suggestedCategory" in result).toBe(false);
    expect("suggestedAccName" in result).toBe(false);
  });
});

describe("extractReceiptData failure reporting", () => {
  it("never lets an API key reach the failure detail", async () => {
    // The detail is surfaced in the browser, so a Google client error that
    // embeds the request URL (…?key=AIza…) must come back redacted.
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await extractReceiptData(Buffer.from(""), "image/jpeg");
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;

    expect(result.failure?.code).toBe("missing_api_key");
    expect(result.data).toEqual({});
    expect(JSON.stringify(result)).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(JSON.stringify(result)).not.toMatch(/key=[^*]/);
  });
});
