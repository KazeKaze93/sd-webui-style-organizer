/** Style Grid host — wildcard token helpers / sync (from events.js). */
"use strict";

import {
    setPromptValue,
    splitTopLevelCommas,
} from "../prompt-utils.js";
import {
    qs,
} from "../render.js";

var WILDCARD_KIND_DICE = "sg";
var WILDCARD_KIND_DECK = "sgd";

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

export {
    WILDCARD_KIND_DICE,
    WILDCARD_KIND_DECK,
    normalizeWildcardKind,
    parseSgInner,
    buildSgToken,
    extractWildcardCategories,
    activeWildcardCategories,
    syncWildcards,
    removeWildcardCategory,
    reorderWildcardCategories,
};
