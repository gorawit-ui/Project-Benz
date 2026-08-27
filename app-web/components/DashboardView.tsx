"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExpenseRow, ExpenseStatus } from "@/lib/sheets";
import ReceiptViewer from "./ReceiptViewer";

// Monthly petty-cash threshold, mirrored from the classification logic used
// elsewhere in the app (see docs). Kept as a local constant rather than an
// import so this page has zero dependency on lib/* files that are being
// touched by a parallel task.
const PETTY_CASH_MONTHLY_LIMIT = 20000;

const STATUS_BADGE: Record<ExpenseStatus, string> = {
  รอตรวจ: "bg-amber-50 text-amber-700",
  ตรวจแล้ว: "bg-blue-50 text-blue-700",
  นับเข้าระบบ: "bg-emerald-50 text-emerald-700",
  ต้องแก้ไข: "bg-red-50 text-red-700",
  ยกเลิก: "bg-zinc-100 text-zinc-500",
};

function formatBaht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " บาท";
}

function formatCompactBaht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function sumGrandTotal(rows: ExpenseRow[]): number {
  return rows.reduce((acc, r) => acc + r.grandTotal, 0);
}

export default function DashboardView() {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [vendorSearch, setVendorSearch] = useState<string>("");
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [repaymentBusyId, setRepaymentBusyId] = useState<string | null>(null);
  const [repaymentError, setRepaymentError] = useState<string | null>(null);
  // Default view excludes ยกเลิก (day-to-day list); switching this to
  // "ยกเลิก" is the "log" of cancelled entries the product owner asked for —
  // a dedicated place to look them up rather than mixed into the normal list.
  const [statusFilter, setStatusFilter] = useState<"" | "ยกเลิก">("");
  // The row currently shown in the cancel modal (null = closed) — a modal
  // rather than an inline row, so it doesn't force the already-wide table
  // even wider on a phone.
  const [cancelModalRow, setCancelModalRow] = useState<ExpenseRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Floating confirmation that auto-dismisses. */
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

  async function loadRows(month: string) {
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
      setFetchedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    }
  }

  useEffect(() => {
    // Initial load: fetch the month list, default selection to the first
    // (most-recent) entry, then load that month's rows. If the month list
    // comes back empty, fall back to fetching with no `month` param (server
    // defaults to the current month).
    (async () => {
      setError(null);
      try {
        const res = await fetch("/api/expenses/months");
        if (res.ok) {
          const data = await res.json();
          const list = (data.months ?? []) as string[];
          setMonths(list);
          if (list.length > 0) {
            setSelectedMonth(list[0]);
            await loadRows(list[0]);
            return;
          }
        }
      } catch {
        // fall through to unscoped load below
      }
      await loadRows("");
    })();
  }, []);

  async function handleMonthChange(month: string) {
    setSelectedMonth(month);
    setRows(null);
    await loadRows(month);
  }

  async function handleToggleRepayment(row: ExpenseRow) {
    const nextStatus = row.repaymentStatus === "จ่ายคืนแล้ว" ? "ยังไม่จ่ายคืน" : "จ่ายคืนแล้ว";
    setRepaymentError(null);
    setRepaymentBusyId(row.id);
    // Optimistic update so the ค้างจ่ายคืน total reacts immediately.
    setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, repaymentStatus: nextStatus } : r)));
    try {
      const res = await fetch(`/api/expenses/${encodeURIComponent(row.id)}/repayment-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repaymentStatus: nextStatus, monthTab: selectedMonth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "อัปเดตสถานะจ่ายคืนไม่สำเร็จ");
      }
    } catch (err) {
      // Revert on failure.
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, repaymentStatus: row.repaymentStatus } : r)));
      setRepaymentError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setRepaymentBusyId(null);
    }
  }

  function openCancelModal(row: ExpenseRow) {
    setCancelError(null);
    setCancelReason("");
    setCancelModalRow(row);
  }

  function closeCancelModal() {
    setCancelModalRow(null);
    setCancelReason("");
  }

  /**
   * Cancels a row (sets status ยกเลิก + the reason in the same "หมายเหตุ"
   * column every other status change uses) rather than deleting it — it
   * stays in the sheet as a permanent record ("Log"), just excluded from
   * every total (petty-cash used, category breakdown, advance/repayment)
   * from here on. A corrected re-entry is a fresh submission through the
   * normal capture flow, which naturally gets its own next sequential id —
   * this row's old id is never reused.
   */
  async function confirmCancel(row: ExpenseRow) {
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelError("กรุณาระบุเหตุผลที่ยกเลิก");
      return;
    }
    setCancelError(null);
    setCancelBusyId(row.id);
    const previousStatus = row.status;
    // Optimistic update so totals react immediately.
    setRows((prev) =>
      (prev ?? []).map((r) => (r.id === row.id ? { ...r, status: "ยกเลิก", note: reason } : r))
    );
    try {
      const res = await fetch(`/api/expenses/${encodeURIComponent(row.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ยกเลิก", note: reason, monthTab: selectedMonth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "ยกเลิกรายการไม่สำเร็จ");
      }
      closeCancelModal();
      showToast("ยกเลิกสำเร็จ!");
    } catch (err) {
      // Revert on failure.
      setRows((prev) =>
        (prev ?? []).map((r) => (r.id === row.id ? { ...r, status: previousStatus, note: row.note } : r))
      );
      setCancelError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setCancelBusyId(null);
    }
  }

  // Cancelled rows never count toward any total below — cancelling returns
  // the amount to the petty-cash wallet and drops it out of the category
  // breakdown and the advance/repayment tracking, per the product owner.
  const pettyCashTotal = useMemo(
    () => sumGrandTotal((rows ?? []).filter((r) => r.fundType === "เงินสดย่อย" && r.status !== "ยกเลิก")),
    [rows]
  );

  const advanceRows = useMemo(
    () => (rows ?? []).filter((r) => r.fundType === "เงินทดรองจ่าย" && r.status !== "ยกเลิก"),
    [rows]
  );
  const unpaidAdvanceRows = useMemo(
    () => advanceRows.filter((r) => r.repaymentStatus !== "จ่ายคืนแล้ว"),
    [advanceRows]
  );
  const advanceTotal = useMemo(() => sumGrandTotal(unpaidAdvanceRows), [unpaidAdvanceRows]);
  const advanceByPerson = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of unpaidAdvanceRows) {
      totals.set(r.recordedBy, (totals.get(r.recordedBy) ?? 0) + r.grandTotal);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [unpaidAdvanceRows]);

  // Category totals — Odoo budgets per category aren't wired up yet, so this
  // is a simple "spent so far" total per category, not spent-vs-budget.
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows ?? []) {
      if (r.status === "ยกเลิก") continue;
      const key = r.odooCategory || "(ไม่ระบุหมวดหมู่)";
      totals.set(key, (totals.get(key) ?? 0) + r.grandTotal);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const maxCategoryTotal = categoryTotals.length > 0 ? categoryTotals[0][1] : 0;

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) {
      if (r.odooCategory) set.add(r.odooCategory);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const search = vendorSearch.trim().toLowerCase();
    return (rows ?? [])
      // Default view ("") is the everyday list and hides ยกเลิก entries;
      // picking "ยกเลิก" from the status filter is the dedicated "log" view
      // for looking them back up.
      .filter((r) => (statusFilter ? r.status === statusFilter : r.status !== "ยกเลิก"))
      .filter((r) => (categoryFilter ? r.odooCategory === categoryFilter : true))
      .filter((r) =>
        search
          ? r.supplierNameTh.toLowerCase().includes(search) || r.supplierNameEn.toLowerCase().includes(search)
          : true
      )
      .sort((a, b) => b.billDate.localeCompare(a.billDate));
  }, [rows, statusFilter, categoryFilter, vendorSearch]);

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

  // Floating, auto-dismissing confirmation — rendered in every branch below.
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
        <p className="text-sm text-zinc-500">กำลังโหลด...</p>
      </div>
    );
  }

  const pettyCashPercent = PETTY_CASH_MONTHLY_LIMIT > 0 ? (pettyCashTotal / PETTY_CASH_MONTHLY_LIMIT) * 100 : 0;
  const pettyCashRemaining = PETTY_CASH_MONTHLY_LIMIT - pettyCashTotal;
  const pettyCashTone =
    pettyCashPercent >= 100
      ? { bar: "bg-red-600", text: "text-red-700", label: "ใช้เกินวงเงินแล้ว" }
      : pettyCashPercent >= 80
        ? { bar: "bg-amber-500", text: "text-amber-700", label: "ใกล้เต็มวงเงิน" }
        : { bar: "bg-emerald-600", text: "text-emerald-700", label: "ปกติ" };

  return (
    <div className="space-y-8">
      {toastElement}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {monthSelect}
        <p className="text-xs text-zinc-400">
          อัปเดตล่าสุด: {fetchedAt ? fetchedAt.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-"}
          {selectedMonth ? ` · ข้อมูลเดือน ${selectedMonth}` : ""}
        </p>
      </div>

      {/* Fund summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* เงินสดย่อย */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-zinc-900">เงินสดย่อย</span>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${pettyCashTone.text} bg-zinc-50`}>
              {pettyCashTone.label}
            </span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className={`h-full ${pettyCashTone.bar}`}
              style={{ width: `${Math.min(pettyCashPercent, 100)}%` }}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xs text-zinc-500">
              วงเงินตั้งต้น {formatCompactBaht(PETTY_CASH_MONTHLY_LIMIT)} · ใช้ไป {formatCompactBaht(pettyCashTotal)}
            </span>
            <span className={`text-lg font-bold ${pettyCashTone.text}`}>
              คงเหลือ {formatCompactBaht(pettyCashRemaining)}
            </span>
          </div>
        </div>

        {/* เงินทดรองจ่าย */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-zinc-900">เงินทดรองจ่าย</span>
            <span className="text-xs font-medium text-zinc-400">{selectedMonth || "เดือนนี้"}</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900">{formatCompactBaht(advanceTotal)}</span>
            <span className="text-xs text-zinc-500">ค้างจ่ายคืน {advanceByPerson.length} คน</span>
          </div>
          {advanceByPerson.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {advanceByPerson.map(([person, total]) => (
                <div key={person} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">{person}</span>
                  <span className="font-semibold text-zinc-800">{formatCompactBaht(total)}</span>
                </div>
              ))}
            </div>
          )}
          {repaymentError && <p className="mt-3 text-xs text-red-600">{repaymentError}</p>}
          {unpaidAdvanceRows.length > 0 ? (
            <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto border-t border-zinc-100 pt-3">
              {unpaidAdvanceRows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                  <label className="flex min-w-0 items-center gap-2 text-zinc-600">
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={repaymentBusyId === row.id}
                      onChange={() => handleToggleRepayment(row)}
                      className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
                    />
                    <span className="truncate">
                      {row.recordedBy} · {row.billDate}
                    </span>
                  </label>
                  <span className="shrink-0 font-medium text-zinc-800">{formatCompactBaht(row.grandTotal)}</span>
                </li>
              ))}
            </ul>
          ) : (
            advanceRows.length > 0 && (
              <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-400">
                จ่ายคืนครบทุกรายการแล้ว
              </p>
            )
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-400">แยกตามหมวดหมู่ (ตาม Odoo)</h2>
          {monthSelect}
        </div>
        {categoryTotals.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">ไม่มีรายการในเดือนนี้</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categoryTotals.map(([category, total]) => (
              <div key={category} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <span className="text-sm font-semibold text-zinc-700">{category}</span>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full bg-emerald-600"
                    style={{ width: `${maxCategoryTotal > 0 ? (total / maxCategoryTotal) * 100 : 0}%` }}
                  />
                </div>
                <span className="mt-2 block text-base font-bold text-emerald-700">{formatCompactBaht(total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | "ยกเลิก")}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">รายการทั้งหมด</option>
          <option value="ยกเลิก">รายการที่ยกเลิก (Log)</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">หมวดหมู่: ทั้งหมด</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="ค้นหาร้านค้า..."
          value={vendorSearch}
          onChange={(e) => setVendorSearch(e.target.value)}
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm sm:max-w-xs"
        />
      </div>

      {/* Data — card list on mobile, table from sm: up. Same filteredRows,
          two renderings so small screens never get the 720px-wide table. */}
      {filteredRows.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-400 shadow-sm">
          ไม่พบรายการ
        </p>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="space-y-3 sm:hidden">
            {filteredRows.map((row) => {
              const cancelled = row.status === "ยกเลิก";
              return (
                <div
                  key={row.id}
                  className={`rounded-xl border p-4 shadow-sm ${cancelled ? "border-zinc-200 bg-zinc-50" : "border-zinc-200 bg-white"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate font-medium ${cancelled ? "text-zinc-400" : "text-zinc-800"}`}>
                        {row.supplierNameTh}
                        {row.supplierNameEn ? ` (${row.supplierNameEn})` : ""}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {row.billDate} · {row.recordedBy}
                      </p>
                    </div>
                    <span
                      className={`inline-block shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </div>

                  {cancelled && row.note && (
                    <p className="mt-2 text-xs text-zinc-400">เหตุผลที่ยกเลิก: {row.note}</p>
                  )}

                  {row.receiptFileLink && (
                    <div className="mt-3">
                      <ReceiptViewer link={row.receiptFileLink} label="ใบเสร็จ" />
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className={cancelled ? "text-zinc-400" : "text-zinc-500"}>
                      {row.odooCategory} · {row.fundType}
                    </span>
                    <span className={`font-semibold ${cancelled ? "text-zinc-400" : "text-zinc-800"}`}>
                      {formatBaht(row.grandTotal)}
                    </span>
                  </div>

                  {!cancelled && (
                    <div className="mt-3 flex gap-2 border-t border-zinc-100 pt-3">
                      {row.fundType === "เงินทดรองจ่าย" && (
                        <button
                          type="button"
                          disabled={repaymentBusyId === row.id}
                          onClick={() => handleToggleRepayment(row)}
                          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50 ${
                            row.repaymentStatus === "จ่ายคืนแล้ว"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {row.repaymentStatus === "จ่ายคืนแล้ว" ? "จ่ายคืนแล้ว" : "ยังไม่จ่ายคืน"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openCancelModal(row)}
                        className="flex-1 rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-600"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Table, sm: and up */}
          <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm sm:block">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-bold text-zinc-400">
                  <th className="px-4 py-3">วันที่</th>
                  <th className="px-4 py-3">ผู้บันทึก</th>
                  <th className="px-4 py-3">ร้านค้า</th>
                  <th className="px-4 py-3">หมวดหมู่</th>
                  <th className="px-4 py-3">ยอดเงิน</th>
                  <th className="px-4 py-3">ประเภทเงิน</th>
                  <th className="px-4 py-3">สถานะ</th>
                  <th className="px-4 py-3">จ่ายคืน</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const cancelled = row.status === "ยกเลิก";
                  return (
                    <tr key={row.id} className={`border-t border-zinc-100 ${cancelled ? "bg-zinc-50" : ""}`}>
                      <td className={`px-4 py-3 ${cancelled ? "text-zinc-400" : "text-zinc-600"}`}>{row.billDate}</td>
                      <td className={`px-4 py-3 ${cancelled ? "text-zinc-400" : "text-zinc-600"}`}>{row.recordedBy}</td>
                      <td className={`px-4 py-3 font-medium ${cancelled ? "text-zinc-400" : "text-zinc-800"}`}>
                        {row.supplierNameTh}
                        {row.supplierNameEn ? ` (${row.supplierNameEn})` : ""}
                        {cancelled && row.note && (
                          <p className="mt-0.5 text-xs font-normal text-zinc-400">เหตุผลที่ยกเลิก: {row.note}</p>
                        )}
                      </td>
                      <td className={`px-4 py-3 ${cancelled ? "text-zinc-400" : "text-zinc-600"}`}>{row.odooCategory}</td>
                      <td className={`px-4 py-3 font-semibold ${cancelled ? "text-zinc-400" : "text-zinc-800"}`}>
                        {formatBaht(row.grandTotal)}
                      </td>
                      <td className={`px-4 py-3 ${cancelled ? "text-zinc-400" : "text-zinc-500"}`}>{row.fundType}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[row.status]}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.fundType === "เงินทดรองจ่าย" && !cancelled ? (
                          <button
                            type="button"
                            disabled={repaymentBusyId === row.id}
                            onClick={() => handleToggleRepayment(row)}
                            className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                              row.repaymentStatus === "จ่ายคืนแล้ว"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-zinc-100 text-zinc-500"
                            }`}
                          >
                            {row.repaymentStatus === "จ่ายคืนแล้ว" ? "จ่ายคืนแล้ว" : "ยังไม่จ่ายคืน"}
                          </button>
                        ) : (
                          <span className="text-zinc-300">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {!cancelled && (
                          <button
                            type="button"
                            onClick={() => openCancelModal(row)}
                            className="text-xs font-medium text-red-600 underline-offset-2 hover:underline"
                          >
                            ยกเลิก
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Cancel-reason modal — pops up instead of an inline row so the flow
          stays usable on a phone. */}
      {cancelModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-sm font-bold text-zinc-900">ยกเลิกรายการ</h3>
            <p className="mt-1 text-xs text-zinc-500">
              {cancelModalRow.supplierNameTh} · {formatBaht(cancelModalRow.grandTotal)}
            </p>
            <label className="mt-4 block text-xs font-medium text-zinc-600">เหตุผลที่ยกเลิก (จำเป็น)</label>
            <textarea
              autoFocus
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="เช่น กรอกยอดผิด, ซ้ำกับรายการอื่น..."
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            {cancelError && <p className="mt-2 text-xs text-red-700">{cancelError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={cancelBusyId === cancelModalRow.id}
                onClick={closeCancelModal}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-100"
              >
                ปิด
              </button>
              <button
                type="button"
                disabled={cancelBusyId === cancelModalRow.id}
                onClick={() => void confirmCancel(cancelModalRow)}
                className="flex-1 rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelBusyId === cancelModalRow.id ? "กำลังยกเลิก..." : "ยืนยันยกเลิกรายการ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
