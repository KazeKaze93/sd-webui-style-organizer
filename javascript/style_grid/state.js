/** Style Grid host — per-tab state + persistence (moved from style_grid.js). */
"use strict";

if (typeof window !== "undefined") {
    window.__SG_THUMB_VERSION = "2.0.1";
    window.SG = window.SG || {};
}

function createTabState() {
        return {
            selected: new Set(),
            selectedOrder: [],
            applied: new Map(),
            categories: {},
            selectedSource: "All",
            /** Normalized path (forward slashes) when known — matches V2 `source_file`; same basename can exist in multiple dirs */
            selectedSourceFile: null,
            presets: {},
            userPromptBase: "",
            userPromptBaseNeg: "",
            appliedNestOrder: [],
            hasThumbnail: new Set(),
            sgFrame: null,
            sgFrameWrapper: null,
            sgPanelResize: null,
            sgV2HostInitSent: false,
        };
    }

function _saveThumbVersions() {
        try { localStorage.setItem("sg_thumb_versions", JSON.stringify(_thumbVersions)); }
        catch (_) { }
    }

function getStoredSource(t) {
        try {
            const d = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || "{}");
            return d[t] || "All";
        } catch (_) {
            return "All";
        }
    }

function setStoredSource(t, v) {
        try {
            const d = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || "{}");
            d[t] = v;
            localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(d));
        } catch (_) { }
    }

function styleIdentityKey(name, sourceFile) {
        return String(sourceFile || "").replace(/\\/g, "/") + "\0" + String(name || "");
    }

function parseStyleIdentityKey(key) {
        var s = String(key || "");
        var sep = s.indexOf("\0");
        if (sep === -1) return { name: s, source_file: "" };
        return { source_file: s.slice(0, sep), name: s.slice(sep + 1) };
    }

/** Last path segment after / or \\ (for button labels and legacy leaf matching). */
function sourceLeaf(value) {
        var s = String(value || "").replace(/\\/g, "/");
        var parts = s.split("/");
        return parts[parts.length - 1] || s;
    }

/**
 * Resolve a stored source preference against catalog public ids.
 * Returns { selectedSource, selectedSourceFile, storeValue }.
 * storeValue is what to persist (id or "All"); rewrite when it differs from stored.
 */
function resolveStoredSourceSelection(stored, catalogSourceIds) {
        var ids = Array.isArray(catalogSourceIds) ? catalogSourceIds : [];
        var raw = (stored === null || stored === undefined || stored === "") ? "All" : String(stored);
        if (raw === "All") {
            return { selectedSource: "All", selectedSourceFile: null, storeValue: "All" };
        }
        if (ids.indexOf(raw) !== -1) {
            return {
                selectedSource: sourceLeaf(raw) || raw,
                selectedSourceFile: raw,
                storeValue: raw,
            };
        }
        var leaf = sourceLeaf(raw).toLowerCase();
        var matches = ids.filter(function (id) {
            return sourceLeaf(id).toLowerCase() === leaf;
        });
        if (matches.length === 1) {
            return {
                selectedSource: sourceLeaf(matches[0]) || matches[0],
                selectedSourceFile: matches[0],
                storeValue: matches[0],
            };
        }
        return { selectedSource: "All", selectedSourceFile: null, storeValue: "All" };
    }

/**
 * Point the host's per-tab selection and applied text at a renamed style.
 * Favorites and recent live on the server (data/favorites.json, recent.json),
 * which the rename route migrates itself.
 */
function remapStyleNameReferences(tabName, oldName, newName, sourceFile) {
        if (!oldName || !newName || oldName === newName) return;
        var st = state[tabName];
        if (!st) return;
        var src = String(sourceFile || "").replace(/\\/g, "/");
        var oldKey = styleIdentityKey(oldName, src);
        var newKey = styleIdentityKey(newName, src);

        if (st.selected && st.selected.has(oldKey)) {
            st.selected.delete(oldKey);
            st.selected.add(newKey);
        } else if (st.selected && st.selected.has(oldName)) {
            // Legacy bare-name selection
            st.selected.delete(oldName);
            st.selected.add(newKey);
        }
        if (st.selectedOrder && st.selectedOrder.length) {
            st.selectedOrder = st.selectedOrder.map(function (n) {
                if (n === oldKey || n === oldName) return newKey;
                return n;
            });
        }
        if (st.applied && st.applied.has(oldKey)) {
            var rec = st.applied.get(oldKey);
            st.applied.delete(oldKey);
            st.applied.set(newKey, rec);
        } else if (st.applied && st.applied.has(oldName)) {
            var recLegacy = st.applied.get(oldName);
            st.applied.delete(oldName);
            st.applied.set(newKey, recLegacy);
        }
        if (st.appliedNestOrder && st.appliedNestOrder.length) {
            st.appliedNestOrder = st.appliedNestOrder.map(function (n) {
                if (n === oldKey || n === oldName) return newKey;
                return n;
            });
        }
    }

function getUniqueSources(t) {
        const cats = state[t].categories || {};
        const s = new Set();
        Object.values(cats).forEach(function (arr) { arr.forEach(function (st) { if (st.source) s.add(st.source); }); });
        return Array.from(s).sort();
    }

function findStyleByName(t, n) {
        var matches = [];
        var seen = {};
        Object.values((state[t] && state[t].categories) || {}).forEach(function (styles) {
            (styles || []).forEach(function (s) {
                if (s.name !== n) return;
                var key = styleIdentityKey(s.name, s.source_file || s.source || "");
                if (seen[key]) return;
                seen[key] = true;
                matches.push(s);
            });
        });
        return matches.length === 1 ? matches[0] : null;
    }

function styleCacheIdentity(s) {
        return styleIdentityKey(s.name, s.source_file || s.source || "");
    }

function pushStyleIntoCategories(categories, s) {
        var cat = s.category || "OTHER";
        if (!categories[cat]) categories[cat] = [];
        var key = styleCacheIdentity(s);
        var exists = categories[cat].some(function (x) {
            return styleCacheIdentity(x) === key;
        });
        if (!exists) categories[cat].push(s);
    }

function findStyleByNameAndSource(t, name, sourceFile) {
        var want = String(sourceFile || "").replace(/\\/g, "/");
        if (!want) return findStyleByName(t, name);
        for (const styles of Object.values(state[t].categories)) {
            const f = styles.find(function (s) {
                return s.name === name && String(s.source_file || "").replace(/\\/g, "/") === want;
            });
            if (f) return f;
        }
        return null;
    }

const state = {};
["txt2img", "img2img"].forEach(function (tab) {
    state[tab] = createTabState();
});

var _thumbVersions = (function () {
    try { return JSON.parse(localStorage.getItem("sg_thumb_versions") || "{}"); }
    catch (_) { return {}; }
})();

const SOURCE_STORAGE_KEY = "sg_source";

export {
    state,
    _thumbVersions,
    SOURCE_STORAGE_KEY,
    createTabState,
    _saveThumbVersions,
    getStoredSource,
    setStoredSource,
    styleIdentityKey,
    parseStyleIdentityKey,
    remapStyleNameReferences,
    getUniqueSources,
    findStyleByName,
    styleCacheIdentity,
    pushStyleIntoCategories,
    findStyleByNameAndSource,
    sourceLeaf,
    resolveStoredSourceSelection,
};
