import React from "react";
import { LayoutGrid, List, Search, X, Check, Trash2 } from "lucide-react";

/**
 * Panel header: title, search, compact toggle, collapse all, apply mode, clear, apply, close.
 */
export function Header({
  selectedCount,
  searchQuery,
  onSearchChange,
  compact,
  onCompactChange,
  allCollapsed,
  onCollapseAllToggle,
  applyMode,
  onApplyModeChange,
  onClear,
  onApply,
  onClose,
}) {
  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-background px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-bold text-foreground">
          <LayoutGrid className="h-5 w-5 text-accent" aria-hidden />
          Style Grid
        </span>
        <span className="rounded-full bg-background-secondary px-2.5 py-1 text-sm text-muted">
          {selectedCount} selected
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search styles... (e.g. water soft, @THEME, -ocean)"
            className="w-full rounded-md border border-border bg-background-secondary py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            aria-label="Search styles"
          />
        </div>
        <button
          type="button"
          onClick={onCompactChange}
          className={
            "flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-sm transition-colors " +
            (compact
              ? "border-accent bg-accent/20 text-accent"
              : "border-border text-muted hover:bg-background-secondary hover:text-foreground")
          }
          title={compact ? "Switch to full view" : "Compact view (name only)"}
          aria-pressed={compact}
        >
          {compact ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          <span className="hidden sm:inline">{compact ? "Full" : "Compact"}</span>
        </button>
        <button
          type="button"
          onClick={onCollapseAllToggle}
          className="rounded-md border border-border px-2.5 py-2 text-sm text-muted transition-colors hover:bg-background-secondary hover:text-foreground"
          title={allCollapsed ? "Expand all" : "Collapse all"}
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Apply:</span>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => onApplyModeChange("prompt")}
            className={
              "px-3 py-1.5 text-xs " +
              (applyMode === "prompt"
                ? "bg-accent text-white"
                : "bg-background-secondary text-muted hover:text-foreground")
            }
          >
            Insert into prompt
          </button>
          <button
            type="button"
            onClick={() => onApplyModeChange("silent")}
            className={
              "border-l border-border px-3 py-1.5 text-xs " +
              (applyMode === "silent"
                ? "bg-accent text-white"
                : "bg-background-secondary text-muted hover:text-foreground")
            }
          >
            At generation
          </button>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted hover:bg-background-secondary hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </button>
        <button
          type="button"
          onClick={onApply}
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Check className="h-3.5 w-3.5" /> Apply
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex items-center justify-center rounded-md p-1.5 text-muted hover:bg-background-secondary hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
