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
            usage: {},
            presets: {},
            userPromptBase: "",
            userPromptBaseNeg: "",
            appliedNestOrder: [],
            hasThumbnail: new Set(),
            sgFrame: null,
            sgFrameWrapper: null,
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

function getFavorites(t) {
        try {
            const d = JSON.parse(localStorage.getItem("sg_favorites") || "{}");
            return new Set(d[t] || []);
        } catch (_) {
            return new Set();
        }
    }

function setFavorites(t, s) {
        try {
            const d = JSON.parse(localStorage.getItem("sg_favorites") || "{}");
            d[t] = [...s];
            localStorage.setItem("sg_favorites", JSON.stringify(d));
        } catch (_) { }
    }

function migrateFavoritesInMemory(tabName) {
        var fav = getFavorites(tabName);
        if (!fav.size) return fav;
        var allStyles = [];
        Object.values(state[tabName].categories || {}).forEach(function (arr) {
            arr.forEach(function (s) { allStyles.push(s); });
        });
        if (!allStyles.length) return fav;
        var next = new Set();
        var changed = false;
        fav.forEach(function (entry) {
            if (String(entry).indexOf("\0") !== -1) {
                next.add(entry);
                return;
            }
            var matches = allStyles.filter(function (s) { return s.name === entry; });
            if (matches.length === 1) {
                next.add(styleIdentityKey(matches[0].name, matches[0].source_file || matches[0].source || ""));
                changed = true;
            } else {
                changed = true; // drop ambiguous / missing bare names
            }
        });
        if (changed) setFavorites(tabName, next);
        return next;
    }

function getRecentHistory(t) {
        try {
            return JSON.parse(localStorage.getItem("sg_recent_" + t) || "[]");
        } catch (_) {
            return [];
        }
    }

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

        var fav = getFavorites(tabName);
        if (fav.has(oldKey) || fav.has(oldName)) {
            fav.delete(oldKey);
            fav.delete(oldName);
            fav.add(newKey);
            setFavorites(tabName, fav);
        }

        var recent = getRecentHistory(tabName);
        var recentChanged = false;
        var remappedRecent = [];
        var seenRecent = {};
        recent.forEach(function (n) {
            var next = (n === oldKey || n === oldName) ? newKey : n;
            if (n === oldKey || n === oldName) recentChanged = true;
            if (seenRecent[next]) return;
            seenRecent[next] = true;
            remappedRecent.push(next);
        });
        if (recentChanged) {
            localStorage.setItem(
                "sg_recent_" + tabName,
                JSON.stringify(remappedRecent.slice(0, 10))
            );
        }
    }

function getUniqueSources(t) {
        const cats = state[t].categories || {};
        const s = new Set();
        Object.values(cats).forEach(function (arr) { arr.forEach(function (st) { if (st.source) s.add(st.source); }); });
        return Array.from(s).sort();
    }

function findStyleByName(t, n) {
        for (const styles of Object.values(state[t].categories)) {
            const f = styles.find(function (s) { return s.name === n; });
            if (f) return f;
        }
        return null;
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
    getFavorites,
    setFavorites,
    migrateFavoritesInMemory,
    getRecentHistory,
    remapStyleNameReferences,
    getUniqueSources,
    findStyleByName,
    styleCacheIdentity,
    pushStyleIntoCategories,
    findStyleByNameAndSource,
};
