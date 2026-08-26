"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { numberToThaiBahtText } from "@/lib/thaiBahtText";
import type { ExpenseRow } from "@/lib/sheets";

export default function ReceiptDocForm({ defaultPayeeName }: { defaultPayeeName: string }) {
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/expenses")
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data) => {
        if (cancelled) return;
        const rows = (data.rows ?? []) as ExpenseRow[];
        setPendingRows(rows.filter((row) => row.status === "รอตรวจ"));
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
      formData.append("payeeName", defaultPayeeName);
      formData.append("idNumber", idNumber);
      formData.append("expenseDetail", expenseDetail);
      formData.append("amountNumber", amountText);
      if (idCardImage) formData.append("idCardImage", idCardImage);
      if (expenseRowId) formData.append("expenseRowId", expenseRowId);

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
        <input className={`${inputClass} bg-zinc-100`} value={defaultPayeeName} readOnly />
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
        <input
          type="file"
          accept="image/png,image/jpeg"
          className="mt-1 block w-full text-sm text-zinc-600"
          onChange={(e) => setIdCardImage(e.target.files?.[0] ?? null)}
        />
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
