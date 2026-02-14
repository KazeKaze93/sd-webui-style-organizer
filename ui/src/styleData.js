/**
 * Style data helpers: build categories from flat styles, merge by source priority, filter by source.
 * Separation: API/data shape vs UI.
 */

const SOURCE_PRIORITY_ROOT = 0;
const SOURCE_PRIORITY_INTERNAL = 1;
const SOURCE_PRIORITY_USER = 2;

export function categorizeStyles(styles) {
  const categories = {};
  for (const s of styles) {
    const name = s.name || "";
    const idx = name.indexOf("_");
    let cat;
    let displayName;
    if (idx > 0 && name.slice(0, idx) === name.slice(0, idx).toUpperCase() && idx >= 2) {
      cat = name.slice(0, idx);
      displayName = name.slice(idx + 1).replace(/_/g, " ");
    } else {
      cat = "OTHER";
      displayName = name.replace(/_/g, " ");
    }
    const styleWithMeta = { ...s, category: cat, display_name: displayName };
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(styleWithMeta);
  }
  return categories;
}

/**
 * Merge styles by name; for duplicates keep highest source_priority (User > Internal > Root).
 */
export function mergeStylesByPriority(styles) {
  const byName = new Map();
  for (const s of styles) {
    const name = s.name;
    if (!name) continue;
    const existing = byName.get(name);
    const pri = s.source_priority ?? SOURCE_PRIORITY_ROOT;
    if (!existing || (pri > (existing.source_priority ?? SOURCE_PRIORITY_ROOT))) {
      byName.set(name, s);
    }
  }
  return Array.from(byName.values());
}

/**
 * Return styles to display: either merged (all sources) or filtered by selected source.
 */
export function getStylesForSource(styles, selectedSource, allSourcesLabel = "All Sources") {
  if (!selectedSource || selectedSource === allSourcesLabel) {
    return mergeStylesByPriority(styles);
  }
  return styles.filter((s) => s.source === selectedSource);
}
