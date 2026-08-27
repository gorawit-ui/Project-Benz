"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpenseRow } from "@/lib/sheets";
import ReceiptViewer from "./ReceiptViewer";

export default function ReviewList() {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Floating confirmation that auto-dismisses — reset the timer on each call so two approvals in quick succession don't cut the toast short. */
  function showToast(message: string) {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(message);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  async function load(month: string) {
    setError(null);
    try {
      const url = month ? `/api/expenses?month=${encodeURIComponent(month)}` : "/api/expenses";
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "โหลดข้อมูลไม่สำเร็จ");
      }
      const data = await res.json();
      setRows(data.rows as ExpenseRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "อุ๊ปส์ มีบางอย่างไม่เรียบร้อย 😅 ลองใหม่อีกทีนะ");
    }
  }

  useEffect(() => {
    // Initial load: fetch the month list, default selection to the first
    // (most-recent) entry, then load that month's rows. If the month list
    // comes back empty, fall back to fetching with no `month` param (server
    // defaults to the current month).
    (async () => {
      try {
        const res = await fetch("/api/expenses/months");
        if (res.ok) {
          const data = await res.json();
          const list = (data.months ?? []) as string[];
          setMonths(list);
          if (list.length > 0) {
            setSelectedMonth(list[0]);
            await load(list[0]);
            return;
          }
        }
      } catch {
        // fall through to unscoped load below
      }
      await load("");
    })();
  }, []);

  async function handleMonthChange(month: string) {
    setSelectedMonth(month);
    setRows(null);
    setSelectedIds(new Set());
    await load(month);
  }

  /** Does the actual status-update call for one row — no reload, callers decide when to reload (so a bulk action doesn't refetch once per row). */
  async function updateOne(id: string, status: "ตรวจแล้ว" | "ต้องแก้ไข"): Promise<boolean> {
    const res = await fetch(`/api/expenses/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note: noteDrafts[id] ?? "", monthTab: selectedMonth }),
    });
    return res.ok;
  }

  async function setStatus(id: string, status: "ตรวจแล้ว" | "ต้องแก้ไข") {
    setBusyId(id);
    try {
      const ok = await updateOne(id, status);
      if (!ok) throw new Error("อัปเดตสถานะไม่สำเร็จ");
      if (status === "ตรวจแล้ว") showToast("อนุมัติเรียบร้อย! 🎉");
      await load(selectedMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "อุ๊ปส์ มีบางอย่างไม่เรียบร้อย 😅 ลองใหม่อีกทีนะ");
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }

  /** Approves every selected row in parallel — one reload at the end, not one per row. */
  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      const results = await Promise.all(ids.map((id) => updateOne(id, "ตรวจแล้ว")));
      const failedCount = results.filter((ok) => !ok).length;
      if (failedCount > 0) {
        setError(`อนุมัติไม่สำเร็จ ${failedCount} จาก ${ids.length} รายการ — ลองใหม่อีกครั้งสำหรับรายการที่เหลือ`);
      }
      if (failedCount < ids.length) {
        showToast(`อนุมัติเรียบร้อย ${ids.length - failedCount} รายการ! 🎉`);
      }
      setSelectedIds(new Set());
      await load(selectedMonth);
    } finally {
      setBulkBusy(false);
    }
  }

  const monthSelect = months.length > 0 && (
    <select
      value={selectedMonth}
      onChange={(e) => handleMonthChange(e.target.value)}
      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );

  // Floating, auto-dismissing confirmation — rendered in every branch below
  // so it stays visible across the reload that follows a successful
  // approve (including the "no pending left" branch the list lands on once
  // the last row is approved).
  const toastElement = toast && (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {toast}
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="space-y-3">
        {toastElement}
        {monthSelect}
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="space-y-3">
        {toastElement}
        {monthSelect}
        <p className="text-sm text-zinc-500">กำลังโหลดข้อมูล รอสักครู่นะ...</p>
      </div>
    );
  }

  const pending = rows.filter((r) => r.status === "รอตรวจ");

  if (pending.length === 0) {
    return (
      <div className="space-y-3">
        {toastElement}
        {monthSelect}
        {/* Nothing pending is good news — the old blank-looking line read
            like an error rather than "you're done". */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-10 text-center">
          <p className="text-3xl">🎉</p>
          <p className="mt-2 text-sm font-semibold text-emerald-900">ตรวจครบทุกรายการแล้ว!</p>
          <p className="mt-1 text-xs text-emerald-700">ไม่มีอะไรค้างรอตรวจเลย พักได้เลยนะ</p>
        </div>
      </div>
    );
  }

  const pendingIds = pending.map((r) => r.id);
  const allSelected = selectedIds.size > 0 && selectedIds.size === pendingIds.length;

  return (
    <div className="space-y-4">
      {toastElement}
      {monthSelect}

      {/* Bulk-approve bar — stacks (checkbox row, then a full-width button)
          below the sm breakpoint since both together don't comfortably fit
          one row on a phone; sits side-by-side from sm: up. Checkbox/button
          padding extends past their visual box (negative-margin trick) for
          a bigger, easier-to-hit tap area on mobile. */}
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <label className="-m-2 flex cursor-pointer items-center gap-2 p-2 text-sm text-zinc-600 active:opacity-70">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => toggleSelectAll(pendingIds)}
            className="h-5 w-5 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
          />
          {selectedIds.size > 0 ? `เลือกแล้ว ${selectedIds.size}/${pendingIds.length}` : `เลือกทั้งหมด (${pendingIds.length} รายการ)`}
        </label>
        <button
          type="button"
          disabled={selectedIds.size === 0 || bulkBusy}
          onClick={() => void bulkApprove()}
          className="w-full rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-emerald-800 active:scale-95 active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {bulkBusy ? "กำลังอนุมัติ..." : `อนุมัติที่เลือก (${selectedIds.size})`}
        </button>
      </div>

      {pending.map((row) => (
        <div key={row.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <label className="-m-2 flex flex-shrink-0 cursor-pointer items-start p-2 active:opacity-70">
                <input
                  type="checkbox"
                  checked={selectedIds.has(row.id)}
                  onChange={() => toggleSelected(row.id)}
                  aria-label={`เลือกรายการของ ${row.supplierNameTh || row.id}`}
                  className="h-5 w-5 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                />
              </label>
              <div className="min-w-0">
                <p className="font-medium text-zinc-900">
                  {row.supplierNameTh}
                  {row.supplierNameEn ? ` (${row.supplierNameEn})` : ""}
                </p>
                <p className="text-sm text-zinc-500">{row.expenseDetail}</p>
              </div>
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
          </dl>

          {/* The receipt itself gets its own strip rather than a cell in the
              grid above: it's the one thing the reviewer actually has to look
              at before approving, and at 56px the thumbnail is big enough to
              recognise the bill without opening anything. */}
          {row.receiptFileLink && (
            <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-2.5">
              <ReceiptViewer link={row.receiptFileLink} label="ใบเสร็จ" />
            </div>
          )}

          {/* Note field full-width above, both action buttons split evenly
              below — a growing input plus two buttons all on one row was
              cramped enough on a phone to visibly cut the second button
              off-screen instead of wrapping cleanly. */}
          <div className="mt-4 space-y-2">
            <input
              type="text"
              placeholder="หมายเหตุ (ถ้ามี)"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              value={noteDrafts[row.id] ?? ""}
              onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
            />
            <div className="flex gap-2">
              <button
                disabled={busyId === row.id}
                onClick={() => setStatus(row.id, "ตรวจแล้ว")}
                className="flex-1 rounded-md bg-emerald-700 px-3 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-emerald-800 active:scale-[0.98] active:bg-emerald-900 disabled:opacity-60"
              >
                ตรวจแล้ว
              </button>
              <button
                disabled={busyId === row.id}
                onClick={() => setStatus(row.id, "ต้องแก้ไข")}
                className="flex-1 rounded-md border border-red-300 px-3 py-2.5 text-sm font-medium text-red-700 transition-all duration-150 hover:bg-red-50 active:scale-[0.98] active:bg-red-100 disabled:opacity-60"
              >
                ต้องแก้ไข
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
