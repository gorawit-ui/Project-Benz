"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExpenseRow, ExpenseStatus } from "@/lib/sheets";

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

  const pettyCashTotal = useMemo(
    () => sumGrandTotal((rows ?? []).filter((r) => r.fundType === "เงินสดย่อย")),
    [rows]
  );

  const advanceRows = useMemo(
    () => (rows ?? []).filter((r) => r.fundType === "เงินทดรองจ่าย"),
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
      .filter((r) => (categoryFilter ? r.odooCategory === categoryFilter : true))
      .filter((r) =>
        search
          ? r.supplierNameTh.toLowerCase().includes(search) || r.supplierNameEn.toLowerCase().includes(search)
          : true
      )
      .sort((a, b) => b.billDate.localeCompare(a.billDate));
  }, [rows, categoryFilter, vendorSearch]);

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

  if (error) {
    return (
      <div className="space-y-3">
        {monthSelect}
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="space-y-3">
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
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-400">
          แยกตามหมวดหมู่ (ตาม Odoo) · {selectedMonth || "เดือนนี้"}
        </h2>
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

      {/* Data table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
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
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-zinc-400">
                  ไม่พบรายการ
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100">
                  <td className="px-4 py-3 text-zinc-600">{row.billDate}</td>
                  <td className="px-4 py-3 text-zinc-600">{row.recordedBy}</td>
                  <td className="px-4 py-3 font-medium text-zinc-800">
                    {row.supplierNameTh}
                    {row.supplierNameEn ? ` (${row.supplierNameEn})` : ""}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{row.odooCategory}</td>
                  <td className="px-4 py-3 font-semibold text-zinc-800">{formatBaht(row.grandTotal)}</td>
                  <td className="px-4 py-3 text-zinc-500">{row.fundType}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[row.status]}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.fundType === "เงินทดรองจ่าย" ? (
                      <button
                        type="button"
                        disabled={repaymentBusyId === row.id}
                        onClick={() => handleToggleRepayment(row)}
                        className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
