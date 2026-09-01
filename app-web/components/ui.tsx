import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function PageShell({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10 ${className}`} {...props} />;
}

export function Surface({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-card)] ${className}`} {...props} />;
}

export function SectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">
        {number}
      </span>
      <div>
        <h2 className="text-base font-semibold leading-7 text-[var(--ink)]">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{description}</p>}
      </div>
    </div>
  );
}

export function ActionButton({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const variants = {
    primary: "border-transparent bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]",
    secondary: "border-[var(--line-strong)] bg-white text-[var(--ink)] hover:bg-[var(--surface-subtle)]",
    ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]",
  };
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function NavIcon({ children }: { children: ReactNode }) {
  return <span className="flex h-5 w-5 items-center justify-center" aria-hidden="true">{children}</span>;
}
