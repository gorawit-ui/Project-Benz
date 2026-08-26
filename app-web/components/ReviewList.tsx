"use client";

import { useEffect, useState } from "react";
import type { ExpenseRow } from "@/lib/sheets";

export default function ReviewList() {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/expenses");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "โหลดข้อมูลไม่สำเร็จ");
      }
      const data = await res.json();
      setRows(data.rows as ExpenseRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    }
  }

  useEffect(() => {
    // Initial data fetch on mount — the standard "load once" pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function setStatus(id: string, status: "ตรวจแล้ว" | "ต้องแก้ไข") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/expenses/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: noteDrafts[id] ?? "" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "อัปเดตสถานะไม่สำเร็จ");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }

  if (rows === null) {
    return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;
  }

  const pending = rows.filter((r) => r.status === "รอตรวจ");

  if (pending.length === 0) {
    return <p className="text-sm text-zinc-500">ไม่มีรายการรอตรวจ</p>;
  }

  return (
    <div className="space-y-4">
      {pending.map((row) => (
        <div key={row.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium text-zinc-900">
                {row.supplierNameTh}
                {row.supplierNameEn ? ` (${row.supplierNameEn})` : ""}
              </p>
              <p className="text-sm text-zinc-500">{row.expenseDetail}</p>
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              {row.status}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-zinc-400">รหัสรายการ</dt>
              <dd className="text-zinc-700">{row.id}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">ประเภทเงิน</dt>
              <dd className="text-zinc-700">{row.fundType}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">วันที่ในบิล</dt>
              <dd className="text-zinc-700">{row.billDate}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">ยอดรวม</dt>
              <dd className="text-zinc-700">{row.grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</dd>
            </div>
            <div>
              <dt className="text-zinc-400">ผู้บันทึก</dt>
              <dd className="text-zinc-700">{row.recordedBy}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">เลขที่เอกสาร</dt>
              <dd className="text-zinc-700">{row.documentNumber}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">หมวดหมู่ (ตาม Odoo)</dt>
              <dd className="text-zinc-700">{row.odooCategory}</dd>
            </div>
            {row.receiptFileLink && (
              <div>
                <dt className="text-zinc-400">ไฟล์ใบเสร็จ</dt>
                <dd>
                  <a
                    href={row.receiptFileLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 underline"
                  >
                    เปิดไฟล์
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="หมายเหตุ (ถ้ามี)"
              className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
              value={noteDrafts[row.id] ?? ""}
              onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
            />
            <button
              disabled={busyId === row.id}
              onClick={() => setStatus(row.id, "ตรวจแล้ว")}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              ตรวจแล้ว
            </button>
            <button
              disabled={busyId === row.id}
              onClick={() => setStatus(row.id, "ต้องแก้ไข")}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              ต้องแก้ไข
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
