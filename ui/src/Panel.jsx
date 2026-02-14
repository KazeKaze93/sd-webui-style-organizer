import React, { useMemo, useState, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import { Accordion } from "./components/Accordion";
import { StyleCard } from "./components/StyleCard";
import { Header } from "./components/Header";
import { VirtualCardGrid } from "./components/VirtualCardGrid";
import { CATEGORY_COLORS, getFavorites, setFavorites, getSelectedSource, setSelectedSource as persistSelectedSource } from "./constants";
import { parseSearchQuery, cardMatchesSearch, buildSearchData } from "./searchFilter";
import { categorizeStyles, getStylesForSource } from "./styleData";
import { useDebouncedValue } from "./hooks/useDebouncedValue";

const FAVORITES_CAT = "FAVORITES";
const ALL_SOURCES_LABEL = "All Sources";

function useSortedCategories(categories, categoryOrder) {
  return useMemo(() => {
    const keys = Object.keys(categories);
    const ordered = [];
    (categoryOrder || []).forEach((c) => {
      if (keys.includes(c)) ordered.push(c);
    });
    keys.forEach((c) => {
      if (!ordered.includes(c)) ordered.push(c);
    });
    return ordered;
  }, [categories, categoryOrder]);
}

function Panel({
  tabName,
  sources: sourcesProp = [],
  styles: stylesProp = [],
  categories: categoriesLegacy,
  categoryOrder,
  initialSelected = [],
  applyMode: initialApplyMode,
  onApply,
  onClose,
  onSelectedChange,
}) {
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [selectedSource, setSelectedSourceState] = useState(() => getSelectedSource(tabName) || ALL_SOURCES_LABEL);
  const setSelectedSource = useCallback(
    (value) => {
      setSelectedSourceState(value);
      persistSelectedSource(tabName, value);
    },
    [tabName]
  );

  useEffect(() => {
    if (typeof onSelectedChange === "function") onSelectedChange(selected.size);
  }, [selected.size, onSelectedChange]);
  const [favorites, setFavoritesState] = useState(() => getFavorites(tabName));
  const [searchQuery, setSearchQuery] = useState("");
  const searchQueryDebounced = useDebouncedValue(searchQuery, 300);
  const [compact, setCompact] = useState(false);
  const [applyStatus, setApplyStatus] = useState("idle");
  const [collapsed, setCollapsed] = useState(() => ({}));
  const [applyMode, setApplyModeState] = useState(initialApplyMode || "prompt");

  const sources = useMemo(() => {
    if (Array.isArray(sourcesProp) && sourcesProp.length > 0) return sourcesProp;
    const fromStyles = new Set((stylesProp || []).map((s) => s.source).filter(Boolean));
    return Array.from(fromStyles);
  }, [sourcesProp, stylesProp]);

  useEffect(() => {
    if (sources.length === 0) return;
    if (selectedSource !== ALL_SOURCES_LABEL && !sources.includes(selectedSource)) {
      setSelectedSourceState(ALL_SOURCES_LABEL);
    }
  }, [sources, selectedSource]);

  const effectiveStyles = useMemo(() => {
    if (!stylesProp || stylesProp.length === 0) return [];
    return getStylesForSource(stylesProp, selectedSource, ALL_SOURCES_LABEL);
  }, [stylesProp, selectedSource]);

  const categories = useMemo(() => {
    if (categoriesLegacy && Object.keys(categoriesLegacy).length > 0) return categoriesLegacy;
    return categorizeStyles(effectiveStyles);
  }, [categoriesLegacy, effectiveStyles]);

  const sortedCats = useSortedCategories(categories, categoryOrder);

  const persistFavorites = useCallback(
    (next) => {
      setFavoritesState(next);
      setFavorites(tabName, next);
    },
    [tabName]
  );

  const onToggleFavorite = useCallback(
    (styleName) => {
      const next = new Set(favorites);
      if (next.has(styleName)) next.delete(styleName);
      else next.add(styleName);
      persistFavorites(next);
    },
    [favorites, persistFavorites]
  );

  const onToggleStyle = useCallback((styleName) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(styleName)) next.delete(styleName);
      else next.add(styleName);
      return next;
    });
  }, []);

  const allStyles = useMemo(() => {
    const list = [];
    Object.values(categories).forEach((arr) => arr.forEach((s) => list.push(s)));
    return list;
  }, [categories]);

  const favoriteStyles = useMemo(() => {
    return allStyles.filter((s) => favorites.has(s.name));
  }, [allStyles, favorites]);

  const searchParsed = useMemo(() => parseSearchQuery(searchQueryDebounced), [searchQueryDebounced]);

  const displayCategories = useMemo(() => {
    const list = [];
    if (favoriteStyles.length > 0) list.push(FAVORITES_CAT);
    list.push(...sortedCats);
    return list;
  }, [favoriteStyles.length, sortedCats]);

  const flatFilteredItems = useMemo(() => {
    const out = [];
    displayCategories.forEach((catName) => {
      const isFav = catName === FAVORITES_CAT;
      const styles = isFav ? favoriteStyles : categories[catName] || [];
      const color = CATEGORY_COLORS[catName] || CATEGORY_COLORS.OTHER;
      styles
        .filter((s) =>
          cardMatchesSearch(buildSearchData(s), isFav ? FAVORITES_CAT : catName, searchParsed)
        )
        .forEach((s) => out.push({ style: s, color }));
    });
    return out;
  }, [displayCategories, categories, favoriteStyles, searchParsed]);

  const useVirtualList = flatFilteredItems.length > 100;

  const allCollapsed = useMemo(() => {
    return displayCategories.every((c) => collapsed[c]);
  }, [displayCategories, collapsed]);

  const setCollapseAll = useCallback((value) => {
    setCollapsed((prev) => {
      const next = { ...prev };
      displayCategories.forEach((c) => (next[c] = value));
      return next;
    });
  }, [displayCategories]);

  const onCollapseAllToggle = useCallback(() => {
    setCollapseAll(!allCollapsed);
  }, [allCollapsed, setCollapseAll]);

  const onApplyModeChange = useCallback((mode) => {
    setApplyModeState(mode);
    try {
      localStorage.setItem("sg_apply_mode", mode);
    } catch (_) {}
  }, []);

  const handleApply = useCallback(() => {
    setApplyStatus("applying");
    onApply(Array.from(selected), applyMode);
    setApplyStatus("success");
    setTimeout(() => onClose(), 1000);
  }, [selected, applyMode, onApply, onClose]);

  const scrollToId = useCallback((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const [activeSidebarId, setActiveSidebarId] = useState(null);
  useEffect(() => {
    const main = document.getElementById("sg-main-content");
    if (!main) return;
    const categoriesWithIds = displayCategories.map((c) => `sg-cat-${c}`);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = e.target.id;
          if (categoriesWithIds.includes(id)) setActiveSidebarId(id);
        }
      },
      { root: main, rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    categoriesWithIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [displayCategories]);

  const renderCategory = (catName) => {
    const isFav = catName === FAVORITES_CAT;
    const styles = isFav ? favoriteStyles : categories[catName] || [];
    if (!styles.length) return null;

    const color = CATEGORY_COLORS[catName] || CATEGORY_COLORS.OTHER;
    const id = `sg-cat-${catName}`;
    const isOpen = !collapsed[catName];

    const filtered = styles.filter((s) => {
      const searchData = buildSearchData(s);
      return cardMatchesSearch(searchData, isFav ? FAVORITES_CAT : catName, searchParsed);
    });

    if (!searchQuery && filtered.length === 0) return null;
    if (searchQuery && filtered.length === 0) return null;

    return (
      <Accordion
        key={catName}
        id={id}
        title={catName}
        count={filtered.length}
        color={color}
        isOpen={isOpen}
        onToggle={() => setCollapsed((p) => ({ ...p, [catName]: !p[catName] }))}
      >
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
        >
          {filtered.map((style) => (
            <StyleCard
              key={style.name}
              style={style}
              color={color}
              isSelected={selected.has(style.name)}
              isFavorite={favorites.has(style.name)}
              compact={compact}
              onToggle={onToggleStyle}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      </Accordion>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Header
        selectedCount={selected.size}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sources={sources}
        selectedSource={selectedSource}
        onSourceChange={setSelectedSource}
        allSourcesLabel={ALL_SOURCES_LABEL}
        compact={compact}
        onCompactChange={() => setCompact((c) => !c)}
        allCollapsed={allCollapsed}
        onCollapseAllToggle={onCollapseAllToggle}
        applyMode={applyMode}
        onApplyModeChange={onApplyModeChange}
        onClear={() => setSelected(new Set())}
        onApply={handleApply}
        onClose={onClose}
        applyStatus={applyStatus}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          categories={displayCategories}
          activeId={activeSidebarId}
          onScrollTo={scrollToId}
          className="hidden md:flex"
        />
        <main
          id="sg-main-content"
          className={"min-h-0 flex-1 p-3 " + (useVirtualList ? "overflow-hidden flex flex-col" : "overflow-y-auto")}
        >
          {useVirtualList ? (
            <VirtualCardGrid
              items={flatFilteredItems}
              selected={selected}
              favorites={favorites}
              compact={compact}
              onToggleStyle={onToggleStyle}
              onToggleFavorite={onToggleFavorite}
              containerClassName="min-h-0 flex-1 overflow-y-auto"
              gridClassName="grid gap-2"
            />
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
              {displayCategories.map(renderCategory)}
            </div>
          )}
        </main>
      </div>

      {selected.size > 0 && (
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background-secondary px-4 py-2">
          <span className="text-sm text-muted">Selected:</span>
          {Array.from(selected).map((name) => {
            const style = allStyles.find((s) => s.name === name);
            const label = style ? style.display_name : name;
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
              >
                {label}
                <button
                  type="button"
                  onClick={() => onToggleStyle(name)}
                  className="text-muted hover:text-foreground"
                  aria-label={`Remove ${label}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </footer>
      )}
    </div>
  );
}

export function mountStyleGridPanel(containerElement, props) {
  if (!containerElement) return;
  const root = createRoot(containerElement);
  root.render(
    <React.StrictMode>
      <Panel {...props} />
    </React.StrictMode>
  );
  return () => root.unmount();
}
