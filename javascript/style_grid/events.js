/** Style Grid host — thumbnails, apply, iframe bridge, boot (moved from style_grid.js). */
"use strict";

import {
    apiGet,
    apiPost,
    thumbIdentityKey,
} from "./api.js";
import {
    state,
    styleIdentityKey,
    parseStyleIdentityKey,
    getStoredSource,
    setStoredSource,
    migrateFavoritesInMemory,
    pushStyleIntoCategories,
    findStyleByName,
    findStyleByNameAndSource,
    getUniqueSources,
    _thumbVersions,
    _saveThumbVersions,
} from "./state.js";
import {
    removeSubstringFromPrompt,
    stripWrapOrTagsFromText,
    splitTopLevelCommas,
    setPromptValue,
} from "./prompt-utils.js";
import {
    qs,
    el,
    openStyleEditor,
    duplicateStyle,
    deleteStyle,
    moveToCategory,
    showExportImport,
    syncSelectionChrome,
    anySGFrameVisible,
    setHostPageScrollLock,
    injectButton,
    hooks,
} from "./render.js";

var WILDCARD_KIND_DICE = "sg";
var WILDCARD_KIND_DECK = "sgd";
var _batchState = { running: false, cancelled: false, skipped: false, jobId: null };
let _pollInterval = null;
var _sgForgeTabSyncInstalled = false;
var _sgForgeTabsObserver = null;
var _sgForgeTabsPendingRetry = null;

function syncSourceInput(tab) {
        var src = state[tab].selectedSourceFile || "";
        var elemId = tab === "txt2img" ? "style_grid_source_txt2img" : "style_grid_source_img2img";
        var el = gradioApp().querySelector("#" + elemId + " textarea");
        if (el && el.value !== src) {
            el.value = src;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

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

function normalizeWildcardKind(kind) {
        return String(kind || "").trim().toLowerCase() === WILDCARD_KIND_DECK
            ? WILDCARD_KIND_DECK
            : WILDCARD_KIND_DICE;
    }

function parseSgInner(inner) {
        var s = String(inner || "");
        var idx = s.indexOf(":");
        if (idx === -1) {
            return { category: s.trim(), spec: "" };
        }
        return { category: s.slice(0, idx).trim(), spec: s.slice(idx + 1).trim() };
    }

function buildSgToken(category, spec, kind) {
        var cat = String(category || "").toLowerCase();
        var sp = (spec === null || spec === undefined) ? "" : String(spec);
        var k = normalizeWildcardKind(kind);
        return "{" + k + ":" + cat + (sp ? ":" + sp : "") + "}";
    }

function extractWildcardCategories(str) {
        return [...(str || "").matchAll(/\{(sgd?):([^}]+)\}/gi)].map(function (m) {
            var parsed = parseSgInner(m[2]);
            return {
                category: parsed.category,
                spec: parsed.spec,
                kind: normalizeWildcardKind(m[1]),
                token: m[0],
            };
        });
    }

function activeWildcardCategories(text, negativeText) {
        var all = extractWildcardCategories(text).concat(extractWildcardCategories(negativeText));
        var seen = new Set();
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var entry = all[i];
            var key = String(entry.category || "").toLowerCase()
                + "\0" + String(entry.spec || "").toLowerCase()
                + "\0" + normalizeWildcardKind(entry.kind);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(entry);
            }
        }
        return result;
    }

function syncWildcards(tabName) {
        var promptEl = qs("#" + tabName + "_prompt textarea");
        var negEl = qs("#" + tabName + "_neg_prompt textarea");
        var categories = activeWildcardCategories(
            promptEl ? promptEl.value || "" : "",
            negEl ? negEl.value || "" : ""
        ).map(function (entry) {
            return {
                category: entry.category,
                spec: entry.spec,
                kind: normalizeWildcardKind(entry.kind),
            };
        });
        var frame = document.getElementById("sg-frame-" + tabName);
        if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: "SG_WILDCARDS_ACTIVE", categories: categories }, "*");
        }
    }

function removeWildcardCategory(tabName, category, spec, kind) {
        var promptEl = qs("#" + tabName + "_prompt textarea");
        var negEl = qs("#" + tabName + "_neg_prompt textarea");
        // Exact token from buildSgToken — slice vs whole-category and dice vs deck stay distinct
        // ({sg:cat} is not a substring of {sg:cat:spec} because of the closing brace).
        var token = buildSgToken(category, spec || "", kind);
        var tokenLower = token.toLowerCase();
        var strip = function (s) {
            s = s || "";
            var lower = s.toLowerCase();
            var out = "";
            var i = 0;
            while (i < s.length) {
                var idx = lower.indexOf(tokenLower, i);
                if (idx === -1) {
                    out += s.slice(i);
                    break;
                }
                out += s.slice(i, idx);
                i = idx + token.length;
            }
            // Drop emptied segments; keep neighbouring text in the same segment
            // (e.g. "{sg:bdsm}<lora:...>" → "<lora:...>"). Collapse doubled commas.
            return splitTopLevelCommas(out).map(function (t) {
                return t.trim();
            }).filter(function (t) {
                return t.length > 0;
            }).join(", ");
        };
        if (promptEl) setPromptValue(promptEl, strip(promptEl.value || ""));
        if (negEl) setPromptValue(negEl, strip(negEl.value || ""));
        syncWildcards(tabName);
    }

function reorderWildcardCategories(tabName, newOrder) {
        var promptEl = qs("#" + tabName + "_prompt textarea");
        var negEl = qs("#" + tabName + "_neg_prompt textarea");
        var order = Array.isArray(newOrder) ? newOrder : [];
        var wcRe = /^\{(sgd?):([^}]+)\}$/i;

        function orderKey(category, spec, kind) {
            return String(category || "").toLowerCase()
                + "\0" + String(spec || "").toLowerCase()
                + "\0" + normalizeWildcardKind(kind);
        }

        function reorderOne(text) {
            var tokens = splitTopLevelCommas(text || "");
            var present = {};
            var firstWcIdx = -1;
            var nonWildcards = [];
            for (var i = 0; i < tokens.length; i++) {
                var t = tokens[i];
                var m = wcRe.exec(t);
                if (m) {
                    if (firstWcIdx === -1) firstWcIdx = i;
                    var parsed = parseSgInner(m[2]);
                    present[orderKey(parsed.category, parsed.spec, m[1])] = true;
                } else {
                    nonWildcards.push(t);
                }
            }
            if (firstWcIdx === -1) return null;

            var reorderedWc = [];
            for (var j = 0; j < order.length; j++) {
                var item = order[j];
                if (!item || typeof item !== "object") continue;
                var cat = String(item.category || "").trim();
                var sp = (item.spec === null || item.spec === undefined) ? "" : String(item.spec);
                var kind = normalizeWildcardKind(item.kind);
                if (cat && present[orderKey(cat, sp, kind)]) {
                    reorderedWc.push(buildSgToken(cat, sp, kind));
                }
            }

            var beforeCount = firstWcIdx;
            return nonWildcards
                .slice(0, beforeCount)
                .concat(reorderedWc)
                .concat(nonWildcards.slice(beforeCount))
                .join(", ");
        }

        if (promptEl) {
            var nextP = reorderOne(promptEl.value || "");
            if (nextP !== null) setPromptValue(promptEl, nextP);
        }
        if (negEl) {
            var nextN = reorderOne(negEl.value || "");
            if (nextN !== null) setPromptValue(negEl, nextN);
        }
        syncWildcards(tabName);
    }

function applyStyleImmediate(tabName, styleName, opts) {
        opts = opts || {};
        var restoreOnly = opts.silent === true;
        var style = opts.source_file
            ? findStyleByNameAndSource(tabName, styleName, opts.source_file)
            : findStyleByName(tabName, styleName);
        if (!style && (opts.prompt !== undefined || opts.neg !== undefined)) {
            style = {
                name: styleName,
                prompt: opts.prompt || "",
                negative_prompt: opts.neg || "",
                source_file: opts.source_file || "",
            };
        } else if (style && (opts.prompt !== undefined || opts.neg !== undefined)) {
            style = Object.assign({}, style, {
                prompt: opts.prompt !== undefined ? opts.prompt : style.prompt,
                negative_prompt: opts.neg !== undefined ? opts.neg : style.negative_prompt,
            });
        }
        if (!style) return;
        var idKey = styleIdentityKey(style.name, style.source_file || opts.source_file || "");
        if (!restoreOnly && state[tabName].applied.has(idKey)) return;

        const promptEl = qs("#" + tabName + "_prompt textarea");
        const negEl = qs("#" + tabName + "_neg_prompt textarea");
        if (!promptEl || !negEl) return;

        if (!restoreOnly) {
            if (state[tabName].applied.size === 0) {
                state[tabName].userPromptBase = promptEl.value;
                state[tabName].userPromptBaseNeg = negEl.value;
            }
        }

        var snapshotPrompt;
        var snapshotNeg;
        var prompt;
        var neg;
        if (restoreOnly) {
            prompt = state[tabName]._restoreSimP;
            neg = state[tabName]._restoreSimN;
            snapshotPrompt = prompt;
            snapshotNeg = neg;
        } else {
            snapshotPrompt = promptEl.value;
            snapshotNeg = negEl.value;
            prompt = promptEl.value;
            neg = negEl.value;
        }
        let addedPrompt = "";
        let addedNeg = "";

        if (style.prompt) {
            if (style.prompt.includes("{prompt}")) {
                prompt = style.prompt.split("{prompt}").join(prompt);
                addedPrompt = null;
            } else {
                if (prompt === null || prompt === undefined) prompt = "";
                const existingNorm = {};
                (prompt.split(",").map(function (t) { return t.trim(); }).filter(Boolean)).forEach(function (t) { existingNorm[t.toLowerCase()] = true; });
                const toAdd = [];
                (style.prompt.split(",").map(function (t) { return t.trim(); }).filter(Boolean)).forEach(function (t) {
                    if (!existingNorm[t.toLowerCase()]) { toAdd.push(t); existingNorm[t.toLowerCase()] = true; }
                });
                addedPrompt = toAdd.length ? toAdd.join(", ") : "";
                if (addedPrompt) {
                    const sep = prompt.trim() ? ", " : "";
                    prompt = prompt.replace(/,\s*$/, "") + sep + addedPrompt;
                }
            }
        }
        if (style.negative_prompt) {
            if (style.negative_prompt.includes("{prompt}")) {
                neg = style.negative_prompt.split("{prompt}").join(neg);
                addedNeg = null;
            } else {
                if (neg === null || neg === undefined) neg = "";
                const existingNegNorm = {};
                (neg.split(",").map(function (t) { return t.trim(); }).filter(Boolean)).forEach(function (t) { existingNegNorm[t.toLowerCase()] = true; });
                const toAddNeg = [];
                (style.negative_prompt.split(",").map(function (t) { return t.trim(); }).filter(Boolean)).forEach(function (t) {
                    if (!existingNegNorm[t.toLowerCase()]) { toAddNeg.push(t); existingNegNorm[t.toLowerCase()] = true; }
                });
                addedNeg = toAddNeg.length ? toAddNeg.join(", ") : "";
                if (addedNeg) {
                    const sepN = neg.trim() ? ", " : "";
                    neg = neg.replace(/,\s*$/, "") + sepN + addedNeg;
                }
            }
        }

        const isPromptWrap = style.prompt && style.prompt.indexOf("{prompt}") !== -1;
        const isNegWrap = style.negative_prompt && style.negative_prompt.indexOf("{prompt}") !== -1;
        state[tabName].applied.set(idKey, {
            prompt: isPromptWrap ? null : addedPrompt,
            negative: isNegWrap ? null : addedNeg,
            wrapTemplate: isPromptWrap ? style.prompt : null,
            negWrapTemplate: isNegWrap ? style.negative_prompt : null,
            originalPrompt: isPromptWrap ? snapshotPrompt : null,
            originalNeg: isNegWrap ? snapshotNeg : null,
            source_file: style.source_file || "",
            name: style.name,
        });
        if (!restoreOnly) {
            if (!state[tabName].appliedNestOrder) state[tabName].appliedNestOrder = [];
            state[tabName].appliedNestOrder = state[tabName].appliedNestOrder.filter(function (n) {
                return n !== idKey;
            });
            state[tabName].appliedNestOrder.push(idKey);
        }
        if (restoreOnly) {
            state[tabName]._restoreSimP = prompt;
            state[tabName]._restoreSimN = neg;
        } else {
            setPromptValue(promptEl, prompt);
            setPromptValue(negEl, neg);
        }

        syncWildcards(tabName);
    }

function stripLiveApplyFromTextareas(tabName, styleName, record) {
        const promptEl = qs("#" + tabName + "_prompt textarea");
        const negEl = qs("#" + tabName + "_neg_prompt textarea");
        if (!promptEl || !negEl) return;

        if (record.wrapTemplate && record.originalPrompt !== null && record.originalPrompt !== undefined) {
            const parts = record.wrapTemplate.split("{prompt}");
            const prefix = (parts[0] || "").replace(/,\s*$/, "").trim();
            const suffix = (parts[1] || "").replace(/^,\s*/, "").trim();
            let current = promptEl.value.trim();
            if (prefix && current.indexOf(prefix) === 0) {
                current = current.slice(prefix.length).replace(/^,\s*/, "").trim();
            }
            if (suffix && current.lastIndexOf(suffix) === current.length - suffix.length) {
                current = current.slice(0, current.length - suffix.length).replace(/,\s*$/, "").trim();
            }
            setPromptValue(promptEl, current);
        } else if (record.prompt) {
            setPromptValue(promptEl, removeSubstringFromPrompt(promptEl.value, record.prompt));
        }

        if (record.negWrapTemplate && record.originalNeg !== null && record.originalNeg !== undefined) {
            const partsNeg = record.negWrapTemplate.split("{prompt}");
            const prefixNeg = (partsNeg[0] || "").replace(/,\s*$/, "").trim();
            const suffixNeg = (partsNeg[1] || "").replace(/^,\s*/, "").trim();
            let currentNeg = negEl.value.trim();
            if (prefixNeg && currentNeg.indexOf(prefixNeg) === 0) {
                currentNeg = currentNeg.slice(prefixNeg.length).replace(/^,\s*/, "").trim();
            }
            if (suffixNeg && currentNeg.lastIndexOf(suffixNeg) === currentNeg.length - suffixNeg.length) {
                currentNeg = currentNeg.slice(0, currentNeg.length - suffixNeg.length).replace(/,\s*$/, "").trim();
            }
            setPromptValue(negEl, currentNeg);
        } else if (record.negative) {
            setPromptValue(negEl, removeSubstringFromPrompt(negEl.value, record.negative));
        }
    }

function unapplyStyle(tabName, styleName, sourceFile) {
        var idKey = styleIdentityKey(styleName, sourceFile || "");
        var record = state[tabName].applied.get(idKey);
        if (!record && !sourceFile) {
            // Legacy bare-name applied map
            record = state[tabName].applied.get(styleName);
            if (record) idKey = styleName;
        }
        if (!record) {
            if (state[tabName].selected && (state[tabName].selected.has(idKey) || state[tabName].selected.has(styleName))) {
                state[tabName].selected.delete(idKey);
                state[tabName].selected.delete(styleName);
                state[tabName].selectedOrder = (state[tabName].selectedOrder || []).filter(function (n) {
                    return n !== idKey && n !== styleName;
                });
                syncSourceInput(tabName);
            }
            return;
        }

        stripLiveApplyFromTextareas(tabName, styleName, record);

        state[tabName].applied.delete(idKey);
        state[tabName].appliedNestOrder = (state[tabName].appliedNestOrder || []).filter(function (n) {
            return n !== idKey;
        });
        syncWildcards(tabName);
    }

function postClearSelectionToIframes(tabName) {
        var fr = document.getElementById("sg-frame-" + tabName);
        if (fr && fr.contentWindow) {
            fr.contentWindow.postMessage({ type: "SG_CLEAR_SELECTION" }, "*");
        }
    }

function startBatchThumbnails(tabName, catName, styles) {
       if (_batchState.running) {
           var frBusy = state[tabName] && state[tabName].sgFrame;
           if (frBusy && frBusy.contentWindow) {
               frBusy.contentWindow.postMessage({
                   type: "SG_TOAST",
                   message: "Batch generation already running",
                   variant: "error"
               }, "*");
           }
           return;
       }

       var queue = styles.filter(function (s) {
           return !state[tabName].hasThumbnail.has(thumbIdentityKey(s.name, s.source_file));
       });
       if (queue.length === 0) {
           var frEmpty = state[tabName] && state[tabName].sgFrame;
           if (frEmpty && frEmpty.contentWindow) {
               frEmpty.contentWindow.postMessage({
                   type: "SG_TOAST",
                   message: "All styles already have previews",
                   variant: "info"
               }, "*");
           }
           return;
       }

       _batchState = { running: true, cancelled: false, skipped: false, jobId: null };
       var total = queue.length;
       var done = 0;
       var failed = 0;
       var skipped = 0;

       // Build modal
       var overlay = el("div", { className: "sg-editor-overlay sg-batch-overlay" });
       var modal = el("div", { className: "sg-editor-modal" });
       var titleEl = el("h3", {
           className: "sg-editor-title",
           textContent: "🎨 Generating previews — " + catName
       });
       var progressText = el("div", {
           className: "sg-batch-progress-text",
           textContent: "Starting..."
       });
       var progressBar = el("div", { className: "sg-batch-bar-wrap" });
       var progressFill = el("div", { className: "sg-batch-bar-fill" });
       progressBar.appendChild(progressFill);

       function cancelCurrentJobThen(next) {
           var jobId = _batchState.jobId;
           _batchState.jobId = null;
           if (!jobId) {
               next();
               return;
           }
           var settled = false;
           function finish() {
               if (settled) return;
               settled = true;
               next();
           }
           apiPost("/style_grid/thumbnail/cancel", { job_id: jobId })
               .then(finish)
               .catch(finish);
           setTimeout(finish, 2000);
       }

       var btnRow = el("div", { className: "sg-editor-btns" });
       var skipBtn = el("button", {
           className: "sg-btn sg-btn-secondary",
           textContent: "⏭ Skip",
           onClick: function () {
               _batchState.skipped = true;
               cancelCurrentJobThen(function () {});
           }
       });
       var cancelBtn = el("button", {
           className: "sg-btn",
           style: "background:#dc2626; border-color:#dc2626; color:#fff;",
           textContent: "✕ Cancel",
           onClick: function () {
               _batchState.cancelled = true;
               cancelBtn.textContent = "Cancelling...";
               cancelBtn.disabled = true;
               cancelCurrentJobThen(function () {});
           }
       });
       btnRow.appendChild(skipBtn);
       btnRow.appendChild(cancelBtn);

       modal.appendChild(titleEl);
       modal.appendChild(progressText);
       modal.appendChild(progressBar);
       modal.appendChild(btnRow);
       overlay.appendChild(modal);
       // Do NOT close on overlay click — only Cancel
       document.body.appendChild(overlay);

       function updateProgress(current, styleName, status) {
           var pct = Math.round((current / total) * 100);
           progressFill.style.width = pct + "%";
           progressText.textContent = current + " / " + total +
               (styleName ? " — " + styleName.split("_").slice(1).join(" ") : "") +
               (status ? " (" + status + ")" : "");
       }

       function processNext(index) {
           if (_batchState.cancelled || index >= queue.length) {
               // Finished
               _batchState.running = false;
               _batchState.jobId = null;
               overlay.remove();
               var msg = "Done: " + done + "/" + total + " generated";
               if (failed > 0) msg += ", " + failed + " failed";
               if (skipped > 0) msg += ", " + skipped + " skipped";
               var frDone = state[tabName] && state[tabName].sgFrame;
               if (frDone && frDone.contentWindow) {
                   frDone.contentWindow.postMessage({
                       type: "SG_TOAST",
                       message: msg,
                       variant: "info"
                   }, "*");
               }
               loadThumbnailList(tabName);
               return;
           }

           var styleName = queue[index].name;
           var styleSourceFile = queue[index].source_file || "";
           _batchState.skipped = false;
           updateProgress(index + 1, styleName, "generating...");

           apiPost("/style_grid/thumbnail/generate", { name: styleName, source: styleSourceFile })
               .then(function (r) {
                   if (r.error || !r.job_id) {
                       failed++;
                       processNext(index + 1);
                       return;
                   }
                   _batchState.jobId = r.job_id;
                   pollBatchStatus(tabName, styleName, styleSourceFile, index, 0, r.job_id);
               })
               .catch(function () {
                   failed++;
                   processNext(index + 1);
               });
       }

       function pollBatchStatus(tabName2, styleName, styleSourceFile, index, attempts, jobId) {
           if (_batchState.cancelled) {
               cancelCurrentJobThen(function () {
                   _batchState.running = false;
                   overlay.remove();
                   var cancelMsg = "Cancelled. " + done + "/" + total + " completed.";
                   var frCancel = state[tabName2] && state[tabName2].sgFrame;
                   if (frCancel && frCancel.contentWindow) {
                       frCancel.contentWindow.postMessage({
                           type: "SG_TOAST",
                           message: cancelMsg,
                           variant: "info"
                       }, "*");
                   }
                   loadThumbnailList(tabName2);
               });
               return;
           }
           if (_batchState.skipped) {
               cancelCurrentJobThen(function () {
                   skipped++;
                   processNext(index + 1);
               });
               return;
           }
           if (attempts > 60) {
               _batchState.jobId = null;
               failed++;
               processNext(index + 1);
               return;
           }

           apiGet("/style_grid/thumbnail/gen_status?job_id=" +
               encodeURIComponent(jobId))
               .then(function (r) {
                   if (!r || r.detail === "Not Found" || r.status === undefined) {
                       _batchState.jobId = null;
                       failed++;
                       processNext(index + 1);
                       return;
                   }
                   if (r.status === "done") {
                       _batchState.jobId = null;
                       done++;
                       state[tabName2].hasThumbnail.add(thumbIdentityKey(styleName, styleSourceFile));
                       var batchThumbKey = thumbIdentityKey(styleName, styleSourceFile);
                       _thumbVersions[batchThumbKey] = Date.now();
                       localStorage.setItem("sg_thumb_v_" + batchThumbKey, _thumbVersions[batchThumbKey].toString());
                       _saveThumbVersions();
                       updateProgress(index + 1, styleName, "✓");
                       setTimeout(function () { processNext(index + 1); }, 300);
                   } else if (r.status === "error" || r.status === "cancelled") {
                       _batchState.jobId = null;
                       if (r.status === "cancelled") {
                           skipped++;
                       } else {
                           failed++;
                       }
                       processNext(index + 1);
                   } else if (r.status === "queued" || r.status === "running") {
                       setTimeout(function () {
                           pollBatchStatus(tabName2, styleName, styleSourceFile, index, attempts + 1, jobId);
                       }, 2000);
                   } else {
                       _batchState.jobId = null;
                       failed++;
                       processNext(index + 1);
                   }
               })
               .catch(function () {
                   _batchState.jobId = null;
                   failed++;
                   processNext(index + 1);
               });
       }

       processNext(0);
   }

function generateThumbnail(tabName, styleName, onDone, onProgress, sourceFile) {
        var resolvedSource = sourceFile || state[tabName].selectedSourceFile || "";
        if (typeof onProgress === "function") {
            onProgress("generating", 0);
        }

        apiPost("/style_grid/thumbnail/generate", { name: styleName, source: resolvedSource })
            .then(function (r) {
                if (r.error || !r.job_id) {
                    var failStartMsg = "Generation failed: " + (r.error || "missing job_id");
                    var frFailStart = state[tabName] && state[tabName].sgFrame;
                    if (frFailStart && frFailStart.contentWindow) {
                        frFailStart.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: failStartMsg,
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                pollGenerationStatus(tabName, styleName, 0, onDone, onProgress, resolvedSource, r.job_id);
            })
            .catch(function () {
                var frFailCatch = state[tabName] && state[tabName].sgFrame;
                if (frFailCatch && frFailCatch.contentWindow) {
                    frFailCatch.contentWindow.postMessage({
                        type: "SG_TOAST",
                        message: "Generation failed",
                        variant: "error"
                    }, "*");
                }
                if (typeof onProgress === "function") {
                    onProgress("error");
                }
            });
    }

function pollGenerationStatus(tabName, styleName, attempts, onDone, onProgress, sourceFile, jobId) {
        if (attempts > 60) {
            var frTimeout = state[tabName] && state[tabName].sgFrame;
            if (frTimeout && frTimeout.contentWindow) {
                frTimeout.contentWindow.postMessage({
                    type: "SG_TOAST",
                    message: "Generation timed out",
                    variant: "error"
                }, "*");
            }
            if (typeof onProgress === "function") {
                onProgress("error");
            }
            return;
        }
        apiGet("/style_grid/thumbnail/gen_status?job_id=" +
            encodeURIComponent(jobId))
            .then(function (r) {
                if (!r || r.detail === "Not Found" || r.status === undefined) {
                    var frNotFound = state[tabName] && state[tabName].sgFrame;
                    if (frNotFound && frNotFound.contentWindow) {
                        frNotFound.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: "Generation endpoint not found",
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                if (r.status === "done") {
                    var doneThumbKey = thumbIdentityKey(styleName, sourceFile);
                    state[tabName].hasThumbnail.add(doneThumbKey);
                    _thumbVersions[doneThumbKey] = Date.now();
                    localStorage.setItem("sg_thumb_v_" + doneThumbKey, _thumbVersions[doneThumbKey].toString());
                    _saveThumbVersions();
                    if (typeof onProgress === "function") {
                        onProgress("done", 100);
                    }
                    if (typeof onDone === "function") onDone(_thumbVersions[doneThumbKey]);
                } else if (r.status === "error" || r.status === "cancelled") {
                    var failPollMsg = r.status === "cancelled"
                        ? "Generation cancelled"
                        : ("Generation failed: " + (r.message || "unknown"));
                    var frFailPoll = state[tabName] && state[tabName].sgFrame;
                    if (frFailPoll && frFailPoll.contentWindow) {
                        frFailPoll.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: failPollMsg,
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                } else if (r.status === "queued" || r.status === "running") {
                    if (typeof onProgress === "function") {
                        onProgress("generating", Math.min(90, Math.round((attempts / 60) * 100)));
                    }
                    setTimeout(function () {
                        pollGenerationStatus(tabName, styleName, attempts + 1, onDone, onProgress, sourceFile, jobId);
                    }, 2000);
                } else {
                    var unknownMsg = "Unknown generation status: " + r.status;
                    var frUnknown = state[tabName] && state[tabName].sgFrame;
                    if (frUnknown && frUnknown.contentWindow) {
                        frUnknown.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: unknownMsg,
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                }
            })
            .catch(function () {
                var frUnavailable = state[tabName] && state[tabName].sgFrame;
                if (frUnavailable && frUnavailable.contentWindow) {
                    frUnavailable.contentWindow.postMessage({
                        type: "SG_TOAST",
                        message: "Generation status unavailable",
                        variant: "error"
                    }, "*");
                }
                if (typeof onProgress === "function") {
                    onProgress("error");
                }
            });
    }

function uploadThumbnail(tabName, styleName, sourceFile) {
        var resolvedSource = sourceFile || state[tabName].selectedSourceFile || "";
        var input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", function () {
            var file = input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                apiPost("/style_grid/thumbnail/upload", {
                    name: styleName,
                    image: reader.result,
                    source: resolvedSource
                })
                    .then(function (r) {
                        if (r.ok) {
                            var uploadThumbKey = thumbIdentityKey(styleName, resolvedSource);
                            state[tabName].hasThumbnail.add(uploadThumbKey);
                            _thumbVersions[uploadThumbKey] = Date.now();
                            localStorage.setItem("sg_thumb_v_" + uploadThumbKey, _thumbVersions[uploadThumbKey].toString());
                            _saveThumbVersions();
                            var fr = state[tabName] && state[tabName].sgFrame;
                            if (fr && fr.contentWindow) {
                                fr.contentWindow.postMessage({
                                    type: "SG_THUMB_DONE",
                                    styleId: styleName,
                                    version: _thumbVersions[uploadThumbKey],
                                    source_file: resolvedSource,
                                }, "*");
                            }
                        } else {
                            var failMsg = "Upload failed: " + (r.error || "?");
                            var frFail = state[tabName] && state[tabName].sgFrame;
                            if (frFail && frFail.contentWindow) {
                                frFail.contentWindow.postMessage({
                                    type: "SG_TOAST",
                                    message: failMsg,
                                    variant: "error"
                                }, "*");
                            }
                        }
                    })
                    .catch(function () {
                        var frCatch = state[tabName] && state[tabName].sgFrame;
                        if (frCatch && frCatch.contentWindow) {
                            frCatch.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: "Upload failed",
                                variant: "error"
                            }, "*");
                        }
                    });
            };
            reader.readAsDataURL(file);
        });
        input.click();
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

function clearAll(tabName) {
        var promptEl = qs("#" + tabName + "_prompt textarea");
        var negEl    = qs("#" + tabName + "_neg_prompt textarea");
        var p = promptEl ? (promptEl.value || "") : "";
        var n = negEl ? (negEl.value || "") : "";

        // Subtract what we added: unwind applied styles from live text (same strategy as rebuildPromptFromOrder).
        var nest = state[tabName].appliedNestOrder || [];
        for (var i = nest.length - 1; i >= 0; i--) {
            var unwindName = nest[i];
            var unwindRec = state[tabName].applied.get(unwindName);
            if (!unwindRec) continue;
            p = stripWrapOrTagsFromText(p, unwindRec.wrapTemplate, unwindRec.prompt);
            n = stripWrapOrTagsFromText(n, unwindRec.negWrapTemplate, unwindRec.negative);
        }

        var wcRe = /^\{(sgd?):([^}]+)\}$/i;
        var stripWildcardTokens = function (s) {
            return splitTopLevelCommas(s || "").map(function (t) { return t.trim(); }).filter(function (t) {
                return t && !wcRe.test(t);
            }).join(", ");
        };
        p = stripWildcardTokens(p);
        n = stripWildcardTokens(n);

        if (promptEl) setPromptValue(promptEl, p);
        if (negEl)    setPromptValue(negEl, n);

        state[tabName].selected.clear();
        state[tabName].selectedOrder = [];
        state[tabName].applied.clear();
        state[tabName].appliedNestOrder = [];

        syncSourceInput(tabName);
        syncSelectionChrome(tabName);
        syncWildcards(tabName);
        postClearSelectionToIframes(tabName);
    }

function rebuildPromptFromOrder(tabName) {
        const promptEl = qs("#" + tabName + "_prompt textarea");
        const negEl = qs("#" + tabName + "_neg_prompt textarea");
        if (!promptEl || !negEl) return;

        // Live-derived base: unwind current nesting from the live textareas.
        var nest = state[tabName].appliedNestOrder || [];
        var p = promptEl.value || "";
        var n = negEl.value || "";
        for (var i = nest.length - 1; i >= 0; i--) {
            var unwindName = nest[i];
            var unwindRec = state[tabName].applied.get(unwindName);
            if (!unwindRec) continue;
            p = stripWrapOrTagsFromText(p, unwindRec.wrapTemplate, unwindRec.prompt);
            n = stripWrapOrTagsFromText(n, unwindRec.negWrapTemplate, unwindRec.negative);
        }

        // Re-append in the new selectedOrder (filtered to still-applied styles).
        const order = state[tabName].selectedOrder || [];
        const orderedApplied = order.filter(function (name) { return state[tabName].applied.has(name); });
        orderedApplied.forEach(function (name) {
            const r = state[tabName].applied.get(name);
            if (!r) return;
            if (r.wrapTemplate) {
                p = r.wrapTemplate.split("{prompt}").join(p);
            } else if (r.prompt) {
                p = p + (p ? ", " : "") + r.prompt;
            }
            if (r.negWrapTemplate) {
                n = r.negWrapTemplate.split("{prompt}").join(n);
            } else if (r.negative) {
                n = n + (n ? ", " : "") + r.negative;
            }
        });
        setPromptValue(promptEl, p);
        setPromptValue(negEl, n);
        state[tabName].appliedNestOrder = orderedApplied.slice();
        syncWildcards(tabName);
    }

function getForgeUiRoot() {
        if (typeof gradioApp === "function") {
            try {
                var g = gradioApp();
                if (g) return g;
            } catch (_) { /* ignore */ }
        }
        return document;
    }

function forgeTabPanelVisible(root, sel) {
        var el = root.querySelector(sel);
        if (!el) return false;
        var st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        if (sel.indexOf("tab_txt2img") !== -1 || sel.indexOf("tab_img2img") !== -1) {
            if (el.classList && el.classList.contains("tabitem")) {
                var hidden = el.getAttribute("style") || "";
                if (hidden.indexOf("display: none") !== -1 || hidden.indexOf("display:none") !== -1) return false;
            }
        }
        return true;
    }

function detectActiveForgeMainTab() {
        var root = getForgeUiRoot();
        var txtOn = forgeTabPanelVisible(root, "#tab_txt2img");
        var imgOn = forgeTabPanelVisible(root, "#tab_img2img");
        if (txtOn && !imgOn) return "txt2img";
        if (imgOn && !txtOn) return "img2img";

        var nav = root.querySelector("#tabs > .tab-nav") || root.querySelector("#tabs .tab-nav") || root.querySelector(".tab-nav");
        if (nav) {
            var btns = nav.querySelectorAll("button");
            var i;
            for (i = 0; i < btns.length; i++) {
                var b = btns[i];
                var sel = b.classList && b.classList.contains("selected");
                var aria = b.getAttribute("aria-selected") === "true";
                if (!sel && !aria) continue;
                var label = ((b.textContent || "") + " " + (b.getAttribute("data-testid") || "")).toLowerCase();
                if (label.indexOf("img2img") !== -1) return "img2img";
                if (label.indexOf("txt2img") !== -1) return "txt2img";
            }
            if (btns.length >= 2) {
                for (i = 0; i < btns.length; i++) {
                    if (btns[i].classList && btns[i].classList.contains("selected")) {
                        return i === 0 ? "txt2img" : "img2img";
                    }
                }
            }
        }
        if (imgOn) return "img2img";
        return "txt2img";
    }

function postForgeHostTabToV2Frames(hostTab) {
        if (hostTab !== "txt2img" && hostTab !== "img2img") return;
        ["txt2img", "img2img"].forEach(function (t) {
            var fr = state[t] && state[t].sgFrame;
            if (fr && fr.contentWindow) {
                fr.contentWindow.postMessage({ type: "SG_HOST_TAB", tab: hostTab }, "*");
            }
        });
    }

function syncForgeHostTabToV2Frames() {
        var tab = detectActiveForgeMainTab();
        if (hooks.forgeTab.lastBroadcast === tab) return;
        hooks.forgeTab.lastBroadcast = tab;
        postForgeHostTabToV2Frames(tab);
    }

function scheduleSyncForgeHostTabToV2Frames() {
        syncForgeHostTabToV2Frames();
        setTimeout(syncForgeHostTabToV2Frames, 0);
        setTimeout(syncForgeHostTabToV2Frames, 120);
    }

function installForgeMainTabSyncForV2() {
        if (_sgForgeTabSyncInstalled) return;
        _sgForgeTabSyncInstalled = true;

        document.addEventListener("click", function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest("#tabs > .tab-nav") || t.closest("#tabs .tab-nav") || (t.closest && t.closest(".tab-nav"))) {
                scheduleSyncForgeHostTabToV2Frames();
            }
        }, true);

        function observeTabsEl(tabsEl) {
            if (!tabsEl || _sgForgeTabsObserver) return;
            _sgForgeTabsObserver = new MutationObserver(function () {
                scheduleSyncForgeHostTabToV2Frames();
            });
            _sgForgeTabsObserver.observe(tabsEl, {
                attributes: true,
                childList: true,
                subtree: true,
                attributeFilter: ["class", "style", "aria-selected"],
            });
        }

        function tryAttachTabsObserver() {
            var r = getForgeUiRoot();
            var tabsEl = r.querySelector("#tabs");
            if (tabsEl) {
                observeTabsEl(tabsEl);
                if (_sgForgeTabsPendingRetry) {
                    clearInterval(_sgForgeTabsPendingRetry);
                    _sgForgeTabsPendingRetry = null;
                }
                return true;
            }
            return false;
        }

        if (!tryAttachTabsObserver()) {
            _sgForgeTabsPendingRetry = setInterval(function () {
                tryAttachTabsObserver();
            }, 500);
            setTimeout(function () {
                if (_sgForgeTabsPendingRetry) {
                    clearInterval(_sgForgeTabsPendingRetry);
                    _sgForgeTabsPendingRetry = null;
                }
            }, 30000);
        }

        scheduleSyncForgeHostTabToV2Frames();
    }

function initSGFrame(tab) {
        var existing = document.getElementById("sg-frame-" + tab);
        if (existing) {
            return existing;
        }
        const frame = document.createElement("iframe");
        frame.id = "sg-frame-" + tab;
        // Query string busts stale index.html / iframe document cache after ui/dist updates (bump when shipping UI changes).
        frame.src = `/style_grid/ui?t=${Date.now()}`;
        var wrapper = document.createElement("div");
        wrapper.id = "sg-panel-wrapper-" + tab;
        wrapper.style.cssText = [
            "position:fixed",
            "top:80px",
            "right:16px",
            "left:auto",
            "width:1000px",
            "height:650px",
            "min-width:600px",
            "min-height:400px",
            "max-width:95vw",
            "max-height:90vh",
            "border:none",
            "border-radius:12px",
            "box-shadow:0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
            "z-index:10000",
            "display:none",
            "overflow:hidden",
            "resize:both",
        ].join(";");
        frame.style.cssText = "width:100%;height:100%;border:none;display:block;";
        document.body.appendChild(wrapper);
        wrapper.appendChild(frame);
        state[tab].sgFrameWrapper = wrapper;
        document.addEventListener("mousedown", function (e) {
            if (wrapper.style.display !== "block") return;
            var target = e.target;
            if (!target) return;
            if (target.closest && target.closest(".sg-trigger-btn")) return;
            if (target.closest && target.closest(".sg-editor-overlay, .sg-source-picker")) return;
            if (!wrapper.contains(target)) {
                wrapper.style.display = "none";
                setHostPageScrollLock(anySGFrameVisible());
            }
        }, true);
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && wrapper.style.display !== "none") {
                e.stopPropagation();
                wrapper.style.display = "none";
                setHostPageScrollLock(anySGFrameVisible());
            }
        }, true);

        frame.addEventListener("load", function () {
            setTimeout(function () {
                fetch("/style_grid/styles")
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var allStyles = Array.isArray(data) ? data : Object.values(data.categories || {}).flat();
                        if (!state[tab]) state[tab] = {};
                        if (!state[tab].categories) state[tab].categories = {};
                        allStyles.forEach(function (s) {
                            pushStyleIntoCategories(state[tab].categories, s);
                        });
                        if (frame.contentWindow) {
                            frame.contentWindow.postMessage({
                                type: "SG_INIT",
                                tab: tab,
                                styles: allStyles,
                            }, "*");
                        }
                    });
            }, 500);
        });

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

        return frame;
    }

function ensureSGFramesOnce() {
        if (!state.txt2img.sgFrame) state.txt2img.sgFrame = initSGFrame("txt2img");
        if (!state.img2img.sgFrame) state.img2img.sgFrame = initSGFrame("img2img");
        installForgeMainTabSyncForV2();
    }

function init() {
        let observer = null;

        function stopObserver() {
            if (observer) { observer.disconnect(); observer = null; }
        }

        function tryInject() {
            const t1 = !!qs("#sg_trigger_txt2img") || injectButton("txt2img");
            const t2 = !!qs("#sg_trigger_img2img") || injectButton("img2img");
            if (t1 && t2) {
                stopObserver(); // ← kill observer once both buttons are alive
                startPolling();
                return true;
            }
            return false;
        }

        function startObserver() {
            if (observer) return; // already watching
            observer = new MutationObserver(function() {
                // Only act if our buttons actually vanished
                if (!qs("#sg_trigger_txt2img") || !qs("#sg_trigger_img2img")) {
                    clearTimeout(observer._timer);
                    observer._timer = setTimeout(tryInject, 400);
                }
            });
            const root = qs("#gradio-app") || qs(".gradio-container") || document.body;
            observer.observe(root, { childList: true, subtree: true });
        }

        // Progressive delays for initial inject
        [800, 1500, 3000, 6000].forEach(function(d) {
            setTimeout(function() {
                if (!qs("#sg_trigger_txt2img") || !qs("#sg_trigger_img2img")) tryInject();
            }, d);
        });

        // Observer as safety net, not primary mechanism
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function() {
                setTimeout(startObserver, 500);
            });
        } else {
            setTimeout(startObserver, 500);
        }
    }

// Bind late hooks for render module
hooks.refreshPanel = refreshPanel;
hooks.ensureSGFramesOnce = ensureSGFramesOnce;
hooks.syncWildcards = syncWildcards;
hooks.scheduleSyncForgeHostTabToV2Frames = scheduleSyncForgeHostTabToV2Frames;

export {
    syncSourceInput,
    loadStyles,
    loadThumbnailList,
    normalizeWildcardKind,
    parseSgInner,
    buildSgToken,
    extractWildcardCategories,
    activeWildcardCategories,
    syncWildcards,
    removeWildcardCategory,
    reorderWildcardCategories,
    applyStyleImmediate,
    stripLiveApplyFromTextareas,
    unapplyStyle,
    postClearSelectionToIframes,
    startBatchThumbnails,
    generateThumbnail,
    pollGenerationStatus,
    uploadThumbnail,
    syncPanelHostState,
    refreshPanel,
    startPolling,
    clearAll,
    rebuildPromptFromOrder,
    getForgeUiRoot,
    forgeTabPanelVisible,
    detectActiveForgeMainTab,
    postForgeHostTabToV2Frames,
    syncForgeHostTabToV2Frames,
    scheduleSyncForgeHostTabToV2Frames,
    installForgeMainTabSyncForV2,
    initSGFrame,
    ensureSGFramesOnce,
    init,
};
