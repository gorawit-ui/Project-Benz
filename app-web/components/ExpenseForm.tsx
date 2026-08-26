"use client";

import { useRef, useState, type FormEvent } from "react";
import type { DocumentType, FundType } from "@/lib/sheets";
import type { ExtractedReceiptData } from "@/lib/ocr";

const DOCUMENT_TYPES: DocumentType[] = ["ใบเสร็จรับเงิน", "ใบกำกับภาษี", "บิลเงินสด"];

const VAT_RATE = 0.07;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface FormState {
  fundType: FundType;
  documentType: DocumentType;
  documentNumber: string;
  poNumber: string;
  billDate: string;
  supplierNameTh: string;
  supplierNameEn: string;
  expenseDetail: string;
  // หมวดหมู่ (ตาม Odoo) — free text for now: the real Odoo chart-of-accounts
  // category list is not available yet (blocked on docs/04-open-items.md
  // item A: "หมวดหมู่ + Cost Center + Acc name จริงจาก Odoo — บล็อกที่สุด").
  // Once that list exists this should become a dropdown sourced from it.
  odooCategory: string;
  amountBeforeVat: string;
  vatAmount: string;
  grandTotal: string;
}

const INITIAL_STATE: FormState = {
  fundType: "เงินสดย่อย",
  documentType: "ใบเสร็จรับเงิน",
  documentNumber: "",
  poNumber: "",
  billDate: "",
  supplierNameTh: "",
  supplierNameEn: "",
  expenseDetail: "",
  odooCategory: "",
  amountBeforeVat: "",
  vatAmount: "",
  grandTotal: "",
};

type OcrMessage = { type: "success" | "warning" | "error"; text: string };

export default function ExpenseForm({ recordedByName }: { recordedByName: string }) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<OcrMessage | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleAmountBeforeVatChange(value: string) {
    const numeric = parseFloat(value);
    if (Number.isFinite(numeric)) {
      const vat = round2(numeric * VAT_RATE);
      const total = round2(numeric + vat);
      setForm((prev) => ({
        ...prev,
        amountBeforeVat: value,
        vatAmount: String(vat),
        grandTotal: String(total),
      }));
    } else {
      set("amountBeforeVat", value);
    }
  }

  /**
   * Merges OCR-extracted fields into the form. Only overwrites fields that
   * actually came back non-empty — a field OCR couldn't read is simply left
   * alone (whatever the user already typed, or blank, stays as-is).
   */
  function applyExtractedData(data: ExtractedReceiptData) {
    const patch: Partial<FormState> = {};
    if (data.documentType) patch.documentType = data.documentType;
    if (data.supplierNameTh) patch.supplierNameTh = data.supplierNameTh;
    if (data.supplierNameEn) patch.supplierNameEn = data.supplierNameEn;
    if (data.expenseDetail) patch.expenseDetail = data.expenseDetail;
    if (data.billDate) patch.billDate = data.billDate;
    if (data.documentNumber) patch.documentNumber = data.documentNumber;

    const hasBeforeVat = data.amountBeforeVat !== undefined;
    const hasVat = data.vatAmount !== undefined;
    const hasTotal = data.grandTotal !== undefined;

    if (Object.keys(patch).length > 0) {
      setForm((prev) => ({ ...prev, ...patch }));
    }

    if (hasBeforeVat && !hasVat && !hasTotal) {
      // OCR only read the pre-VAT amount — reuse the existing auto-calc so
      // vatAmount/grandTotal derive from it exactly like manual entry does.
      handleAmountBeforeVatChange(String(data.amountBeforeVat));
    } else if (hasBeforeVat || hasVat || hasTotal) {
      // OCR read at least two of the three amounts itself — trust its own
      // read rather than overwriting it with the auto-calc.
      setForm((prev) => ({
        ...prev,
        ...(hasBeforeVat ? { amountBeforeVat: String(data.amountBeforeVat) } : {}),
        ...(hasVat ? { vatAmount: String(data.vatAmount) } : {}),
        ...(hasTotal ? { grandTotal: String(data.grandTotal) } : {}),
      }));
    }
  }

  async function runOcr(file: File) {
    setOcrLoading(true);
    setOcrMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ocr", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "อ่านข้อมูลจากใบเสร็จไม่สำเร็จ");
      }
      const data = (json.data ?? {}) as ExtractedReceiptData;
      applyExtractedData(data);
      setOcrMessage(
        data.confidence === "low"
          ? { type: "warning", text: "อ่านข้อมูลได้ไม่ชัดเจน กรุณาตรวจสอบให้ละเอียด" }
          : { type: "success", text: "อ่านข้อมูลจากใบเสร็จแล้ว ตรวจสอบและแก้ไขได้ก่อนบันทึก" }
      );
    } catch (err) {
      // OCR failing must never block the flow — the file stays attached and
      // the employee can still fill the form in manually.
      setOcrMessage({
        type: "error",
        text: err instanceof Error ? err.message : "อ่านข้อมูลจากใบเสร็จไม่สำเร็จ กรุณากรอกข้อมูลเอง",
      });
    } finally {
      setOcrLoading(false);
    }
  }

  function handleFileSelected(file: File | null) {
    setReceiptFile(file);
    if (file) {
      void runOcr(file);
    } else {
      setOcrMessage(null);
    }
  }

  async function uploadReceiptIfNeeded(): Promise<string> {
    if (!receiptFile) return "";
    const body = new FormData();
    body.append("file", receiptFile);
    body.append("supplierName", form.supplierNameEn || form.supplierNameTh || "receipt");
    const res = await fetch("/api/upload", { method: "POST", body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "อัปโหลดไฟล์ใบเสร็จไม่สำเร็จ");
    }
    const data = await res.json();
    return data.webViewLink as string;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const receiptFileLink = await uploadReceiptIfNeeded();

      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amountBeforeVat: Number(form.amountBeforeVat),
          vatAmount: Number(form.vatAmount),
          grandTotal: Number(form.grandTotal),
          receiptFileLink,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "บันทึกรายการไม่สำเร็จ");
      }

      setMessage({ type: "success", text: "บันทึกรายการเรียบร้อย สถานะ: รอตรวจ" });
      setForm(INITIAL_STATE);
      setReceiptFile(null);
      setOcrMessage(null);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" });
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";
  const labelClass = "block text-sm font-medium text-zinc-700";

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <p className="text-xs text-zinc-400">ผู้บันทึก: {recordedByName}</p>

      <div>
        <label className={labelClass}>ประเภทเงิน</label>
        <div className="mt-1 flex gap-2">
          {(["เงินสดย่อย", "เงินทดรองจ่าย"] as FundType[]).map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => set("fundType", option)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-95 ${
                form.fundType === option
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 active:bg-zinc-100"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>ประเภทเอกสาร</label>
          <select
            className={inputClass}
            value={form.documentType}
            onChange={(e) => set("documentType", e.target.value as DocumentType)}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>หมวดหมู่ (ตาม Odoo)</label>
          <input
            className={inputClass}
            value={form.odooCategory}
            onChange={(e) => set("odooCategory", e.target.value)}
            placeholder="เช่น ค่าเดินทาง"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>ชื่อซัพพลายเออร์ (ไทย)</label>
          <input
            className={inputClass}
            value={form.supplierNameTh}
            onChange={(e) => set("supplierNameTh", e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>ชื่อซัพพลายเออร์ (English)</label>
          <input
            className={inputClass}
            value={form.supplierNameEn}
            onChange={(e) => set("supplierNameEn", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>รายละเอียดค่าใช้จ่าย</label>
        <textarea
          className={inputClass}
          rows={2}
          value={form.expenseDetail}
          onChange={(e) => set("expenseDetail", e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>วันที่ในบิล</label>
          <input
            type="date"
            className={inputClass}
            value={form.billDate}
            onChange={(e) => set("billDate", e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>เลขที่เอกสาร</label>
          <input
            className={inputClass}
            value={form.documentNumber}
            onChange={(e) => set("documentNumber", e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>เลขที่ PO (ถ้ามี)</label>
          <input className={inputClass} value={form.poNumber} onChange={(e) => set("poNumber", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>จำนวนเงินก่อน VAT</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.amountBeforeVat}
            onChange={(e) => handleAmountBeforeVatChange(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass}>VAT 7%</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.vatAmount}
            onChange={(e) => set("vatAmount", e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>ยอดรวม (Grand Total)</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={form.grandTotal}
            onChange={(e) => set("grandTotal", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>รูปถ่ายใบเสร็จ</label>
        <p className="mt-1 text-xs text-zinc-500">
          ถ่ายรูปหรือแนบไฟล์ใบเสร็จ ระบบจะอ่านและเติมข้อมูลในฟอร์มให้อัตโนมัติ (ตรวจสอบและแก้ไขได้ก่อนบันทึก)
        </p>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.98] active:bg-emerald-900"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8a2 2 0 0 1 2-2h1.2a2 2 0 0 0 1.66-.9l.6-.9A2 2 0 0 1 11.1 3h1.8a2 2 0 0 1 1.64.87l.6.9a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
              <circle cx="12" cy="13" r="3.6" />
            </svg>
            ถ่ายรูปใบเสร็จ
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-zinc-300 bg-white px-4 py-3.5 text-sm font-semibold text-zinc-700 transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98] active:bg-zinc-100"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M9 15l1.5-2 1.5 1.8L14 12l3 4" />
              <circle cx="9.5" cy="10.5" r="1" />
            </svg>
            แนบไฟล์
          </button>
        </div>

        {/* Rear-camera-first on mobile: accept + capture opens the camera directly. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
        />
        {/* Regular file/photo picker — also supports PDF, no capture attribute. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
        />

        {receiptFile && !ocrLoading && (
          <p className="mt-2 truncate text-xs text-zinc-500">ไฟล์ที่แนบ: {receiptFile.name}</p>
        )}

        {ocrLoading && receiptFile && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="h-10 w-8 flex-shrink-0 rounded border border-zinc-200 bg-white" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-700">{receiptFile.name}</p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-600" />
              </div>
              <p className="mt-1 text-xs text-zinc-500">กำลังอ่านข้อมูลด้วย OCR...</p>
            </div>
          </div>
        )}

        {ocrMessage && (
          <p
            className={`mt-2 rounded-md px-3 py-2 text-xs ${
              ocrMessage.type === "success"
                ? "bg-emerald-50 text-emerald-800"
                : ocrMessage.type === "warning"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {ocrMessage.text}
          </p>
        )}
      </div>

      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-medium text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.98] active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      >
        {submitting ? "กำลังบันทึก..." : "บันทึกรายการ (รอตรวจ)"}
      </button>
    </form>
  );
}
