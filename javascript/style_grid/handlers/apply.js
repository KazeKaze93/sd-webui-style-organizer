/** Style Grid host — apply / unapply / clear / rebuild (from events.js). */
"use strict";

import {
    state,
    styleIdentityKey,
    findStyleByName,
    findStyleByNameAndSource,
} from "../state.js";
import {
    removeSubstringFromPrompt,
    stripWrapOrTagsFromText,
    splitTopLevelCommas,
    setPromptValue,
} from "../prompt-utils.js";
import {
    qs,
    syncSelectionChrome,
} from "../render.js";
import {
    syncWildcards,
} from "./wildcards.js";

function syncSourceInput(tab) {
        var src = state[tab].selectedSourceFile || "";
        var elemId = tab === "txt2img" ? "style_grid_source_txt2img" : "style_grid_source_img2img";
        var el = gradioApp().querySelector("#" + elemId + " textarea");
        if (el && el.value !== src) {
            el.value = src;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }
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

export {
    syncSourceInput,
    applyStyleImmediate,
    stripLiveApplyFromTextareas,
    unapplyStyle,
    postClearSelectionToIframes,
    clearAll,
    rebuildPromptFromOrder,
};
