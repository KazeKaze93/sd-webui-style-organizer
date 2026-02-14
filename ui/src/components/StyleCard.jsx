import React from "react";
import { Star, FileText } from "lucide-react";
import { Tooltip, StyleTooltipContent } from "./Tooltip";

/**
 * Single style card: name, optional star (favorite), selected state.
 * Compact mode: only name, reduced padding. Tooltip shows full prompt and negative prompt.
 */
export function StyleCard({
  style,
  color,
  isSelected,
  isFavorite,
  compact,
  onToggle,
  onToggleFavorite,
}) {
  const borderColor = color || "#6b7280";
  const tooltipContent = (
    <StyleTooltipContent style={style} />
  );

  return (
    <Tooltip content={tooltipContent} side="top">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(style.name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(style.name);
          }
        }}
        className={
          "relative flex cursor-pointer items-center gap-2 rounded-md border border-border border-l-4 transition-all " +
          (compact ? "px-2 py-1.5" : "px-2.5 py-2") +
          (isSelected
            ? " bg-accent/15 shadow-[0_0_0_1px_var(--color-accent)]"
            : " bg-background hover:border-accent/60 hover:bg-background-secondary")
        }
        style={{ borderLeftColor: isSelected ? "var(--color-accent)" : borderColor }}
      >
        {!compact && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(style.name);
            }}
            className={
              "shrink-0 rounded p-0.5 transition-colors " +
              (isFavorite ? "text-amber-400 hover:text-amber-300" : "text-muted hover:text-amber-400")
            }
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Star className={"h-4 w-4 " + (isFavorite ? "fill-current" : "")} aria-hidden />
          </button>
        )}
        <span
          className={
            "min-w-0 flex-1 truncate font-medium " +
            (compact ? "text-xs" : "text-sm") +
            (isSelected ? " text-foreground" : " text-foreground")
          }
        >
          {style.display_name}
        </span>
        {!compact && style.source && (
          <span
            className="shrink-0 text-muted"
            title={`Source: ${style.source}`}
            aria-label={`Source file: ${style.source}`}
          >
            <FileText className="h-3.5 w-3.5" />
          </span>
        )}
        {isSelected && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-accent">✓</span>
        )}
      </div>
    </Tooltip>
  );
}
