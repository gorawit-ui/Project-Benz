"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Type-to-search picker for the Odoo หมวดหมู่ / Acc name fields.
 *
 * Replaces the native <datalist>, which the browser draws itself: its popup
 * can't be styled or width-constrained from CSS, so it sized itself to the
 * longest option (e.g. "[EXP00000000025] ค่าใช้จ่ายในการเดินทาง
 * (ค่าน้ำมัน,ทางด่วน,จอดรถ)") and spilled outside the form card — and it
 * renders differently again in Safari, Firefox and on mobile.
 *
 * Options come in as Odoo's "[CODE] label" strings. The whole string stays
 * the stored value (the code is what Odoo is keyed on), but the list splits
 * it: the Thai label is what a person actually scans, so it leads, and the
 * code sits beside it as a quiet monospace chip. That is what stops the long
 * codes from driving the width.
 *
 * Free text is still allowed — anything typed is kept even if it matches no
 * option, matching the previous <datalist> behaviour.
 */
interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  id?: string;
  className?: string;
}

/** Splits Odoo's "[CODE] label" into its parts; code is null when absent. */
function splitOption(option: string): { code: string | null; label: string } {
  const match = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(option);
  return match ? { code: match[1], label: match[2] } : { code: null, label: option };
}

/**
 * Splits a code like "EXP00000000025" into prefix / padding zeros /
 * significant digits, so the padding can be dimmed and the digits that
 * actually differ emphasised. The full code is still rendered — this is
 * only weighting, not truncation, so it stays checkable against Odoo.
 *
 * This matters for correctness, not just polish: "ค่าธรรมเนียมขอใบอนุญาต"
 * exists twice under EXP00000000007 and SER00000000003, and the code is the
 * ONLY thing telling those two rows apart.
 */
function splitCode(code: string): { prefix: string; padding: string; digits: string } {
  const match = /^([A-Za-z]*)(0*)(\d+)$/.exec(code);
  if (!match) return { prefix: code, padding: "", digits: "" };
  return { prefix: match[1], padding: match[2], digits: match[3] };
}

export default function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  required,
  id,
  className,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not filtering yet
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const generatedId = useId();
  const listId = `${id ?? generatedId}-listbox`;

  // Filter on the code and the label alike, so "531008", "สวัสดิการ" and
  // "EXP25" all find their row. A null query means the field was opened
  // without typing — show everything rather than filtering on the current value.
  const filtered = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  // Close when focus or a click lands outside the field.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Keep the keyboard-highlighted row in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function commit(option: string) {
    onChange(option);
    setQuery(null);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlight(0);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((h) => (filtered.length === 0 ? 0 : (h + step + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault(); // don't submit the form while picking
        commit(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(null);
    }
  }

  const inputClass =
    className ??
    "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={id}
        className={inputClass}
        // While typing show the query; otherwise show the committed value.
        value={query ?? value}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value); // keep free text working
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          // w-full pins the popup to the field's width — the whole point of
          // replacing <datalist>. Long labels wrap instead of widening it.
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto overscroll-contain rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-400">ไม่พบตัวเลือกที่ตรงกัน (พิมพ์เองได้)</li>
          ) : (
            filtered.map((option, i) => {
              const { code, label } = splitOption(option);
              const selected = option === value;
              return (
                <li key={option} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    // onMouseDown, not onClick: the input's blur would
                    // otherwise close the list before the click registers.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(option);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    // flex-wrap + a label floor: in a narrow popup the chip
                    // drops onto its own line instead of squeezing the label
                    // into a one-word-per-line column.
                    className={`flex w-full flex-wrap items-start gap-x-2 gap-y-1 px-3 py-2.5 text-left text-sm ${
                      i === highlight ? "bg-emerald-50" : ""
                    } ${selected ? "font-semibold text-emerald-800" : "text-zinc-700"}`}
                  >
                    <span className="min-w-[9rem] flex-1 break-words">{label}</span>
                    {code &&
                      (() => {
                        const { prefix, padding, digits } = splitCode(code);
                        return (
                          <span className="mt-px shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-zinc-700">
                            {prefix}
                            <span className="text-zinc-400">{padding}</span>
                            <span className="font-bold">{digits}</span>
                          </span>
                        );
                      })()}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
