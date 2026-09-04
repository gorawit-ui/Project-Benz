/**
 * The client-side OCR deadline. /api/ocr may run for up to 60s (its
 * maxDuration), and without a browser-side abort the tab waits on a request
 * the platform has already killed — in a batch, that one entry blocks the
 * queue behind it forever. These tests pin that the abort fires below the
 * server's own ceiling and surfaces as a timeout the user can act on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { requestOcr, OCR_CLIENT_TIMEOUT_MS, OCR_TIMEOUT_MESSAGE } from "../ocrClient";

const ROUTE_MAX_DURATION_MS = 60_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OCR_CLIENT_TIMEOUT_MS", () => {
  it("gives up before the route's own 60s limit can kill the request", () => {
    expect(OCR_CLIENT_TIMEOUT_MS).toBeLessThan(ROUTE_MAX_DURATION_MS);
  });

  it("still allows a genuinely slow read to finish", () => {
    // Retries inside the route are budgeted to ~30s (see lib/ocr.ts), so the
    // client must not cut in before those can complete.
    expect(OCR_CLIENT_TIMEOUT_MS).toBeGreaterThan(30_000);
  });
});

describe("requestOcr", () => {
  it("reports a timeout in words the user can act on, not an AbortError", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError"))
        );
      })
    );

    const file = new File(["x"], "receipt.pdf", { type: "application/pdf" });
    // 1ms deadline so the abort path runs immediately.
    await expect(requestOcr(file, { timeoutMs: 1 })).rejects.toThrow(OCR_TIMEOUT_MESSAGE);
  });

  it("returns the extracted data on a normal read", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { supplierNameTh: "ร้านทดสอบ", grandTotal: 120 } }),
    }));

    const file = new File(["x"], "receipt.pdf", { type: "application/pdf" });
    await expect(requestOcr(file)).resolves.toEqual({ supplierNameTh: "ร้านทดสอบ", grandTotal: 120 });
  });

  it("raises a reported failure rather than returning an empty read as success", async () => {
    // A 200 carrying `failure` is how a totally broken OCR call reaches the
    // browser; treating it as a successful empty read is the bug that let one
    // go unnoticed in production.
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: {}, failure: { code: "api_error", detail: "boom", status: 503 } }),
    }));

    const file = new File(["x"], "receipt.pdf", { type: "application/pdf" });
    await expect(requestOcr(file)).rejects.toThrow(/หนาแน่น/);
  });

  it("maps an HTTP error status to its own message", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 413, json: async () => ({}) }));

    const file = new File(["x"], "receipt.pdf", { type: "application/pdf" });
    await expect(requestOcr(file)).rejects.toThrow(/4.5MB/);
  });
});
