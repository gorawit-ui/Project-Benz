"use client";

import { useState, type FormEvent } from "react";
import type { DocumentType, FundType } from "@/lib/sheets";

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

export default function ExpenseForm({ recordedByName }: { recordedByName: string }) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
        <input
          type="file"
          accept="image/*,application/pdf"
          className="mt-1 block w-full text-sm text-zinc-600"
          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
        />
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
