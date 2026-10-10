/** Style Grid host — iframe postMessage bridge (from events.js). */
"use strict";

import {
    state,
    styleIdentityKey,
    setStoredSource,
    migrateFavoritesInMemory,
    pushStyleIntoCategories,
    findStyleByNameAndSource,
} from "../state.js";
import {
    setPromptValue,
} from "../prompt-utils.js";
import {
    qs,
    openStyleEditor,
    duplicateStyle,
    deleteStyle,
    moveToCategory,
    showExportImport,
    syncSelectionChrome,
    anySGFrameVisible,
    setHostPageScrollLock,
} from "../render.js";
import {
    syncSourceInput,
    clearAll,
    rebuildPromptFromOrder,
} from "./apply.js";
import {
    buildSgToken,
    syncWildcards,
    removeWildcardCategory,
    reorderWildcardCategories,
} from "./wildcards.js";
import {
    refreshPanel,
} from "./panel.js";
import {
    startBatchThumbnails,
} from "./thumbnails-batch.js";
import {
    generateThumbnail,
    uploadThumbnail,
} from "./thumbnails.js";
import {
    buildThemeMessage,
    detectHostThemeMode,
} from "../theme.js";

function installIframeMessageBridge(tab, frame) {
        window.addEventListener("message", function (e) {
            if (!e.data || !e.data.type) return;
            if (!e.data.type.startsWith("SG_")) return;
            // Two iframes (txt2img / img2img) each register this listener; only handle messages from THIS frame.
            // Otherwise the other tab's handler runs with wrong tab closure → e.g. batch uses All while iframe shows a chosen source.
            if (e.source !== frame.contentWindow) return;
            const msg = e.data;

            function refreshAndNotifyFrame() {
                fetch("/style_grid/styles")
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var allStyles = Array.isArray(data) ? data : Object.values(data.categories || {}).flat();
                        state[tab].categories = {};
                        allStyles.forEach(function (s) {
                            var cat = s.category || "OTHER";
                            if (!state[tab].categories[cat]) state[tab].categories[cat] = [];
                            state[tab].categories[cat].push(s);
                        });
                        if (frame && frame.contentWindow) {
                            frame.contentWindow.postMessage({
                                type: "SG_STYLES_UPDATE",
                                styles: allStyles
                            }, "*");
                        }
                    });
            }
            state[tab].refreshAndNotifyFrame = refreshAndNotifyFrame;
            function findStyleByName(styleName) {
                // Searches the tab-local host cache built from state[tab].categories.
                var cats = (state[tab] && state[tab].categories) || {};
                for (var cat in cats) {
                    if (!Object.prototype.hasOwnProperty.call(cats, cat)) continue;
                    var list = cats[cat] || [];
                    var found = list.find(function (s) { return s.name === styleName; });
                    if (found) return found;
                }
                return null;
            }
            function findStyleForMessage(styleName, sourceFile) {
                if (sourceFile) {
                    return findStyleByNameAndSource(tab, styleName, sourceFile);
                }
                return findStyleByName(styleName);
            }
            if (msg.type === "SG_READY") {
                // Fresh detect at READY time - do not reuse a mode cached at iframe creation.
                frame.contentWindow.postMessage(buildThemeMessage(detectHostThemeMode()), "*");
                if (state[tab].sgV2HostInitSent) return;
                fetch("/style_grid/styles")
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var allStyles = Array.isArray(data)
                            ? data
                            : Object.values(data.categories || {}).flat();
                        // Populate host-side style cache for applyStyleImmediate
                        if (!state[tab]) state[tab] = {};
                        if (!state[tab].categories) state[tab].categories = {};
                        allStyles.forEach(function (s) {
                            pushStyleIntoCategories(state[tab].categories, s);
                        });
                        migrateFavoritesInMemory(tab);
                        frame.contentWindow.postMessage({
                            type: "SG_INIT",
                            tab: tab,
                            styles: allStyles,
                        }, "*");
                        state[tab].sgV2HostInitSent = true;
                    })
                    .catch(function () {});
            }

            if (msg.type === "SG_APPLY") {
                if (!state[tab].selected) state[tab].selected = new Set();
                var applyKey = styleIdentityKey(msg.styleId, msg.source_file || "");
                state[tab].selected.add(applyKey);
                state[tab].selectedOrder = state[tab].selectedOrder || [];
                if (state[tab].selectedOrder.indexOf(applyKey) === -1) {
                    state[tab].selectedOrder.push(applyKey);
                }
                window._sgApplyStyle(tab, msg.styleId, {
                    source_file: msg.source_file,
                    prompt: msg.prompt,
                    neg: msg.neg,
                });
                syncSourceInput(tab);
                syncSelectionChrome(tab);
            }

            if (msg.type === "SG_UNAPPLY") {
                var unapplyKey = styleIdentityKey(msg.styleId, msg.source_file || "");
                if (state[tab] && state[tab].selected) {
                    state[tab].selected.delete(unapplyKey);
                    state[tab].selected.delete(msg.styleId);
                    state[tab].selectedOrder = (state[tab].selectedOrder || []).filter(function (n) {
                        return n !== unapplyKey && n !== msg.styleId;
                    });
                }
                window._sgUnapplyStyle(tab, msg.styleId, msg.source_file || "");
                syncSelectionChrome(tab);
            }

            if (msg.type === "SG_REORDER_STYLES") {
                var ids = Array.isArray(msg.styleIds) ? msg.styleIds : [];
                state[tab].selectedOrder = ids;
                // Preserve existing applied deltas — do not fabricate full-prompt records
                if (typeof rebuildPromptFromOrder === "function") {
                    rebuildPromptFromOrder(tab);
                }
            }

            if (msg.type === "SG_CLOSE_REQUEST") {
                var closeTarget = state[tab].sgFrameWrapper || frame;
                closeTarget.style.display = "none";
                setHostPageScrollLock(anySGFrameVisible());
            }

            if (msg.type === "SG_BACKUP") {
                fetch("/style_grid/backup", { method: "POST" })
                    .then(function (r) {
                        if (!r.ok) { return r.text().then(function (t) { throw new Error("HTTP " + r.status + ": " + t.slice(0, 120)); }); }
                        return r.json();
                    })
                    .then(function (data) {
                        if (frame.contentWindow) {
                            var failed = data.error || data.ok === false;
                            frame.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: data.error
                                    ? ("Backup failed: " + data.error)
                                    : data.ok === false
                                        ? "Nothing to backup (no CSV files found)"
                                        : "💾 Backup created",
                                variant: failed ? "error" : "success"
                            }, "*");
                        }
                    })
                    .catch(function (err) {
                        if (frame.contentWindow) {
                            frame.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: "Backup request failed: " + (err && err.message ? err.message : String(err)),
                                variant: "error"
                            }, "*");
                        }
                    });
            }
            if (msg.type === "SG_REFRESH") {
                refreshPanel(tab);
                fetch("/style_grid/check_update")
                    .then(function () { return fetch("/style_grid/styles"); })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var allStyles = Array.isArray(data) ? data : Object.values(data.categories || {}).flat();
                        state[tab].categories = {};
                        allStyles.forEach(function (s) {
                            var cat = s.category || "OTHER";
                            if (!state[tab].categories[cat]) state[tab].categories[cat] = [];
                            state[tab].categories[cat].push(s);
                        });
                        if (frame.contentWindow) {
                            frame.contentWindow.postMessage({
                                type: "SG_STYLES_UPDATE",
                                styles: allStyles
                            }, "*");
                        }
                    });
            }
            if (msg.type === "SG_CLEAR_ALL") {
                clearAll(tab);
            }
            if (msg.type === "SG_IMPORT_EXPORT") {
                showExportImport(tab);
            }
            if (msg.type === "SG_NEW_STYLE") {
                openStyleEditor(tab, null, msg.sourceFile);
            }
            if (msg.type === "SG_EDIT_STYLE") {
                var styleToEdit = findStyleForMessage(msg.styleId, msg.source_file);
                if (styleToEdit) {
                    openStyleEditor(tab, styleToEdit);
                }
            }
            if (msg.type === "SG_DUPLICATE_STYLE") {
                var styleToDup = findStyleForMessage(msg.styleId, msg.source_file);
                if (styleToDup) {
                    duplicateStyle(tab, styleToDup, refreshAndNotifyFrame);
                }
            }
            if (msg.type === "SG_MOVE_TO_CATEGORY") {
                var styleToMove = findStyleForMessage(msg.styleId, msg.source_file);
                if (styleToMove) {
                    moveToCategory(tab, styleToMove, refreshAndNotifyFrame);
                }
            }
            if (msg.type === "SG_WILDCARD_CATEGORY") {
                var catId = msg.category || "";
                if (catId) {
                    var wcTag = buildSgToken(catId, msg.spec || "", msg.kind);
                    var promptEl = qs("#" + tab + "_prompt textarea");
                    if (promptEl) {
                        var sep = promptEl.value.trim() ? ", " : "";
                        setPromptValue(promptEl, promptEl.value.replace(/,\s*$/, "") + sep + wcTag);
                    }
                    syncWildcards(tab);
                }
            }
            if (msg.type === "SG_WILDCARD_SLICE") {
                var sliceCat = msg.category || "";
                if (sliceCat) {
                    var sliceTag = buildSgToken(sliceCat, msg.spec || "", msg.kind);
                    var slicePromptEl = qs("#" + tab + "_prompt textarea");
                    if (slicePromptEl) {
                        var sliceSep = slicePromptEl.value.trim() ? ", " : "";
                        setPromptValue(slicePromptEl, slicePromptEl.value.replace(/,\s*$/, "") + sliceSep + sliceTag);
                    }
                    syncWildcards(tab);
                }
            }
            if (msg.type === "SG_REMOVE_WILDCARD") {
                if (msg.category) {
                    removeWildcardCategory(tab, msg.category, msg.spec || "", msg.kind);
                }
            }
            if (msg.type === "SG_REORDER_WILDCARDS") {
                if (Array.isArray(msg.categories) && msg.categories.length) {
                    reorderWildcardCategories(tab, msg.categories);
                }
            }
            if (msg.type === "SG_SOURCE_CHANGE") {
                if (!state[tab]) return;
                if (msg.source === state[tab].selectedSourceFile) return;
                var src = msg.source;
                if (src) {
                    var normalized = src.replace(/\\/g, "/");
                    state[tab].selectedSource = normalized.split("/").pop() || src;
                    // Full path for batch/API — same filter as V2 (`source_file`), not basename-only
                    state[tab].selectedSourceFile = (normalized.indexOf("/") !== -1 || src.indexOf("\\") !== -1)
                        ? normalized
                        : null;
                } else {
                    state[tab].selectedSource = "All";
                    state[tab].selectedSourceFile = null;
                }
                var syncBtn = document.getElementById("sg_source_" + tab);
                if (syncBtn) {
                    syncBtn.textContent = state[tab].selectedSource === "All" ? "All Sources" : state[tab].selectedSource;
                }
                setStoredSource(tab, state[tab].selectedSource || "All");
                syncSourceInput(tab);
            }
            if (msg.type === "SG_GENERATE_CATEGORY_PREVIEWS") {
                var catName = msg.category || "";
                if (catName) {
                    if (msg.source !== undefined) {
                        state[tab].selectedSourceFile = msg.source;
                    }
                    var batchSource = msg.source || state[tab].selectedSourceFile || "";
                    var sourceMatchKey = function (str) {
                        if (!str) return "";
                        var base = String(str).replace(/\\/g, "/").split("/").pop() || "";
                        return base.replace(/\.csv$/i, "").toLowerCase();
                    };
                    var rawState = (state[tab] && state[tab].selectedSource) || "All";
                    var srcBtn = document.getElementById("sg_source_" + tab);
                    var btnText = srcBtn ? srcBtn.textContent.trim() : "";
                    var fromBtn = (btnText && btnText !== "All Sources") ? btnText : "All";
                    var activeSource = (rawState && rawState !== "All") ? rawState : fromBtn;
                    var activeKey = null;
                    var exactPath = null;
                    if (batchSource) {
                        var ns = String(batchSource).replace(/\\/g, "/");
                        activeSource = ns.split("/").pop() || String(batchSource);
                        if (ns.indexOf("/") !== -1 || String(batchSource).indexOf("\\") !== -1) {
                            exactPath = ns;
                            activeKey = null;
                        } else {
                            exactPath = null;
                            activeKey = sourceMatchKey(String(batchSource));
                        }
                        state[tab].selectedSource = activeSource;
                        state[tab].selectedSourceFile = exactPath;
                        var syncBtnBatch = document.getElementById("sg_source_" + tab);
                        if (syncBtnBatch) {
                            syncBtnBatch.textContent = state[tab].selectedSource === "All" ? "All Sources" : state[tab].selectedSource;
                        }
                    } else {
                        activeKey = activeSource !== "All" ? sourceMatchKey(activeSource) : null;
                        exactPath = null;
                    }
                    // state[tab].categories dedupes by name only on first load — use API list; filter like V2 (source_file), not basename-only
                    fetch("/style_grid/styles")
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            var allStyles = Array.isArray(data) ? data : Object.values(data.categories || {}).flat();
                            var inCat = allStyles.filter(function (s) {
                                return (s.category || "OTHER") === catName;
                            });
                            var stylesInCat = inCat;
                            if (exactPath) {
                                stylesInCat = inCat.filter(function (s) {
                                    var sf = String(s.source_file || "").replace(/\\/g, "/");
                                    return sf === exactPath || sf.toLowerCase() === exactPath.toLowerCase();
                                });
                            } else if (activeKey) {
                                stylesInCat = inCat.filter(function (s) {
                                    return sourceMatchKey(s.source || s.source_file) === activeKey;
                                });
                            }
                            startBatchThumbnails(tab, catName, stylesInCat);
                        })
                        .catch(function () {
                            var frLoad = state[tab] && state[tab].sgFrame;
                            if (frLoad && frLoad.contentWindow) {
                                frLoad.contentWindow.postMessage({
                                    type: "SG_TOAST",
                                    message: "Could not load styles for batch generation",
                                    variant: "error"
                                }, "*");
                            }
                        });
                }
            }
            if (msg.type === "SG_GENERATE_PREVIEW") {
                var genSource = msg.source || state[tab].selectedSourceFile || "";
                generateThumbnail(tab, msg.styleId, function () {}, function (status, progressValue) {
                    if (frame.contentWindow) {
                        frame.contentWindow.postMessage({
                            type: "SG_THUMB_PROGRESS",
                            status: status,
                            styleId: msg.styleId,
                            progress: progressValue,
                        }, "*");
                        if (status === "done") {
                            frame.contentWindow.postMessage({
                                type: "SG_THUMB_PROGRESS",
                                status: "done",
                                styleId: msg.styleId,
                                progress: 100,
                            }, "*");
                            setTimeout(function () {
                                if (frame && frame.contentWindow) {
                                    frame.contentWindow.postMessage({
                                        type: "SG_THUMB_DONE",
                                        styleId: msg.styleId,
                                        version: Date.now(),
                                        source_file: genSource,
                                    }, "*");
                                }
                            }, 300);
                        }
                        if (status === "error") {
                            frame.contentWindow.postMessage({
                                type: "SG_THUMB_PROGRESS",
                                status: "error",
                                styleId: msg.styleId,
                            }, "*");
                        }
                    }
                }, genSource);
            }
            if (msg.type === "SG_UPLOAD_PREVIEW") {
                var uploadSource = msg.source || state[tab].selectedSourceFile || "";
                uploadThumbnail(tab, msg.styleId, uploadSource);
            }
            if (msg.type === "SG_DELETE_STYLE") {
                var styleToDelete = findStyleForMessage(msg.styleId, msg.source_file);
                if (styleToDelete) {
                    deleteStyle(tab, styleToDelete.name, styleToDelete.source || styleToDelete.source_file, refreshAndNotifyFrame);
                }
            }
        });
}

export {
    installIframeMessageBridge,
};
