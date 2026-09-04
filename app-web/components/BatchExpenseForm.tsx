"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DocumentType, FundType } from "@/lib/sheets";
import type { ExtractedReceiptData } from "@/lib/ocr";
import { getAccNameForCategory, matchCategoryAndAccName } from "@/lib/categoryMapping";
import { runWithConcurrency } from "@/lib/concurrency";
import { requestOcr } from "@/lib/ocrClient";
import { ActionButton, PageShell, SectionHeading, Surface } from "./ui";
import OcrProgressOverlay from "./OcrProgressOverlay";
import SuccessDialog from "./SuccessDialog";

const DOCUMENT_TYPES: DocumentType[] = ["ใบเสร็จรับเงิน", "ใบกำกับภาษี", "บิลเงินสด", "บิลทางด่วน", "สลิป Grab"];
const VAT_RATE = 0.07;
// Firing OCR for every file in parallel meant a full 20-file batch sent 20
// simultaneous Gemini requests. The Gemini free tier's binding limit is
// requests-per-minute, not how many are in flight at once — so concurrency
// alone (even limit: 1) doesn't guarantee staying under it if each call
// happens to resolve quickly. One file at a time, at least
// OCR_MIN_INTERVAL_MS apart, keeps a full batch under that ceiling
// regardless of how fast Gemini responds. See lib/concurrency.ts's
// minIntervalMs — it only adds a wait when a call finishes faster than this
// floor, so a naturally slower call (a big PDF, a busy moment) isn't padded
// further.
//
// This project's measured free-tier ceiling is 5 RPM, not the ~10 RPM an
// earlier comment here claimed, so the floor is 15s (4 RPM) to keep a
// margin under it. A large batch is therefore slow by design — partial
// submit (below) exists so nobody has to wait for all of it.
const OCR_CONCURRENCY = 1;
const OCR_MIN_INTERVAL_MS = 15_000; // 4 requests/min, under the 5 RPM free-tier cap

type FormState = {
  fundType: FundType;
  documentType: DocumentType;
  documentNumber: string;
  poNumber: string;
  billDate: string;
  supplierNameTh: string;
  supplierNameEn: string;
  expenseDetail: string;
  odooCategory: string;
  accName: string;
  amountBeforeVat: string;
  vatAmount: string;
  grandTotal: string;
  hasVat: boolean;
};

type Entry = {
  key: string;
  file: File;
  form: FormState;
  ocrState: "loading" | "done" | "warning";
  ocrText: string;
};

const emptyForm = (): FormState => ({
  fundType: "เงินสดย่อย",
  documentType: "ใบเสร็จรับเงิน",
  documentNumber: "",
  poNumber: "",
  billDate: "",
  supplierNameTh: "",
  supplierNameEn: "",
  expenseDetail: "",
  odooCategory: "",
  accName: "",
  amountBeforeVat: "",
  vatAmount: "",
  grandTotal: "",
  hasVat: true,
});

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: string) {
  if (!value) return "";
  const [integer, decimal] = value.split(".");
  const formatted = Number(integer || 0).toLocaleString("en-US");
  return decimal === undefined ? formatted : formatted + "." + decimal;
}

function parseMoney(value: string) {
  return value.replace(/,/g, "").replace(/[^\d.]/g, "");
}

function isEntryComplete(entry: Entry) {
  const { form } = entry;
  return Boolean(
    form.documentNumber.trim() &&
      form.billDate &&
      form.supplierNameTh.trim() &&
      form.expenseDetail.trim() &&
      form.odooCategory.trim() &&
      (!form.hasVat || (Number(form.amountBeforeVat) >= 0 && Number(form.vatAmount) >= 0)) &&
      Number(form.grandTotal) > 0
  );
}

/**
 * An entry can be saved when its fields are complete AND its read has
 * settled. A still-loading entry is excluded even if OCR already filled
 * enough to look complete: its own response could still overwrite the very
 * values being submitted.
 */
export function isEntryReady(entry: Entry): boolean {
  return entry.ocrState !== "loading" && isEntryComplete(entry);
}

/**
 * The batch endpoint applies the multi-file auto-approval policy, which is
 * defined for 2+ bills. Submitting a lone bill through it would auto-approve
 * something reviewed by nobody but its author.
 */
const MIN_BATCH_SUBMIT = 2;

function ocrPatch(data: ExtractedReceiptData): Partial<FormState> {
  const patch: Partial<FormState> = {};
  if (data.documentType) patch.documentType = data.documentType;
  if (data.documentNumber) patch.documentNumber = data.documentNumber;
  if (data.billDate) patch.billDate = data.billDate;
  if (data.supplierNameTh) patch.supplierNameTh = data.supplierNameTh;
  if (data.supplierNameEn) patch.supplierNameEn = data.supplierNameEn;
  if (data.expenseDetail) patch.expenseDetail = data.expenseDetail;
  if (data.amountBeforeVat !== undefined) patch.amountBeforeVat = String(data.amountBeforeVat);
  if (data.vatAmount !== undefined) patch.vatAmount = String(data.vatAmount);
  if (data.grandTotal !== undefined) patch.grandTotal = String(data.grandTotal);

  // A receipt with just one total and no VAT signal (for example a DBD fee)
  // is not a VAT invoice. Keep the screen simple, while still supplying the
  // fixed A:Z Sheet columns on save: before VAT = total and VAT = 0.
  if (data.grandTotal !== undefined && data.amountBeforeVat === undefined && data.vatAmount === undefined) {
    patch.hasVat = false;
    patch.amountBeforeVat = String(data.grandTotal);
    patch.vatAmount = "0";
  } else if (data.amountBeforeVat !== undefined || data.vatAmount !== undefined) {
    patch.hasVat = true;
  }

  const vendor = data.supplierNameTh || data.supplierNameEn || "";
  const matched = matchCategoryAndAccName(vendor, data.expenseDetail || "");
  if (matched) {
    patch.odooCategory = matched.category;
    patch.accName = matched.accName;
  } else {
    if (data.suggestedCategory) patch.odooCategory = data.suggestedCategory;
    if (data.suggestedAccName) patch.accName = data.suggestedAccName;
  }

  if (data.amountBeforeVat !== undefined && data.vatAmount === undefined && data.grandTotal === undefined) {
    const vat = round2(data.amountBeforeVat * VAT_RATE);
    patch.vatAmount = String(vat);
    patch.grandTotal = String(round2(data.amountBeforeVat + vat));
  }
  return patch;
}

export default function BatchExpenseForm({ files }: { files: File[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>(() =>
    files.map((file, index) => ({
      key: String(index) + "-" + file.name + "-" + file.lastModified,
      file,
      form: emptyForm(),
      ocrState: "loading",
      ocrText: "กำลังอ่านข้อมูลจากเอกสาร...",
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  // How many entries were still on the page after the last save — decides
  // whether this was a partial save (stay here) or the last one (go to the
  // dashboard).
  const [remainingAfterSave, setRemainingAfterSave] = useState(0);
  // A batch whose reads keep hitting an overloaded Gemini is retried with
  // backoff per file, so the overlay can legitimately stay up for minutes on
  // a large batch. Let it be dismissed — reading carries on behind it, and
  // every entry is editable anyway.
  const [ocrOverlayDismissed, setOcrOverlayDismissed] = useState(false);
  // Keys of entries already written to the Sheet by a partial submit. A read
  // that was still in flight when its entry was saved must not land on it
  // afterwards: the row is committed, so re-filling the form from a late OCR
  // response would show data that no longer matches what was stored. Held in
  // a ref because the OCR workers close over it and must see every update.
  const savedKeysRef = useRef<Set<string>>(new Set());

  /** Reads one entry and folds the result into its own row. Never throws. */
  const runEntryOcr = useCallback(async (entry: Entry) => {
    try {
      const data = await requestOcr(entry.file);
      if (savedKeysRef.current.has(entry.key)) return;
      setEntries((current) => current.map((item) =>
        item.key === entry.key
          ? {
              ...item,
              form: { ...item.form, ...ocrPatch(data) },
              ocrState: data.confidence === "low" ? "warning" : "done",
              ocrText: data.confidence === "low" ? "อ่านได้ไม่ชัด กรุณาตรวจทานก่อนบันทึก" : "OCR อ่านข้อมูลแล้ว กรุณาตรวจทานและแก้ไขได้",
            }
          : item
      ));
    } catch (cause) {
      if (savedKeysRef.current.has(entry.key)) return;
      setEntries((current) => current.map((item) =>
        item.key === entry.key
          ? { ...item, ocrState: "warning", ocrText: cause instanceof Error ? cause.message : "อ่านข้อมูลไม่ได้ — กรอกข้อมูลเองได้" }
          : item
      ));
    }
  }, []);

  /** Re-reads a single entry after a failed or unclear first pass. */
  function retryEntryOcr(key: string) {
    const entry = entries.find((item) => item.key === key);
    if (!entry) return;
    setEntries((current) => current.map((item) =>
      item.key === key ? { ...item, ocrState: "loading", ocrText: "กำลังอ่านข้อมูลจากเอกสาร..." } : item
    ));
    void runEntryOcr(entry);
  }

  useEffect(() => {
    void runWithConcurrency(entries, OCR_CONCURRENCY, runEntryOcr, { minIntervalMs: OCR_MIN_INTERVAL_MS });
    // files are fixed when entering this page; each entry must be OCR'd once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key: string, patch: Partial<FormState>) {
    setEntries((current) => current.map((entry) => entry.key === key ? { ...entry, form: { ...entry.form, ...patch } } : entry));
  }

  function updateBeforeVat(key: string, value: string) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      update(key, { amountBeforeVat: value });
      return;
    }
    const vat = round2(numeric * VAT_RATE);
    update(key, { amountBeforeVat: value, vatAmount: String(vat), grandTotal: String(round2(numeric + vat)) });
  }

  function updateGrandTotal(key: string, value: string) {
    setEntries((current) => current.map((entry) => {
      if (entry.key !== key) return entry;
      return {
        ...entry,
        form: entry.form.hasVat
          ? { ...entry.form, grandTotal: value }
          : { ...entry.form, amountBeforeVat: value, vatAmount: "0", grandTotal: value },
      };
    }));
  }

  function setVatEnabled(key: string, hasVat: boolean) {
    setEntries((current) => current.map((entry) => {
      if (entry.key !== key) return entry;
      if (hasVat) return { ...entry, form: { ...entry.form, hasVat: true } };
      const total = entry.form.grandTotal || entry.form.amountBeforeVat;
      return {
        ...entry,
        form: { ...entry.form, hasVat: false, amountBeforeVat: total, vatAmount: "0", grandTotal: total },
      };
    }));
  }

  async function upload(entry: Entry): Promise<string> {
    const payload = new FormData();
    payload.append("file", entry.file);
    payload.append("supplierName", entry.form.supplierNameEn || entry.form.supplierNameTh || entry.file.name);
    const res = await fetch("/api/upload", { method: "POST", body: payload });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "อัปโหลดไฟล์ขึ้น Google Drive ไม่สำเร็จ");
    return String(json.webViewLink || "");
  }

  /**
   * Saves the entries that are ready, and only those.
   *
   * A 20-file batch reads one file at a time (see OCR_MIN_INTERVAL_MS), so
   * insisting every entry be finished before anything could be saved left a
   * user who had reviewed 3 bills unable to submit any of them while the
   * other 17 were still reading or had timed out. Ready entries go now; the
   * rest stay on screen with their reads still running.
   *
   * Incomplete or still-loading entries are never uploaded — a Drive file
   * with no Sheet row behind it is exactly the orphan this avoids.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const ready = entries.filter(isEntryReady);
    // The batch endpoint carries the multi-file auto-approval policy, so it
    // needs at least the 2 bills that policy is defined for. One ready bill
    // waits for a second rather than going through as an auto-approved
    // single — that would approve a bill nobody else reviewed.
    if (ready.length < MIN_BATCH_SUBMIT) {
      setError(`ต้องมีบิลที่ตรวจครบอย่างน้อย ${MIN_BATCH_SUBMIT} ใบจึงจะบันทึกได้ (ตอนนี้พร้อม ${ready.length} ใบ)`);
      return;
    }

    setSubmitting(true);
    try {
      const receiptFileLinks = await Promise.all(ready.map(upload));
      const res = await fetch("/api/expenses/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: ready.map((entry, index) => ({
            ...entry.form,
            amountBeforeVat: entry.form.hasVat ? Number(entry.form.amountBeforeVat) : Number(entry.form.grandTotal),
            vatAmount: entry.form.hasVat ? Number(entry.form.vatAmount) : 0,
            grandTotal: Number(entry.form.grandTotal),
            receiptFileLink: receiptFileLinks[index],
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "บันทึกชุดเอกสารไม่สำเร็จ");

      // The endpoint is all-or-nothing, so a 2xx means every submitted entry
      // is now a row. Drop exactly those and keep the rest reading.
      const savedKeys = new Set(ready.map((entry) => entry.key));
      savedKeys.forEach((key) => savedKeysRef.current.add(key));
      const remaining = entries.filter((entry) => !savedKeys.has(entry.key));
      setEntries(remaining);
      setSavedCount(ready.length);
      setRemainingAfterSave(remaining.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกชุดเอกสารไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
  const labelClass = "block text-xs font-semibold text-slate-700";
  // "Ready" is what the save button acts on: complete AND finished reading.
  // notReadyCount therefore covers both "still reading" and "needs review",
  // which are the two reasons an entry cannot go yet.
  const readyCount = entries.filter(isEntryReady).length;
  const notReadyCount = entries.length - readyCount;
  const stillReadingCount = entries.filter((entry) => entry.ocrState === "loading").length;
  const canSubmit = readyCount >= MIN_BATCH_SUBMIT;
  const readyTotal = entries.filter(isEntryReady).reduce((sum, entry) => sum + (Number(entry.form.grandTotal) || 0), 0);
  const ocrCompletedCount = entries.filter((entry) => entry.ocrState !== "loading").length;
  const ocrCurrentFile = entries.find((entry) => entry.ocrState === "loading")?.file.name;

  return (
    <>
    <PageShell>
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--brand)]">Batch expense entry</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--ink)]">ตรวจข้อมูล {entries.length} เอกสารก่อนบันทึก</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        OCR อ่านเอกสารทุกใบแล้ว ให้ตรวจและแก้ข้อมูลของแต่ละบิลก่อนกดบันทึกครั้งเดียว ระบบจะอัปโหลดทั้งหมดและบันทึกเป็นรายการแยกบิล โดยผ่านอัตโนมัติ
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        {entries.map((entry, index) => (
          <Surface key={entry.key} className="p-4 sm:p-6">
            <SectionHeading number={String(index + 1)} title={entry.file.name} description={entry.ocrText} />
            <div className={`mb-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${isEntryComplete(entry) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
              {isEntryComplete(entry) ? "พร้อมบันทึก" : "ยังมีข้อมูลที่ต้องตรวจ"}
            </div>
            <div className={"mt-3 rounded-lg px-3 py-2 text-xs " + (entry.ocrState === "done" ? "bg-emerald-50 text-emerald-800" : entry.ocrState === "loading" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-900")}>
              <p>{entry.ocrState === "loading" ? "กำลัง OCR..." : entry.ocrState === "done" ? "OCR สำเร็จ — ตรวจข้อมูลก่อนส่ง" : entry.ocrText}</p>
              {/* A timed-out or overloaded read is worth another go on this
                  one file, without re-reading the whole batch. */}
              {entry.ocrState === "warning" && (
                <button
                  type="button"
                  onClick={() => retryEntryOcr(entry.key)}
                  className="mt-2 rounded-md border border-current px-2.5 py-1 font-semibold hover:bg-white/60"
                >
                  อ่านใหม่อีกครั้ง
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={labelClass}>ประเภทเอกสาร
                <select className={inputClass} value={entry.form.documentType} onChange={(e) => update(entry.key, { documentType: e.target.value as DocumentType })}>
                  {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className={labelClass}>วันที่ในบิล
                <input required type="date" className={inputClass} value={entry.form.billDate} onChange={(e) => update(entry.key, { billDate: e.target.value })} />
              </label>
              <label className={labelClass}>เลขที่เอกสาร
                <input required className={inputClass} value={entry.form.documentNumber} onChange={(e) => update(entry.key, { documentNumber: e.target.value })} />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>ชื่อซัพพลายเออร์ (ไทย)
                <input required className={inputClass} value={entry.form.supplierNameTh} onChange={(e) => update(entry.key, { supplierNameTh: e.target.value })} />
              </label>
              <label className={labelClass}>ชื่อซัพพลายเออร์ (English)
                <input className={inputClass} value={entry.form.supplierNameEn} onChange={(e) => update(entry.key, { supplierNameEn: e.target.value })} />
              </label>
            </div>

            <label className={"mt-3 " + labelClass}>รายละเอียดค่าใช้จ่าย
              <textarea required rows={2} className={inputClass} value={entry.form.expenseDetail} onChange={(e) => update(entry.key, { expenseDetail: e.target.value })} />
            </label>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>หมวดหมู่ (ตาม Odoo)
                <input required className={inputClass} value={entry.form.odooCategory} onChange={(e) => {
                  const value = e.target.value;
                  update(entry.key, { odooCategory: value, ...(getAccNameForCategory(value) ? { accName: getAccNameForCategory(value) } : {}) });
                }} />
              </label>
              <label className={labelClass}>ชื่อบัญชี (Acc name)
                <input className={inputClass} value={entry.form.accName} onChange={(e) => update(entry.key, { accName: e.target.value })} />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-[var(--ink)]">เอกสารนี้มี VAT 7%</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">ปิดได้หากบิลแสดงเพียงยอดสุทธิ</p>
              </div>
              <button type="button" role="switch" aria-checked={entry.form.hasVat} aria-label="เอกสารนี้มี VAT 7%" onClick={() => setVatEnabled(entry.key, !entry.form.hasVat)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${entry.form.hasVat ? "bg-emerald-700" : "bg-slate-300"}`}>
                <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${entry.form.hasVat ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {entry.form.hasVat ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={labelClass}>ก่อน VAT
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.amountBeforeVat)} onChange={(e) => updateBeforeVat(entry.key, parseMoney(e.target.value))} />
                </label>
                <label className={labelClass}>VAT 7%
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.vatAmount)} onChange={(e) => update(entry.key, { vatAmount: parseMoney(e.target.value) })} />
                </label>
                <label className={labelClass}>ยอดรวม
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.grandTotal)} onChange={(e) => updateGrandTotal(entry.key, parseMoney(e.target.value))} />
                </label>
              </div>
            ) : (
              <div className="mt-3">
                <label className={labelClass}>ยอดสุทธิ / ยอดรวม
                  <input required inputMode="decimal" className={inputClass} value={formatMoney(entry.form.grandTotal)} onChange={(e) => updateGrandTotal(entry.key, parseMoney(e.target.value))} />
                </label>
                <p className="mt-1 text-[11px] text-[var(--muted)]">ระบบจะบันทึกยอดก่อน VAT เท่ากับยอดสุทธิ และ VAT เป็น 0 บาท</p>
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>ประเภทเงิน
                <select className={inputClass} value={entry.form.fundType} onChange={(e) => update(entry.key, { fundType: e.target.value as FundType })}>
                  <option value="เงินสดย่อย">เงินสดย่อย</option>
                  <option value="เงินทดรองจ่าย">เงินทดรองจ่าย</option>
                </select>
              </label>
              <label className={labelClass}>เลขที่ PO (ถ้ามี)
                <input className={inputClass} value={entry.form.poNumber} onChange={(e) => update(entry.key, { poNumber: e.target.value })} />
              </label>
            </div>
          </Surface>
        ))}

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        <div className="sticky bottom-3 z-20 rounded-2xl border border-[var(--line)] bg-white/95 p-3 shadow-xl backdrop-blur sm:static sm:shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-[var(--ink)]">พร้อมบันทึก {readyCount} จาก {entries.length} บิล</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">ยอดรวมของบิลที่พร้อม ฿{readyTotal.toLocaleString("th-TH", { maximumFractionDigits: 2 })}</p>
            </div>
            {notReadyCount > 0 && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                {stillReadingCount > 0 ? `กำลังอ่าน ${stillReadingCount} ใบ` : `รอตรวจ ${notReadyCount} ใบ`}
              </span>
            )}
          </div>
          <ActionButton type="submit" disabled={submitting || !canSubmit} className="w-full">
            {submitting
              ? "กำลังอัปโหลดและบันทึก..."
              : canSubmit
                ? `บันทึก ${readyCount} บิลที่พร้อม และผ่านอัตโนมัติ`
                : `ต้องมีบิลที่ตรวจครบอย่างน้อย ${MIN_BATCH_SUBMIT} ใบ (พร้อม ${readyCount} ใบ)`}
          </ActionButton>
          {notReadyCount > 0 && canSubmit && (
            <p className="mt-2 text-center text-xs text-[var(--muted)]">
              บิลที่ยังไม่พร้อมอีก {notReadyCount} ใบจะยังอยู่ในหน้านี้ ให้ตรวจและส่งต่อได้
            </p>
          )}
        </div>
      </form>

      {savedCount !== null && (
        // Only leave the page once nothing is left to review — redirecting
        // after a partial save would strand the bills still on screen.
        remainingAfterSave > 0 ? (
          <SuccessDialog
            title="บันทึกสำเร็จแล้ว"
            detail={`บันทึก ${savedCount} บิลแล้ว สถานะเป็น “ตรวจแล้ว” ส่วนที่เหลือยังอยู่ในหน้านี้เพื่อให้ตรวจและส่งต่อได้`}
            primaryLabel="ตรวจบิลที่เหลือต่อ"
            onPrimary={() => setSavedCount(null)}
            onClose={() => setSavedCount(null)}
          />
        ) : (
          <SuccessDialog
            title="บันทึกสำเร็จแล้ว"
            detail={`อัปโหลดและบันทึก ${savedCount} บิลลง Google Sheet แล้ว สถานะเป็น “ตรวจแล้ว” กำลังพาไปหน้า Dashboard`}
            primaryLabel="ไปที่ Dashboard ตอนนี้"
            onPrimary={() => router.push("/dashboard")}
            autoRedirectSeconds={2}
          />
        )
      )}
    </PageShell>
    {ocrCompletedCount < entries.length && !ocrOverlayDismissed && (
      <OcrProgressOverlay
        completed={ocrCompletedCount}
        total={entries.length}
        currentFileName={ocrCurrentFile}
        onDismiss={() => setOcrOverlayDismissed(true)}
      />
    )}
    </>
  );
}
