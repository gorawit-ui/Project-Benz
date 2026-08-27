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

/**
 * An option may be a bare string — in which case an Odoo-style "[CODE] label"
 * is split automatically — or an explicit shape, for lists whose secondary
 * text isn't a bracketed code (saved payees show a national ID beside the
 * name, for instance).
 */
export interface ComboBoxOption {
  /** What gets stored when this row is picked. */
  value: string;
  /** Main text; defaults to the value. */
  label?: string;
  /** Quiet text shown in the chip beside the label. */
  meta?: string;
}

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<string | ComboBoxOption>;
  placeholder?: string;
  required?: boolean;
  id?: string;
  className?: string;
  /**
   * How the secondary text relates to the label, which decides how it's laid
   * out:
   *  - "chip" (default) — meta is an IDENTIFIER for the label, like an Odoo
   *    code. Sits beside it as a tag.
   *  - "stacked" — meta is a DETAIL ABOUT the label, like a person's national
   *    ID. Sits on its own line beneath, the way a contact list reads.
   * Getting this backwards is what makes a 13-digit number beside a name
   * hard to read: it's a subtitle, not a tag.
   */
  optionLayout?: "chip" | "stacked";
}

/**
 * Normalises an option into value / label / meta. A bare string is parsed as
 * Odoo's "[CODE] label" form when it looks like one, so existing callers keep
 * working unchanged.
 */
function normaliseOption(option: string | ComboBoxOption): Required<ComboBoxOption> {
  if (typeof option !== "string") {
    return { value: option.value, label: option.label ?? option.value, meta: option.meta ?? "" };
  }
  const match = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(option);
  return match
    ? { value: option, label: match[2], meta: match[1] }
    : { value: option, label: option, meta: "" };
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
  // Only weight codes with genuine padding (EXP00000000025). A plain number
  // like a national ID has no padding to dim, so it renders as-is.
  const match = /^([A-Za-z]+)(0+)(\d+)$/.exec(code);
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
  optionLayout = "chip",
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
  const normalised = useMemo(() => options.map(normaliseOption), [options]);

  const filtered = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return normalised;
    // Match label and meta alike, so "531008", "สวัสดิการ" and a national ID
    // all find their row.
    return normalised.filter(
      (o) => o.label.toLowerCase().includes(q) || o.meta.toLowerCase().includes(q)
    );
  }, [normalised, query]);

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
        commit(filtered[highlight].value);
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
        // pr-9 keeps typed text clear of the caret sitting in the field.
        className={`${inputClass} pr-9`}
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

      {/* Without this the field reads as a plain text box and nothing hints
          that there are saved options behind it. */}
      <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-zinc-400">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

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
              const { value: optionValue, label, meta } = option;
              const selected = optionValue === value;
              return (
                <li key={optionValue} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    // onMouseDown, not onClick: the input's blur would
                    // otherwise close the list before the click registers.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(optionValue);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    // chip: flex-wrap + a label floor so a narrow popup drops
                    // the tag to its own line rather than squeezing the label
                    // into a one-word-per-line column.
                    // stacked: a plain block, label over detail.
                    className={`w-full px-3 py-2.5 text-left text-sm ${
                      optionLayout === "chip" ? "flex flex-wrap items-start gap-x-2 gap-y-1" : "block"
                    } ${i === highlight ? "bg-emerald-50" : ""} ${
                      selected ? "font-semibold text-emerald-800" : "text-zinc-700"
                    }`}
                  >
                    <span
                      className={
                        optionLayout === "chip" ? "min-w-[9rem] flex-1 break-words" : "block break-words"
                      }
                    >
                      {label}
                    </span>
                    {meta && optionLayout === "stacked" && (
                      <span className="mt-0.5 block font-mono text-xs tracking-wide text-zinc-500">
                        {meta}
                      </span>
                    )}
                    {meta &&
                      optionLayout === "chip" &&
                      (() => {
                        const { prefix, padding, digits } = splitCode(meta);
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
