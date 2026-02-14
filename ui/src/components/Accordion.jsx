import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Collapsible section (accordion): header toggles open/closed, content below.
 * shadcn-like: border, rounded, minimal.
 */
export function Accordion({
  id,
  title,
  count,
  color = "#6b7280",
  isOpen,
  onToggle,
  children,
  className = "",
}) {
  return (
    <section
      id={id}
      className={"rounded-lg border border-border bg-background-secondary " + className}
      data-category={title}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-t-lg border-b border-border px-3 py-2 text-left transition-colors hover:bg-background"
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        )}
        <span
          className="rounded px-2 py-0.5 text-xs font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {title}
        </span>
        <span className="text-sm text-muted">({count})</span>
      </button>
      {isOpen && <div className="p-2">{children}</div>}
    </section>
  );
}
