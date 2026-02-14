import React from "react";

/**
 * shadcn-like Tooltip: hover shows content. CSS-based (no portal/measure).
 */
export function Tooltip({ children, content, side = "top", className = "" }) {
  const posClass = side === "top" ? "bottom-full left-1/2 -translate-x-1/2 mb-1" : "top-full left-1/2 -translate-x-1/2 mt-1";
  return (
    <span className={"group relative inline-block " + className}>
      {children}
      {content && (
        <span
          role="tooltip"
          className={
            "pointer-events-none absolute z-[10001] hidden w-[min(90vw,360px)] max-h-[min(60vh,320px)] overflow-y-auto rounded-md border border-border bg-background-secondary px-3 py-2 text-xs text-foreground shadow-lg " +
            posClass +
            " group-hover:block"
          }
        >
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * Content for style card: full prompt and negative prompt in clear sections.
 */
export function StyleTooltipContent({ style }) {
  const hasPrompt = style.prompt && style.prompt.trim();
  const hasNeg = style.negative_prompt && style.negative_prompt.trim();
  if (!hasPrompt && !hasNeg) return <span className="text-muted">No prompt data</span>;
  return (
    <div className="space-y-2">
      {style.source && (
        <div className="text-muted">
          <span className="font-medium">Source:</span> {style.source}
        </div>
      )}
      {hasPrompt && (
        <div>
          <div className="mb-0.5 font-medium text-foreground">Prompt</div>
          <div className="whitespace-pre-wrap break-words text-muted">{style.prompt}</div>
        </div>
      )}
      {hasNeg && (
        <div>
          <div className="mb-0.5 font-medium text-foreground">Negative prompt</div>
          <div className="whitespace-pre-wrap break-words text-muted">{style.negative_prompt}</div>
        </div>
      )}
    </div>
  );
}
