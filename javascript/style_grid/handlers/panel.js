/** Style Grid host — load / refresh / polling (from events.js). */
"use strict";

import {
    apiGet,
    thumbIdentityKey,
} from "../api.js";
import {
    state,
    getStoredSource,
    getUniqueSources,
    parseStyleIdentityKey,
} from "../state.js";
import {
    setPromptValue,
    stripWrapOrTagsFromText,
} from "../prompt-utils.js";
import {
    qs,
    syncSelectionChrome,
} from "../render.js";
import {
    syncSourceInput,
    applyStyleImmediate,
} from "./apply.js";
import {
    syncWildcards,
} from "./wildcards.js";

let _pollInterval = null;

function loadStyles(tabName) {
        const dataEl = qs("#style_grid_data_" + tabName + " textarea");
        if (!dataEl || !dataEl.value) return {};
        try {
            const data = JSON.parse(dataEl.value);
            state[tabName].usage = data.usage || {};
            state[tabName].presets = data.presets || {};
            return data.categories || {};
        } catch (_) { return {}; }
    }

function loadThumbnailList(tabName) {
        apiGet("/style_grid/thumbnails/list")
            .then(function (data) {
                var entries = data.has_thumbnail || [];
                state[tabName].hasThumbnail = new Set(entries.map(function (e) {
                    return thumbIdentityKey(e.name, e.source_file);
                }));
            })
            .catch(function () {});
    }

function syncPanelHostState(tabName) {
        var categories = loadStyles(tabName);
        state[tabName].categories = categories;

        state[tabName].selectedSource = getStoredSource(tabName);
        var sources = getUniqueSources(tabName);
        var currentSource = state[tabName].selectedSource;
        if (sources.indexOf(currentSource) === -1) currentSource = "All";
        state[tabName].selectedSource = currentSource;
        syncSourceInput(tabName);

        loadThumbnailList(tabName);
    }

function refreshPanel(tabName, opts) {
        opts = opts || {};
        var quietVanishedToast = !!opts.quietVanishedToast;
        apiGet("/style_grid/styles").then(function (data) {
            if (data && Object.prototype.hasOwnProperty.call(data, "presets")) {
                state[tabName].presets = data.presets || {};
            }
            const dataEl = qs("#style_grid_data_" + tabName + " textarea");
            if (dataEl) {
                const full = { categories: data.categories || {}, usage: data.usage || {}, presets: state[tabName].presets };
                setPromptValue(dataEl, JSON.stringify(full));
            }
            // Save selection before host-state sync + apply-restore (no legacy panel rebuild).
            const savedSelection = new Set(state[tabName].selected);
            state[tabName].categories = data.categories || {};
            state[tabName].usage = data.usage || {};
            syncPanelHostState(tabName);
            // Restore selection
            savedSelection.forEach(function (n) {
                state[tabName].selected.add(n);
            });
            // Selection insertion order (appliedOrder was never written — dead branch removed).
            var restoreOrder = [];
            savedSelection.forEach(function (n) { restoreOrder.push(n); });

            // Live-derived base: unwind current nesting before clearing applied records.
            var promptEl = qs("#" + tabName + "_prompt textarea");
            var negEl = qs("#" + tabName + "_neg_prompt textarea");
            var p = promptEl ? (promptEl.value || "") : "";
            var n = negEl ? (negEl.value || "") : "";
            var nest = state[tabName].appliedNestOrder || [];
            for (var i = nest.length - 1; i >= 0; i--) {
                var unwindName = nest[i];
                var unwindRec = state[tabName].applied.get(unwindName);
                if (!unwindRec) continue;
                p = stripWrapOrTagsFromText(p, unwindRec.wrapTemplate, unwindRec.prompt);
                n = stripWrapOrTagsFromText(n, unwindRec.negWrapTemplate, unwindRec.negative);
            }
            state[tabName]._restoreSimP = p;
            state[tabName]._restoreSimN = n;

            // Snapshot before clear: vanished styles (delete/move/CSV gone) need these deltas to strip live text.
            var appliedSnapshot = new Map(state[tabName].applied);
            var preClearNestOrder = (state[tabName].appliedNestOrder || []).slice();

            state[tabName].applied.clear();
            restoreOrder.forEach(function (n) {
                var id = parseStyleIdentityKey(n);
                applyStyleImmediate(tabName, id.name, {
                    silent: true,
                    source_file: id.source_file || undefined,
                });
            });
            // Restore-only replay does not push nest; align nest to what actually restored (drops missing CSV styles).
            state[tabName].appliedNestOrder = restoreOrder.filter(function (key) {
                return state[tabName].applied.has(key);
            });

            // Selected names that failed replay are gone from the catalog — strip their live contribution
            // (outside-in via pre-clear nest) and drop ghost selection tags.
            var vanishedNames = [];
            savedSelection.forEach(function (name) {
                if (!state[tabName].applied.has(name)) vanishedNames.push(name);
            });
            if (vanishedNames.length) {
                var vanishedSet = Object.create(null);
                vanishedNames.forEach(function (name) { vanishedSet[name] = true; });
                var didStripLive = false;
                var livePromptEl = qs("#" + tabName + "_prompt textarea");
                var liveNegEl = qs("#" + tabName + "_neg_prompt textarea");
                if (livePromptEl && liveNegEl) {
                    var liveP = livePromptEl.value || "";
                    var liveN = liveNegEl.value || "";
                    var beforeP = liveP;
                    var beforeN = liveN;
                    for (var vi = preClearNestOrder.length - 1; vi >= 0; vi--) {
                        var goneName = preClearNestOrder[vi];
                        if (!vanishedSet[goneName]) continue;
                        var goneRec = appliedSnapshot.get(goneName);
                        if (!goneRec) continue;
                        liveP = stripWrapOrTagsFromText(liveP, goneRec.wrapTemplate, goneRec.prompt);
                        liveN = stripWrapOrTagsFromText(liveN, goneRec.negWrapTemplate, goneRec.negative);
                    }
                    if (liveP !== beforeP || liveN !== beforeN) {
                        setPromptValue(livePromptEl, liveP);
                        setPromptValue(liveNegEl, liveN);
                        didStripLive = true;
                    }
                }
                vanishedNames.forEach(function (name) {
                    state[tabName].selected.delete(name);
                });
                if (didStripLive) {
                    syncWildcards(tabName);
                    // Unexpected vanish (disk poll / import / manual refresh) — not user delete/move.
                    if (!quietVanishedToast) {
                        var strippedForToast = [];
                        for (var ti = preClearNestOrder.length - 1; ti >= 0; ti--) {
                            var toastName = preClearNestOrder[ti];
                            if (!vanishedSet[toastName]) continue;
                            var toastRec = appliedSnapshot.get(toastName);
                            if (!toastRec) continue;
                            strippedForToast.push(toastName);
                        }
                        var toastMsg = strippedForToast.length === 1
                            ? 'Style "' + strippedForToast[0] + '" is no longer in the library; its text was removed from the prompt.'
                            : strippedForToast.length + " styles are no longer in the library; their text was removed from the prompt.";
                        var frGone = state[tabName] && state[tabName].sgFrame;
                        if (frGone && frGone.contentWindow) {
                            frGone.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: toastMsg,
                                variant: "info"
                            }, "*");
                        }
                    }
                }
            }

            delete state[tabName]._restoreSimP;
            delete state[tabName]._restoreSimN;
            syncSelectionChrome(tabName);
        }).catch(function () {
            var frRef = state[tabName] && state[tabName].sgFrame;
            if (frRef && frRef.contentWindow) {
                frRef.contentWindow.postMessage({
                    type: "SG_TOAST",
                    message: "Refresh failed",
                    variant: "error"
                }, "*");
            }
        });
    }

function startPolling() {
        if (_pollInterval) return;
        _pollInterval = setInterval(function () {
            apiGet("/style_grid/check_update").then(function (r) {
                if (r && r.changed) {
                    ["txt2img", "img2img"].forEach(function (t) {
                        // Gate on v2 host handshake, not legacy .sg-overlay — otherwise apply-restore
                        // never runs on CSV changes while SG_STYLES_UPDATE still refreshes the iframe list.
                        if (state[t].sgV2HostInitSent) refreshPanel(t);
                        apiGet("/style_grid/styles").then(function (data) {
                            var styles = [];
                            if (Array.isArray(data)) {
                                styles = data;
                            } else if (data.categories) {
                                styles = Object.values(data.categories).flat();
                            } else if (data.styles) {
                                styles = data.styles;
                            }
                            state[t].categories = {};
                            styles.forEach(function (s) {
                                var cat = s.category || "OTHER";
                                if (!state[t].categories[cat]) state[t].categories[cat] = [];
                                state[t].categories[cat].push(s);
                            });
                            var frame = state[t] && state[t].sgFrame;
                            if (frame && frame.contentWindow) {
                                // Full list for v2: dedupe by name only in iframe when "All sources" (selectFilteredStyles).
                                var v2styles = Object.values(state[t].categories).flat();
                                frame.contentWindow.postMessage({
                                    type: "SG_STYLES_UPDATE",
                                    styles: v2styles
                                }, "*");
                            }
                        });
                    });
                }
            }).catch(function () {});
        }, 5000);
    }

export {
    loadStyles,
    loadThumbnailList,
    syncPanelHostState,
    refreshPanel,
    startPolling,
};
