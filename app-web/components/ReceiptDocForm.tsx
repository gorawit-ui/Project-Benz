"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { numberToThaiBahtText } from "@/lib/thaiBahtText";
import type { ExpenseRow } from "@/lib/sheets";

export default function ReceiptDocForm({ defaultPayeeName }: { defaultPayeeName: string }) {
  const [payeeName, setPayeeName] = useState(defaultPayeeName);
  const [idNumber, setIdNumber] = useState("");
  const [expenseDetail, setExpenseDetail] = useState("");
  const [amountText, setAmountText] = useState("");
  const [idCardImage, setIdCardImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [linkedExpenseId, setLinkedExpenseId] = useState<string | null>(null);

  // รอตรวจ rows this เอกสารรับเงิน can optionally be linked to — see
  // "ผูกกับรายการค่าใช้จ่าย (ถ้ามี)" below. Fetched once on mount; failing to
  // load this list is a convenience miss only, never blocks the form.
  const [pendingRows, setPendingRows] = useState<ExpenseRow[]>([]);
  const [expenseRowId, setExpenseRowId] = useState("");
  // The month tab pendingRows was loaded from — needed so linking back to a
  // row (see /api/receipt-doc's `monthTab` field) writes into the correct
  // per-month sheet tab instead of being silently skipped.
  const [pendingRowsMonth, setPendingRowsMonth] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/expenses")
      .then((res) => (res.ok ? res.json() : { rows: [], month: null }))
      .then((data) => {
        if (cancelled) return;
        const rows = (data.rows ?? []) as ExpenseRow[];
        setPendingRows(rows.filter((row) => row.status === "รอตรวจ"));
        setPendingRowsMonth((data.month as string | undefined) ?? null);
      })
      .catch(() => {
        // listing รอตรวจ rows to link is a convenience only — leave the dropdown empty
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const amountNumber = parseFloat(amountText);
  const bahtText = useMemo(
    () => (Number.isFinite(amountNumber) && amountNumber > 0 ? numberToThaiBahtText(amountNumber) : ""),
    [amountNumber]
  );

  const inputClass =
    "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";
  const labelClass = "block text-sm font-medium text-zinc-700";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDownloadUrl(null);
    setDriveLink(null);
    setLinkedExpenseId(null);
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("payeeName", payeeName);
      formData.append("idNumber", idNumber);
      formData.append("expenseDetail", expenseDetail);
      formData.append("amountNumber", amountText);
      if (idCardImage) formData.append("idCardImage", idCardImage);
      if (expenseRowId) {
        formData.append("expenseRowId", expenseRowId);
        if (pendingRowsMonth) formData.append("monthTab", pendingRowsMonth);
      }

      const res = await fetch("/api/receipt-doc", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "สร้างเอกสารไม่สำเร็จ");
      }

      // The Drive upload + sheet-link step is additive on the server side and
      // never fails the response — its outcome (if any) rides along as
      // headers next to the .docx bytes so the direct-download path below is
      // completely unaffected.
      const uploadedLink = res.headers.get("X-Drive-Web-View-Link");
      const linkedId = res.headers.get("X-Linked-Expense-Id");

      const blob = await res.blob();
      setDownloadUrl(URL.createObjectURL(blob));
      if (uploadedLink) setDriveLink(uploadedLink);
      if (linkedId) setLinkedExpenseId(linkedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div>
        <label className={labelClass}>ชื่อผู้รับเงิน</label>
        <input
          className={inputClass}
          value={payeeName}
          onChange={(e) => setPayeeName(e.target.value)}
          required
        />
      </div>

      <div>
        <label className={labelClass}>เลขประจำตัวประชาชน</label>
        <input
          className={inputClass}
          value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
          placeholder="x-xxxx-xxxxx-xx-x"
          required
        />
      </div>

      <div>
        <label className={labelClass}>ได้รับเงินจากบริษัทเป็นค่า</label>
        <input
          className={inputClass}
          value={expenseDetail}
          onChange={(e) => setExpenseDetail(e.target.value)}
          placeholder="เช่น ซื้ออุปกรณ์ทำความสะอาด ที่ร้าน 7-Eleven"
          required
        />
      </div>

      <div>
        <label className={labelClass}>จำนวนเงิน</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          className={inputClass}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          required
        />
        {bahtText && <p className="mt-1 text-sm text-emerald-700">({bahtText})</p>}
      </div>

      <div>
        <label className={labelClass}>รูปสำเนาบัตรประชาชน</label>

        <div className="mt-1 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.98] active:bg-emerald-900"
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
            ถ่ายรูปบัตร
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98] active:bg-zinc-100"
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
          onChange={(e) => setIdCardImage(e.target.files?.[0] ?? null)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => setIdCardImage(e.target.files?.[0] ?? null)}
        />

        {idCardImage && <p className="mt-2 truncate text-xs text-zinc-500">ไฟล์ที่แนบ: {idCardImage.name}</p>}
      </div>

      <div>
        <label className={labelClass}>ผูกกับรายการค่าใช้จ่าย (ถ้ามี)</label>
        <select className={inputClass} value={expenseRowId} onChange={(e) => setExpenseRowId(e.target.value)}>
          <option value="">ไม่ผูกกับรายการใด</option>
          {pendingRows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.id} — {row.supplierNameTh || row.supplierNameEn || "ไม่ระบุซัพพลายเออร์"} ฿
              {row.grandTotal.toLocaleString("th-TH")} ({row.billDate})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          เมื่อเลือก ระบบจะบันทึกลิงก์เอกสารรับเงินนี้กลับเข้าไปในรายการที่เลือกโดยอัตโนมัติ
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "กำลังสร้างเอกสาร..." : "สร้างเอกสารรับเงิน (.docx)"}
      </button>

      {downloadUrl && (
        <a
          href={downloadUrl}
          download="เอกสารรับเงิน.docx"
          className="block w-full rounded-lg border border-emerald-700 px-4 py-3 text-center font-medium text-emerald-700 hover:bg-emerald-50"
        >
          ดาวน์โหลดเอกสารรับเงิน (.docx)
        </a>
      )}

      {driveLink && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <p>
            อัปโหลดเข้า Drive แล้ว —{" "}
            <a href={driveLink} target="_blank" rel="noopener noreferrer" className="underline">
              เปิดไฟล์ใน Drive
            </a>
          </p>
          {linkedExpenseId && <p className="mt-1">บันทึกลิงก์ในรายการ {linkedExpenseId} แล้ว</p>}
        </div>
      )}
    </form>
  );
}
