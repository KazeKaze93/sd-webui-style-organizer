import React from "react";
import { ChevronRight, Anchor } from "lucide-react";

/**
 * Fixed-width sticky sidebar with category anchor links and Back to Top.
 * shadcn-like: minimal, border, rounded.
 */
export function Sidebar({ categories, activeId, onScrollTo, className = "" }) {
  const handleBackToTop = () => {
    const main = document.getElementById("sg-main-content");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <aside
      className={
        "flex w-44 shrink-0 flex-col border-r border-border bg-background-secondary " + className
      }
      aria-label="Category navigation"
    >
      <div className="sticky top-0 flex flex-col gap-1 overflow-y-auto p-2">
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
          <Anchor className="h-3.5 w-3.5" aria-hidden />
          Categories
        </div>
        {categories.map((cat) => {
          const id = `sg-cat-${cat}`;
          const isActive = activeId === id;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onScrollTo(id)}
              className={
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors " +
                (isActive
                  ? "bg-accent/20 text-accent font-medium"
                  : "text-foreground hover:bg-background hover:text-foreground")
              }
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{cat}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleBackToTop}
          className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-background hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-[-90deg]" aria-hidden />
          Back to Top
        </button>
      </div>
    </aside>
  );
}
