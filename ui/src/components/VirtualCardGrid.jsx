import React, { useRef, useState, useCallback, useEffect } from "react";
import { StyleCard } from "./StyleCard";

const ITEM_HEIGHT = 52;
const OVERSCAN = 8;
const VIRTUAL_THRESHOLD = 100;

/**
 * Lightweight virtual list: renders only cards in viewport when itemCount > 100.
 * No external libs. Uses scroll + ResizeObserver to compute visible range.
 */
export function VirtualCardGrid({
  items,
  selected,
  favorites,
  compact,
  onToggleStyle,
  onToggleFavorite,
  containerClassName,
  gridClassName,
}) {
  const containerRef = useRef(null);
  const [startIndex, setStartIndex] = useState(0);
  const [endIndex, setEndIndex] = useState(Math.min(VIRTUAL_THRESHOLD, items.length));
  const itemCount = items.length;
  const useVirtual = itemCount > VIRTUAL_THRESHOLD;

  const update = useCallback(() => {
    const el = containerRef.current;
    if (!el || itemCount <= 0) return;
    const scrollTop = el.scrollTop;
    const clientHeight = el.clientHeight;
    const visibleStart = Math.floor(scrollTop / ITEM_HEIGHT);
    const visibleEnd = Math.ceil((scrollTop + clientHeight) / ITEM_HEIGHT);
    const start = Math.max(0, visibleStart - OVERSCAN);
    const end = Math.min(itemCount - 1, visibleEnd + OVERSCAN);
    setStartIndex(start);
    setEndIndex(end);
  }, [itemCount]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const totalHeight = itemCount * ITEM_HEIGHT;
  const sliceStart = useVirtual ? startIndex : 0;
  const sliceEnd = useVirtual ? endIndex : itemCount - 1;
  const visibleItems = items.slice(sliceStart, sliceEnd + 1);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      style={useVirtual ? { overflowY: "auto", overflowX: "hidden" } : undefined}
    >
      {useVirtual ? (
        <div style={{ height: totalHeight, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: sliceStart * ITEM_HEIGHT,
              left: 0,
              right: 0,
            }}
            className={gridClassName}
          >
            {visibleItems.map((item) => (
              <div key={item.style.name} style={{ minHeight: ITEM_HEIGHT }}>
                <StyleCard
                  style={item.style}
                  color={item.color}
                  isSelected={selected.has(item.style.name)}
                  isFavorite={favorites.has(item.style.name)}
                  compact={compact}
                  onToggle={onToggleStyle}
                  onToggleFavorite={onToggleFavorite}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={gridClassName}>
          {items.map((item) => (
            <StyleCard
              key={item.style.name}
              style={item.style}
              color={item.color}
              isSelected={selected.has(item.style.name)}
              isFavorite={favorites.has(item.style.name)}
              compact={compact}
              onToggle={onToggleStyle}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
