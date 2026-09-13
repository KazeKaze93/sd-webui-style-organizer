/**
 * Style Grid - Visual grid/gallery style selector for Forge WebUI
 * v2.0 — Full-featured: silent mode, dynamic apply, presets,
 * conflict detection, context menu, inline editor, etc.
 * v2.0.1 — thumb cache (localStorage), popup 253x184, no remove-preview in menu
 */
(function () {
    "use strict";
    if (typeof window !== "undefined") {
        window.__SG_THUMB_VERSION = "2.0.1";
        window.SG = window.SG || {};
    }

    // ════════════════════════════════════════════════════
    // STATE + INIT (per-tab runtime; see STORAGE for persistence)
    // ════════════════════════════════════════════════════
    function createTabState() {
        return {
            selected: new Set(),
            selectedOrder: [],
            applied: new Map(),
            categories: {},
            panel: null,
            selectedSource: "All",
            /** Normalized path (forward slashes) when known — matches V2 `source_file`; same basename can exist in multiple dirs */
            selectedSourceFile: null,
            usage: {},
            presets: {},
            silentMode: false,
            userPromptBase: "",
            userPromptBaseNeg: "",
            appliedNestOrder: [],
            hasThumbnail: new Set(),
            sgFrame: null,
            sgFrameWrapper: null,
            sgV2HostInitSent: false,
        };
    }
    const state = {};
    ["txt2img", "img2img"].forEach(function (tab) {
        state[tab] = createTabState();
    });

    // ════════════════════════════════════════════════════
    // STORAGE (localStorage + server-backed preferences)
    // ════════════════════════════════════════════════════

    var _thumbVersions = (function () {
        try { return JSON.parse(localStorage.getItem("sg_thumb_versions") || "{}"); }
        catch (_) { return {}; }
    })();
    function _saveThumbVersions() {
        try { localStorage.setItem("sg_thumb_versions", JSON.stringify(_thumbVersions)); }
        catch (_) { }
    }

    const SOURCE_STORAGE_KEY = "sg_source";
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
    function getSilentMode(t) {
        try {
            const d = JSON.parse(localStorage.getItem("sg_silent") || "{}");
            return !!d[t];
        } catch (_) {
            return false;
        }
    }
    function setSilentMode(t, v) {
        try {
            const d = JSON.parse(localStorage.getItem("sg_silent") || "{}");
            d[t] = v;
            localStorage.setItem("sg_silent", JSON.stringify(d));
        } catch (_) { }
    }

    // Favorites (legacy sg_favorites — still remapped on rename)
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

    // Recent history
    function getRecentHistory(t) {
        try {
            return JSON.parse(localStorage.getItem("sg_recent_" + t) || "[]");
        } catch (_) {
            return [];
        }
    }

    /** Remap a style's local identity after a CSV rename (selection, applied, fav, recent). */
    function remapStyleNameReferences(tabName, oldName, newName) {
        if (!oldName || !newName || oldName === newName) return;
        var st = state[tabName];
        if (!st) return;

        if (st.selected && st.selected.has(oldName)) {
            st.selected.delete(oldName);
            st.selected.add(newName);
        }
        if (st.selectedOrder && st.selectedOrder.length) {
            st.selectedOrder = st.selectedOrder.map(function (n) {
                return n === oldName ? newName : n;
            });
        }
        if (st.applied && st.applied.has(oldName)) {
            var rec = st.applied.get(oldName);
            st.applied.delete(oldName);
            st.applied.set(newName, rec);
        }
        if (st.appliedNestOrder && st.appliedNestOrder.length) {
            st.appliedNestOrder = st.appliedNestOrder.map(function (n) {
                return n === oldName ? newName : n;
            });
        }

        var fav = getFavorites(tabName);
        if (fav.has(oldName)) {
            fav.delete(oldName);
            fav.add(newName);
            setFavorites(tabName, fav);
        }

        var recent = getRecentHistory(tabName);
        var recentChanged = false;
        var remappedRecent = [];
        var seenRecent = {};
        recent.forEach(function (n) {
            var next = (n === oldName) ? newName : n;
            if (n === oldName) recentChanged = true;
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

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------
    function qs(sel, root) {
        if (root) return root.querySelector(sel);
        var ga = (typeof gradioApp === "function") ? gradioApp() : null;
        return (ga || document).querySelector(sel);
    }
    function qsa(sel, root) { return (root || document).querySelectorAll(sel); }
    function el(tag, attrs, children) {
        const e = document.createElement(tag);
        if (attrs) Object.entries(attrs).forEach(function (kv) {
            const k = kv[0], v = kv[1];
            if (k === "className") e.className = v;
            else if (k === "textContent") e.textContent = v;
            else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
            else e.setAttribute(k, v);
        });
        if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
            if (typeof c === "string") e.appendChild(document.createTextNode(c));
            else if (c) e.appendChild(c);
        });
        return e;
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
    /** Prefer name+source_file match; fall back to name-only when source missing or no hit. */
    function findStyleByNameAndSource(t, name, sourceFile) {
        var want = String(sourceFile || "").replace(/\\/g, "/");
        if (!want) return findStyleByName(t, name);
        for (const styles of Object.values(state[t].categories)) {
            const f = styles.find(function (s) {
                return s.name === name && String(s.source_file || "").replace(/\\/g, "/") === want;
            });
            if (f) return f;
        }
        return findStyleByName(t, name);
    }
    /** Map selected styles → {name, source_file}[] for presets / silent Gradio.
     * Prefer selectedOrder (apply order); skip order entries not in selected;
     * append any selected names missing from order (same reconcile as syncSelectionChrome). */
    function selectedAsNameSourceEntries(tabName) {
        var selected = state[tabName].selected;
        var order = (state[tabName].selectedOrder || []).filter(function (n) {
            return selected.has(n);
        });
        selected.forEach(function (n) {
            if (order.indexOf(n) === -1) order.push(n);
        });
        return order.map(function (n) {
            var rec = state[tabName].applied.get(n);
            if (rec && rec.source_file) {
                return { name: n, source_file: rec.source_file };
            }
            var s = findStyleByName(tabName, n);
            return s
                ? { name: s.name, source_file: s.source_file || "" }
                : { name: n, source_file: "" };
        });
    }

    // ════════════════════════════════════════════════════
    // CONFLICTS / COMBOS (description parsing & chips)
    // ════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════
    // PROMPT ENGINE
    // ════════════════════════════════════════════════════
    function removeSubstringFromPrompt(val, sub) {
        if (!sub || !val) return val;
        const idx = val.indexOf(sub);
        if (idx === -1) return val;
        const before = val.substring(0, idx).replace(/,\s*$/, "");
        const after = val.substring(idx + sub.length).replace(/^,\s*/, "");
        if (before.trim() && after.trim()) return before.trimEnd() + ", " + after.trimStart();
        return (before + after).trim();
    }

    /** Strip one style's wrap template or tag delta from text (mirrors stripLiveApplyFromTextareas). */
    function stripWrapOrTagsFromText(text, wrapTemplate, tagDelta) {
        if (text === null || text === undefined) return "";
        if (wrapTemplate) {
            const parts = wrapTemplate.split("{prompt}");
            const prefix = (parts[0] || "").replace(/,\s*$/, "").trim();
            const suffix = (parts[1] || "").replace(/^,\s*/, "").trim();
            let current = String(text).trim();
            if (prefix && current.indexOf(prefix) === 0) {
                current = current.slice(prefix.length).replace(/^,\s*/, "").trim();
            }
            if (suffix && current.length >= suffix.length &&
                current.lastIndexOf(suffix) === current.length - suffix.length) {
                current = current.slice(0, current.length - suffix.length).replace(/,\s*$/, "").trim();
            }
            return current;
        }
        if (tagDelta) {
            return removeSubstringFromPrompt(text, tagDelta);
        }
        return text;
    }

    // Canonical copy in javascript/sg_prompt_utils.js — keep in sync (Forge loads this file only).
    /* eslint-disable no-unused-vars */
    function splitTopLevelCommas(s) {
        if (!s || !String(s).trim()) return [];
        var str = String(s);
        var parts = [];
        var parenDepth = 0;
        var braceDepth = 0;
        var cur = "";
        for (var i = 0; i < str.length; i++) {
            var c = str[i];
            if (c === "(") parenDepth++;
            else if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
            else if (c === "{") braceDepth++;
            else if (c === "}") braceDepth = Math.max(0, braceDepth - 1);
            if (c === "," && parenDepth === 0 && braceDepth === 0) {
                if (cur.trim()) parts.push(cur.trim());
                cur = "";
            } else {
                cur += c;
            }
        }
        if (cur.trim()) parts.push(cur.trim());
        return parts;
    }

    /** Remove outer layers of balanced parentheses, e.g. "((foo))" → "foo". */
    function stripParenLayers(s) {
        var t = String(s || "").trim();
        var changed = true;
        while (changed) {
            changed = false;
            if (t.length < 2 || t.charAt(0) !== "(" || t.charAt(t.length - 1) !== ")") break;
            var depth = 0;
            var wrapsWhole = true;
            for (var i = 0; i < t.length; i++) {
                var c = t.charAt(i);
                if (c === "(") depth++;
                else if (c === ")") {
                    depth--;
                    if (depth === 0 && i !== t.length - 1) {
                        wrapsWhole = false;
                        break;
                    }
                }
            }
            if (wrapsWhole && depth === 0) {
                t = t.slice(1, -1).trim();
                changed = true;
            }
        }
        return t;
    }

    function parseSegmentToTagged(seg) {
        var t = (seg || "").trim();
        if (!t) return null;
        var m = /^\(([\s\S]+?):([\d.]+)\)$/.exec(t);
        if (m) return { tag: m[1].trim(), weight: parseFloat(m[2]) };
        return { tag: t, weight: 1 };
    }

    function parseStylePromptTags(prompt) {
        return splitTopLevelCommas(prompt)
            .map(parseSegmentToTagged)
            .filter(function (x) { return x !== null; });
    }

    function formatScaledWeight(w, scale) {
        var nw = 1 + (w - 1) * scale;
        return String(+nw.toPrecision(10));
    }

    function scalePromptWeights(text, scale) {
        if (scale === 1) return text;
        var parts = splitTopLevelCommas(text);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].trim();
            if (!p) continue;
            if (p === "{prompt}") {
                out.push(p);
                continue;
            }
            var m = /^\(([\s\S]+?):([\d.]+)\)$/.exec(p);
            if (m) {
                if (scale === 0) continue;
                var w = parseFloat(m[2]);
                var nw = formatScaledWeight(w, scale);
                out.push("(" + m[1].trim() + ":" + nw + ")");
                continue;
            }
            if (scale === 0) continue;
            out.push("(" + p + ":" + scale + ")");
        }
        return out.join(", ");
    }
    /* eslint-enable no-unused-vars */

    function setPromptValue(el, value) {
        if (!el) return;
        // Use native setter to bypass framework interception
        var nativeSet = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
        );
        if (nativeSet && nativeSet.set) {
            nativeSet.set.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value
        }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function setSilentGradio(tabName) {
        var silentEl = qs("#style_grid_silent_" + tabName + " textarea");
        var names = state[tabName].silentMode ? selectedAsNameSourceEntries(tabName) : [];
        if (!silentEl) return;
        setPromptValue(silentEl, JSON.stringify(names));
        syncSourceInput(tabName);
    }
    function syncSourceInput(tab) {
        var src = state[tab].selectedSourceFile || "";
        var elemId = tab === "txt2img" ? "style_grid_source_txt2img" : "style_grid_source_img2img";
        var el = gradioApp().querySelector("#" + elemId + " textarea");
        if (el && el.value !== src) {
            el.value = src;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    // -----------------------------------------------------------------------
    // Load data from Gradio hidden component
    // -----------------------------------------------------------------------
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

    // ════════════════════════════════════════════════════
    // API CLIENT
    // ════════════════════════════════════════════════════
    // API helpers
    function apiPost(endpoint, data) {
        return fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data || {}),
        }).then(function (r) {
            return r.text().then(function (text) {
                var body = {};
                if (text) {
                    try {
                        body = JSON.parse(text);
                    } catch (_e) {
                        if (!r.ok) {
                            return Promise.reject(new Error("HTTP " + r.status));
                        }
                        return Promise.reject(new Error("Invalid JSON in response"));
                    }
                }
                if (!r.ok) {
                    var msg = (body && body.error) || (typeof body.detail === "string" ? body.detail : null);
                    if (!msg && body && Array.isArray(body.detail)) {
                        msg = body.detail.map(function (d) { return (d && d.msg) ? d.msg : ""; }).filter(Boolean).join("; ");
                    }
                    return Promise.reject(new Error(msg || ("HTTP " + r.status)));
                }
                return body;
            });
        });
    }

    function assertNoApiError(result) {
        if (result && result.error) {
            return Promise.reject(new Error(result.error));
        }
        return result;
    }
    function apiGet(endpoint) {
        return fetch(endpoint).then(function (r) { return r.json(); });
    }

    /** Canonical host-side thumbnail identity; must match list API name+source_file. */
    function thumbIdentityKey(name, sourceFile) {
        return String(name) + "::" + String(sourceFile || "");
    }

    // ════════════════════════════════════════════════════
    // THUMBNAILS
    // ════════════════════════════════════════════════════
    function loadThumbnailList(tabName) {
        apiGet("/style_grid/thumbnails/list")
            .then(function (data) {
                var entries = data.has_thumbnail || [];
                state[tabName].hasThumbnail = new Set(entries.map(function (e) {
                    return thumbIdentityKey(e.name, e.source_file);
                }));
                var panel = state[tabName].panel;
                if (!panel) return;
                qsa(".sg-card", panel).forEach(function (card) {
                    var name = card.getAttribute("data-style-name");
                    var styleRef = card._styleRef;
                    var sourceFile = styleRef && styleRef.source_file ? styleRef.source_file : "";
                    if (!sourceFile) {
                        // TODO: no source_file on card at paint — cannot resolve thumb identity
                        card.classList.remove("sg-has-thumb");
                        return;
                    }
                    card.classList.toggle(
                        "sg-has-thumb",
                        state[tabName].hasThumbnail.has(thumbIdentityKey(name, sourceFile))
                    );
                });
            })
            .catch(function () {});
    }

    function showStatusMessage(tabName, text, isError = false) {
        const panel = state[tabName].panel;
        if (!panel) return;
        const existing = qs(".sg-status-msg", panel);
        if (existing) existing.remove();
        const msg = el("div", {
            className: "sg-status-msg" + (isError ? " sg-status-error" : ""),
            textContent: text,
        });
        const footer = qs(".sg-footer", panel);
        if (footer) footer.prepend(msg);
        setTimeout(function () {
            msg.remove();
        }, 3000);
    }

    // ════════════════════════════════════════════════════
    // CONFLICT DETECTION
    // ════════════════════════════════════════════════════
    // Conflict detection (client-side quick check)

    // -----------------------------------------------------------------------
    // Wildcard {sg:category} / {sg:category:spec} tracking (sync chips ↔ prompt textareas)
    // -----------------------------------------------------------------------
    function parseSgInner(inner) {
        var s = String(inner || "");
        var idx = s.indexOf(":");
        if (idx === -1) {
            return { category: s.trim(), spec: "" };
        }
        return { category: s.slice(0, idx).trim(), spec: s.slice(idx + 1).trim() };
    }

    function buildSgToken(category, spec) {
        var cat = String(category || "").toLowerCase();
        var sp = (spec === null || spec === undefined) ? "" : String(spec);
        return "{sg:" + cat + (sp ? ":" + sp : "") + "}";
    }

    function extractWildcardCategories(str) {
        return [...(str || "").matchAll(/\{sg:([^}]+)\}/gi)].map(function (m) {
            var parsed = parseSgInner(m[1]);
            return { category: parsed.category, spec: parsed.spec, token: m[0] };
        });
    }

    function activeWildcardCategories(text, negativeText) {
        var all = extractWildcardCategories(text).concat(extractWildcardCategories(negativeText));
        var seen = new Set();
        var result = [];
        for (var i = 0; i < all.length; i++) {
            var entry = all[i];
            var key = String(entry.category || "").toLowerCase() + "\0" + String(entry.spec || "").toLowerCase();
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
            return { category: entry.category, spec: entry.spec };
        });
        var frame = document.getElementById("sg-frame-" + tabName);
        if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: "SG_WILDCARDS_ACTIVE", categories: categories }, "*");
        }
    }

    function removeWildcardCategory(tabName, category, spec) {
        var promptEl = qs("#" + tabName + "_prompt textarea");
        var negEl = qs("#" + tabName + "_neg_prompt textarea");
        var token = buildSgToken(category, spec || "").toLowerCase();
        var strip = function (s) {
            return splitTopLevelCommas(s || "").map(function (t) { return t.trim(); }).filter(function (t) {
                return t && t.toLowerCase() !== token;
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
        var wcRe = /^\{sg:([^}]+)\}$/i;

        function orderKey(category, spec) {
            return String(category || "").toLowerCase() + "\0" + String(spec || "").toLowerCase();
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
                    var parsed = parseSgInner(m[1]);
                    present[orderKey(parsed.category, parsed.spec)] = true;
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
                if (cat && present[orderKey(cat, sp)]) {
                    reorderedWc.push(buildSgToken(cat, sp));
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

    // -----------------------------------------------------------------------
    // Dynamic apply / unapply a single style
    // -----------------------------------------------------------------------
    function applyStyleImmediate(tabName, styleName, opts) {
        opts = opts || {};
        var restoreOnly = opts.silent === true;
        if (!restoreOnly && state[tabName].applied.has(styleName)) return;
        const style = opts.source_file
            ? findStyleByNameAndSource(tabName, styleName, opts.source_file)
            : findStyleByName(tabName, styleName);
        if (!style) return;

        if (state[tabName].silentMode) {
            // Silent: just track, don't touch prompt fields
            state[tabName].applied.set(styleName, {
                prompt: style.prompt || null,
                negative: style.negative_prompt || null,
                silent: true,
                source_file: style.source_file || "",
            });
            setSilentGradio(tabName);
            return;
        }

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
        state[tabName].applied.set(styleName, {
            prompt: isPromptWrap ? null : addedPrompt,
            negative: isNegWrap ? null : addedNeg,
            wrapTemplate: isPromptWrap ? style.prompt : null,
            negWrapTemplate: isNegWrap ? style.negative_prompt : null,
            originalPrompt: isPromptWrap ? snapshotPrompt : null,
            originalNeg: isNegWrap ? snapshotNeg : null,
            source_file: style.source_file || "",
        });
        if (!restoreOnly) {
            if (!state[tabName].appliedNestOrder) state[tabName].appliedNestOrder = [];
            state[tabName].appliedNestOrder = state[tabName].appliedNestOrder.filter(function (n) {
                return n !== styleName;
            });
            state[tabName].appliedNestOrder.push(styleName);
        }
        if (restoreOnly) {
            state[tabName]._restoreSimP = prompt;
            state[tabName]._restoreSimN = neg;
        } else {
            setPromptValue(promptEl, prompt);
            setPromptValue(negEl, neg);
        }

        // Mark cards
        qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) {
            c.classList.add("sg-applied");
        });
        syncWildcards(tabName);
    }

    window._sgApplyStyle = applyStyleImmediate;
    window._sgUnapplyStyle = unapplyStyle;

    /** Live-branch textarea cleanup shared by unapplyStyle and convertLiveAppliesToSilent. */
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

    /**
     * OFF→ON silent: strip live prompt deltas, mark records silent:true.
     * Does not call setSilentGradio — that must run after silentMode is true
     * (setSilentGradio writes [] while silentMode is false).
     */
    function convertLiveAppliesToSilent(tabName) {
        var toConvert = [];
        state[tabName].applied.forEach(function (rec, name) {
            if (!rec.silent) toConvert.push(name);
        });
        toConvert.forEach(function (name) {
            var record = state[tabName].applied.get(name);
            if (!record || record.silent) return;
            stripLiveApplyFromTextareas(tabName, name, record);
            var style = record.source_file
                ? findStyleByNameAndSource(tabName, name, record.source_file)
                : findStyleByName(tabName, name);
            state[tabName].applied.set(name, {
                prompt: style ? (style.prompt || null) : (record.prompt || null),
                negative: style ? (style.negative_prompt || null) : (record.negative || null),
                silent: true,
                source_file: (style && style.source_file) || record.source_file || "",
            });
        });
    }

    function unapplyStyle(tabName, styleName) {
        const record = state[tabName].applied.get(styleName);
        if (!record) {
            if (state[tabName].selected && state[tabName].selected.has(styleName)) {
                state[tabName].selected.delete(styleName);
                state[tabName].selectedOrder = (state[tabName].selectedOrder || []).filter(function (n) { return n !== styleName; });
                setSilentGradio(tabName);
            }
            return;
        }

        if (record.silent) {
            state[tabName].applied.delete(styleName);
            if (state[tabName].selected) state[tabName].selected.delete(styleName);
            state[tabName].selectedOrder = (state[tabName].selectedOrder || []).filter(function (n) { return n !== styleName; });
            state[tabName].appliedNestOrder = (state[tabName].appliedNestOrder || []).filter(function (n) { return n !== styleName; });
            setSilentGradio(tabName);
            qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-applied"); });
            syncWildcards(tabName);
            return;
        }

        stripLiveApplyFromTextareas(tabName, styleName, record);

        state[tabName].applied.delete(styleName);
        state[tabName].appliedNestOrder = (state[tabName].appliedNestOrder || []).filter(function (n) { return n !== styleName; });
        qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-applied"); });
        syncWildcards(tabName);
    }

    function clearHostSilentSelection(tabName) {
        state[tabName].selected = new Set();
        state[tabName].selectedOrder = [];
        var toClear = [];
        state[tabName].applied.forEach(function (rec, name) {
            if (rec.silent) toClear.push(name);
        });
        for (var i = 0; i < toClear.length; i++) {
            unapplyStyle(tabName, toClear[i]);
        }
    }

    function postClearSelectionToIframes(tabName) {
        // Optional tabName: post only to sg-frame-{tabName}. Omit to broadcast
        // both frames (silent-mode-off is global). clearAll is per-tab and must pass tabName.
        var ids = tabName
            ? ["sg-frame-" + tabName]
            : ["sg-frame-txt2img", "sg-frame-img2img"];
        ids.forEach(function (id) {
            var fr = document.getElementById(id);
            if (fr && fr.contentWindow) {
                fr.contentWindow.postMessage({ type: "SG_CLEAR_SELECTION" }, "*");
            }
        });
    }

   // THUMBNAILS (batch / generate / upload — context menu entry points below)
   var _batchState = { running: false, cancelled: false, skipped: false, jobId: null };

   function startBatchThumbnails(tabName, catName, styles) {
       if (_batchState.running) {
           showStatusMessage(tabName, "Batch generation already running", true);
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
           showStatusMessage(tabName, "All styles already have previews");
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
               showStatusMessage(tabName, msg);
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
                   showStatusMessage(tabName2, cancelMsg);
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
                       _thumbVersions[styleName] = Date.now();
                       localStorage.setItem("sg_thumb_v_" + styleName, _thumbVersions[styleName].toString());
                       _saveThumbVersions();
                       qsa('.sg-card[data-style-name="' +
                           CSS.escape(styleName) + '"]', state[tabName2].panel)
                           .forEach(function (c) {
                               var sf = c._styleRef && c._styleRef.source_file ? c._styleRef.source_file : "";
                               if (sf && sf === styleSourceFile) {
                                   c.classList.add("sg-has-thumb");
                               }
                           });
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
        showStatusMessage(tabName, "🎨 Generating preview for " +
            styleName.split("_").slice(1).join(" ") + "...");
        if (typeof onProgress === "function") {
            onProgress("generating", 0);
        }

        apiPost("/style_grid/thumbnail/generate", { name: styleName, source: resolvedSource })
            .then(function (r) {
                if (r.error || !r.job_id) {
                    showStatusMessage(tabName, "Generation failed: " + (r.error || "missing job_id"), true);
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                pollGenerationStatus(tabName, styleName, 0, onDone, onProgress, resolvedSource, r.job_id);
            })
            .catch(function () {
                showStatusMessage(tabName, "Generation failed", true);
                if (typeof onProgress === "function") {
                    onProgress("error");
                }
            });
    }

    function pollGenerationStatus(tabName, styleName, attempts, onDone, onProgress, sourceFile, jobId) {
        if (attempts > 60) {
            showStatusMessage(tabName, "Generation timed out", true);
            if (typeof onProgress === "function") {
                onProgress("error");
            }
            return;
        }
        apiGet("/style_grid/thumbnail/gen_status?job_id=" +
            encodeURIComponent(jobId))
            .then(function (r) {
                if (!r || r.detail === "Not Found" || r.status === undefined) {
                    showStatusMessage(tabName, "Generation endpoint not found", true);
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                if (r.status === "done") {
                    state[tabName].hasThumbnail.add(thumbIdentityKey(styleName, sourceFile));
                    _thumbVersions[styleName] = Date.now();
                    localStorage.setItem("sg_thumb_v_" + styleName, _thumbVersions[styleName].toString());
                    _saveThumbVersions();
                    qsa('.sg-card[data-style-name="' +
                        CSS.escape(styleName) + '"]',
                        state[tabName].panel)
                        .forEach(function (c) {
                            var sf = c._styleRef && c._styleRef.source_file ? c._styleRef.source_file : "";
                            if (sf && sf === sourceFile) {
                                c.classList.add("sg-has-thumb");
                            }
                        });
                    showStatusMessage(tabName, "✓ Preview ready!");
                    if (typeof onProgress === "function") {
                        onProgress("done", 100);
                    }
                    if (typeof onDone === "function") onDone(_thumbVersions[styleName]);
                } else if (r.status === "error" || r.status === "cancelled") {
                    showStatusMessage(tabName,
                        r.status === "cancelled"
                            ? "Generation cancelled"
                            : ("Generation failed: " + (r.message || "unknown")), true);
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
                    showStatusMessage(tabName, "Unknown generation status: " + r.status, true);
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                }
            })
            .catch(function () {
                showStatusMessage(tabName, "Generation status unavailable", true);
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
                            state[tabName].hasThumbnail.add(thumbIdentityKey(styleName, resolvedSource));
                            qsa('.sg-card[data-style-name="' +
                                CSS.escape(styleName) + '"]',
                                state[tabName].panel)
                                .forEach(function (c) {
                                    var sf = c._styleRef && c._styleRef.source_file ? c._styleRef.source_file : "";
                                    if (sf && sf === resolvedSource) {
                                        c.classList.add("sg-has-thumb");
                                    }
                                });
                            _thumbVersions[styleName] = Date.now();
                            localStorage.setItem("sg_thumb_v_" + styleName, _thumbVersions[styleName].toString());
                            _saveThumbVersions();
                            showStatusMessage(tabName, "Preview saved ✓");
                            var fr = state[tabName] && state[tabName].sgFrame;
                            if (fr && fr.contentWindow) {
                                fr.contentWindow.postMessage({
                                    type: "SG_THUMB_DONE",
                                    styleId: styleName,
                                    version: _thumbVersions[styleName],
                                    source_file: resolvedSource,
                                }, "*");
                            }
                        } else {
                            var failMsg = "Upload failed: " + (r.error || "?");
                            showStatusMessage(tabName, failMsg, true);
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
                        showStatusMessage(tabName, "Upload failed", true);
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

    // ════════════════════════════════════════════════════
    // UI: EDITOR / CONTEXT MENU
    // ════════════════════════════════════════════════════

    // -----------------------------------------------------------------------
    // Style editor modal
    // -----------------------------------------------------------------------
    function openStyleEditor(tabName, existingStyle, sourceFile) {
        const isNew = !existingStyle;
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });

        const title = el("h3", { textContent: isNew ? "Create New Style" : "Edit Style: " + (existingStyle ? existingStyle.name : ""), className: "sg-editor-title" });
        modal.appendChild(title);

        const nameInput = el("input", { className: "sg-editor-input", type: "text", placeholder: "Style name (e.g. BODY_Thicc)", value: existingStyle ? existingStyle.name : "" });
        const promptInput = el("textarea", { className: "sg-editor-textarea", placeholder: "Prompt (use {prompt} as placeholder)", rows: "4" });
        promptInput.value = existingStyle ? (existingStyle.prompt || "") : "";
        const negInput = el("textarea", { className: "sg-editor-textarea", placeholder: "Negative prompt", rows: "3" });
        negInput.value = existingStyle ? (existingStyle.negative_prompt || "") : "";

        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Name" }));
        modal.appendChild(nameInput);
        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Prompt" }));
        modal.appendChild(promptInput);
        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Negative Prompt" }));
        modal.appendChild(negInput);

        var descInput = el("textarea", {
            className: "sg-editor-textarea",
            placeholder: "Description. Use 'Combos: STYLE_X; CATEGORY_*' for recommendations.",
            rows: "3"
        });
        descInput.value = existingStyle ? (existingStyle.description || "") : "";

        modal.appendChild(el("label", {
            className: "sg-editor-label",
            textContent: "Description & Combos"
        }));
        modal.appendChild(descInput);

        const btnRow = el("div", { className: "sg-editor-btns" });
        btnRow.appendChild(el("button", {
            className: "sg-btn sg-btn-primary", textContent: "💾 Save",
            onClick: function () {
                const name = nameInput.value.trim();
                if (!name) { nameInput.style.borderColor = "#f87171"; return; }
                var isRename = !!(existingStyle && name !== existingStyle.name);
                var endpoint = isRename ? "/style_grid/style/rename" : "/style_grid/style/save";
                var payload = isRename
                    ? {
                        old_name: existingStyle.name,
                        new_name: name,
                        source: existingStyle.source,
                        prompt: promptInput.value,
                        negative_prompt: negInput.value,
                        description: descInput.value,
                    }
                    : {
                        name: name,
                        prompt: promptInput.value,
                        negative_prompt: negInput.value,
                        description: descInput.value,
                        source: existingStyle ? existingStyle.source : (sourceFile || null),
                    };
                apiPost(endpoint, payload).then(assertNoApiError).then(function () {
                    if (isRename) {
                        remapStyleNameReferences(tabName, existingStyle.name, name);
                    }
                    overlay.remove();
                    refreshPanel(tabName);
                    var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                    if (typeof notify === "function") notify();
                }).catch(function (err) {
                    var msg = (err && err.message) ? err.message : "Save failed";
                    showStatusMessage(tabName, msg, true);
                    var frSave = state[tabName] && state[tabName].sgFrame;
                    if (frSave && frSave.contentWindow) {
                        frSave.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: msg,
                            variant: "error"
                        }, "*");
                    }
                });
            }
        }));
        btnRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "Cancel",
            onClick: function () { overlay.remove(); }
        }));
        modal.appendChild(btnRow);
        overlay.appendChild(modal);
        var editorOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            editorOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (editorOverlayMouseDownTarget === overlay || editorOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            editorOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
        nameInput.focus();
    }



    function duplicateStyle(tabName, style, onDone) {
        const newName = style.name + "_copy";
        apiPost("/style_grid/style/save", {
            name: newName, prompt: style.prompt || "", negative_prompt: style.negative_prompt || "", source: style.source,
        }).then(assertNoApiError).then(function () {
            refreshPanel(tabName);
            var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
            if (typeof notify === "function") notify();
            if (typeof onDone === "function") onDone();
        }).catch(function () {});
    }

    function deleteStyle(tabName, styleName, source, onDeleted) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });
        modal.appendChild(el("h3", {
            className: "sg-editor-title",
            textContent: "Delete style?"
        }));
        modal.appendChild(el("p", {
            textContent: "\"" + styleName + "\" will be permanently removed from the CSV.",
            style: "font-size:13px; color: var(--body-text-color-subdued, #9ca3af);"
        }));
        const btns = el("div", { className: "sg-editor-btns" });
        btns.appendChild(el("button", {
            className: "sg-btn",
            style: "background:#dc2626; border-color:#dc2626; color:#fff;",
            textContent: "🗑️ Delete",
            onClick: function () {
                overlay.remove();
                apiPost("/style_grid/style/delete", { name: styleName, source: source })
                    .then(assertNoApiError)
                    .then(function () {
                        fetch("/style_grid/thumbnail?name=" + encodeURIComponent(styleName) + "&source=" + encodeURIComponent(source || ""), { method: "DELETE" }).catch(function () { /* best-effort, style delete already succeeded */ });
                        refreshPanel(tabName, { quietVanishedToast: true });
                        var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                        if (typeof notify === "function") notify();
                        if (typeof onDeleted === "function") onDeleted();
                    })
                    .catch(function () {
                        showStatusMessage(tabName, "Delete failed", true);
                        var frDel = state[tabName] && state[tabName].sgFrame;
                        if (frDel && frDel.contentWindow) {
                            frDel.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: "Delete failed",
                                variant: "error"
                            }, "*");
                        }
                    });
            }
        }));
        btns.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Cancel",
            onClick: function () { overlay.remove(); }
        }));
        modal.appendChild(btns);
        overlay.appendChild(modal);
        var deleteOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            deleteOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (deleteOverlayMouseDownTarget === overlay || deleteOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            deleteOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
    }

    function moveToCategory(tabName, style, onDone) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });

        modal.appendChild(el("h3", {
            className: "sg-editor-title",
            textContent: "Move to category"
        }));
        modal.appendChild(el("label", {
            className: "sg-editor-label",
            textContent: "New category name"
        }));
        const input = el("input", {
            className: "sg-editor-input",
            type: "text",
            value: style.category || "",
            placeholder: "New category name"
        });
        modal.appendChild(input);

        const btns = el("div", { className: "sg-editor-btns" });
        btns.appendChild(el("button", {
            className: "sg-btn sg-btn-primary",
            textContent: "Move",
            onClick: function () {
                const newCat = (input.value || "").trim();
                if (!newCat) { input.style.borderColor = "#f87171"; return; }
                const oldName = style.name;
                const rest = oldName.includes("_") ? oldName.split("_").slice(1).join("_") : oldName;
                const newName = newCat.toUpperCase() + "_" + rest;
                apiPost("/style_grid/style/delete", { name: oldName, source: style.source }).then(assertNoApiError).then(function () {
                    return apiPost("/style_grid/style/save", {
                        name: newName,
                        prompt: style.prompt,
                        negative_prompt: style.negative_prompt,
                        source: style.source
                    }).then(assertNoApiError);
                }).then(function () {
                    overlay.remove();
                    refreshPanel(tabName, { quietVanishedToast: true });
                    var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                    if (typeof notify === "function") notify();
                    if (typeof onDone === "function") onDone();
                }).catch(function () {
                    showStatusMessage(tabName, "Move failed", true);
                });
            }
        }));
        btns.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Cancel",
            onClick: function () { overlay.remove(); }
        }));

        modal.appendChild(btns);
        overlay.appendChild(modal);
        var moveOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            moveOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (moveOverlayMouseDownTarget === overlay || moveOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            moveOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
    }

    // -----------------------------------------------------------------------
    // Presets UI
    // -----------------------------------------------------------------------
    function loadPreset(tabName, presetName) {
        var p = (state[tabName].presets || {})[presetName];
        if (!p) return;
        var sgFrame = document.getElementById("sg-frame-" + tabName);
        const presetStyles = p.styles || [];
        presetStyles.forEach(function (entry) {
            var styleName;
            var styleObj;
            if (entry && typeof entry === "object") {
                styleName = entry.name;
                styleObj = findStyleByNameAndSource(tabName, styleName, entry.source_file || "");
            } else {
                styleName = entry;
                styleObj = findStyleByName(tabName, styleName);
            }
            if (!styleName) return;
            if (state[tabName].selected.has(styleName)) return;
            state[tabName].selected.add(styleName);
            state[tabName].selectedOrder.push(styleName);
            if (styleObj && styleObj.source_file) {
                applyStyleImmediate(tabName, styleName, { source_file: styleObj.source_file });
            } else {
                applyStyleImmediate(tabName, styleName);
            }
            qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) {
                c.classList.add("sg-selected");
                c.classList.add("sg-applied");
            });
            if (sgFrame && sgFrame.contentWindow) {
                if (styleObj) {
                    sgFrame.contentWindow.postMessage({ type: "SG_STYLE_APPLIED", style: styleObj }, "*");
                }
            }
        });
        syncSelectionChrome(tabName);
    }

    function showPresetsMenu(tabName) {
        const old = qs(".sg-presets-overlay");
        if (old) old.remove();

        apiGet("/style_grid/presets").then(function (presets) {
            state[tabName].presets = presets || {};
        }).catch(function () {}).then(function () {
        const overlay = el("div", { className: "sg-editor-overlay sg-presets-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });
        modal.appendChild(el("h3", { className: "sg-editor-title", textContent: "📦 Style Presets" }));

        // Save current as preset
        const saveRow = el("div", { className: "sg-presets-save-row" });
        const nameIn = el("input", { className: "sg-editor-input", type: "text", placeholder: "Preset name..." });
        const saveBtn = el("button", {
            className: "sg-btn sg-btn-primary", textContent: "💾 Save current",
            onClick: function () {
                const name = nameIn.value.trim();
                if (!name) return;
                apiPost("/style_grid/presets/save", { name: name, styles: selectedAsNameSourceEntries(tabName) }).then(function (r) {
                    state[tabName].presets = r.presets || {};
                    renderPresetsList();
                    nameIn.value = "";
                    var sgFrameSave = document.getElementById("sg-frame-" + tabName);
                    if (sgFrameSave && sgFrameSave.contentWindow) {
                        sgFrameSave.contentWindow.postMessage({ type: "SG_PRESETS_UPDATED" }, "*");
                    }
                }).catch(function () {});
            }
        });
        saveRow.appendChild(nameIn);
        saveRow.appendChild(saveBtn);
        modal.appendChild(saveRow);

        const list = el("div", { className: "sg-presets-list" });
        modal.appendChild(list);

        function renderPresetsList() {
            list.innerHTML = "";
            const presets = state[tabName].presets || {};
            Object.keys(presets).forEach(function (name) {
                const p = presets[name];
                const row = el("div", { className: "sg-preset-row" });
                row.appendChild(el("span", { className: "sg-preset-name", textContent: name + " (" + (p.styles || []).length + " styles)" }));
                row.appendChild(el("button", {
                    className: "sg-btn sg-btn-secondary", textContent: "Load",
                    onClick: function () {
                        loadPreset(tabName, p.name ?? name);
                        overlay.remove();
                    }
                }));
                row.appendChild(el("button", {
                    className: "sg-btn sg-btn-secondary", textContent: "🗑️",
                    onClick: function () {
                        apiPost("/style_grid/presets/delete", { name: name }).then(function (r) {
                            state[tabName].presets = r.presets || {};
                            renderPresetsList();
                            var sgFrameDel = document.getElementById("sg-frame-" + tabName);
                            if (sgFrameDel && sgFrameDel.contentWindow) {
                                sgFrameDel.contentWindow.postMessage({ type: "SG_PRESETS_UPDATED" }, "*");
                            }
                        }).catch(function () {});
                    }
                }));
                list.appendChild(row);
            });
            if (Object.keys(presets).length === 0) {
                list.appendChild(el("div", { className: "sg-preset-empty", textContent: "No presets saved yet" }));
            }
        }
        renderPresetsList();

        const closeBtn = el("button", { className: "sg-btn sg-btn-secondary", textContent: "Close", onClick: function () { overlay.remove(); } });
        modal.appendChild(closeBtn);
        overlay.appendChild(modal);
        var presetsOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            presetsOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (presetsOverlayMouseDownTarget === overlay || presetsOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            presetsOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
        });
    }

    // -----------------------------------------------------------------------
    // Import/Export
    // -----------------------------------------------------------------------
    function showExportImport(tabName) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });
        modal.appendChild(el("h3", { className: "sg-editor-title", textContent: "📥 Import / Export" }));

        const btnExport = el("button", {
            className: "sg-btn sg-btn-primary", textContent: "⬇️ Export all (JSON)",
            onClick: function () {
                apiGet("/style_grid/export").then(function (data) {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "style_grid_export_" + new Date().toISOString().slice(0, 10) + ".json";
                    a.click();
                }).catch(function () {});
            }
        });
        modal.appendChild(btnExport);

        const importLabel = el("label", { className: "sg-editor-label", textContent: "Import JSON file:" });
        const importInput = el("input", { type: "file", accept: ".json" });
        importInput.addEventListener("change", function () {
            const file = importInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const data = JSON.parse(reader.result);
                    fetch("/style_grid/import", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(data),
                    }).then(function (r) {
                        return r.text().then(function (text) {
                            var body = {};
                            if (text) {
                                try {
                                    body = JSON.parse(text);
                                } catch (_e) {
                                    if (!r.ok) {
                                        return Promise.reject(new Error("HTTP " + r.status));
                                    }
                                    return Promise.reject(new Error("Invalid JSON in response"));
                                }
                            }
                            if (!r.ok || (body && body.error)) {
                                var msg = (body && body.error) || ("HTTP " + r.status);
                                if (body && Array.isArray(body.collisions) && body.collisions.length) {
                                    msg += "\n\nColliding names: " + body.collisions.join(", ");
                                }
                                return Promise.reject(new Error(msg));
                            }
                            return body;
                        });
                    }).then(function () {
                        overlay.remove();
                        refreshPanel(tabName);
                        var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                        if (typeof notify === "function") notify();
                    }).catch(function (err) {
                        alert((err && err.message) ? err.message : "Import failed");
                    });
                } catch (_e) { alert("Invalid JSON file"); }
            };
            reader.readAsText(file);
        });
        modal.appendChild(importLabel);
        modal.appendChild(importInput);

        modal.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "Close", onClick: function () { overlay.remove(); } }));
        overlay.appendChild(modal);
        var importExportOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            importExportOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (importExportOverlayMouseDownTarget === overlay || importExportOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            importExportOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
    }

    // -----------------------------------------------------------------------
    // Refresh panel (rebuild from API data)
    // -----------------------------------------------------------------------
    /**
     * Host-state half of a panel refresh: Gradio/localStorage/network → state[tab],
     * with no DOM construction.
     * loadThumbnailList stays fire-and-forget (does not block paint).
     */
    function syncPanelHostState(tabName) {
        var categories = loadStyles(tabName);
        state[tabName].categories = categories;
        state[tabName].silentMode = getSilentMode(tabName);

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
                qsa('.sg-card[data-style-name="' + CSS.escape(n) + '"]', state[tabName].panel).forEach(function (c) {
                    c.classList.add("sg-selected");
                    c.classList.add("sg-applied");
                });
            });
            // Selection insertion order (appliedOrder was never written — dead branch removed).
            var restoreOrder = [];
            savedSelection.forEach(function (n) { restoreOrder.push(n); });

            // Live-derived base: unwind current nesting before clearing applied records.
            if (!state[tabName].silentMode) {
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
            }

            // Snapshot before clear: vanished styles (delete/move/CSV gone) need these deltas to strip live text.
            var appliedSnapshot = new Map(state[tabName].applied);
            var preClearNestOrder = (state[tabName].appliedNestOrder || []).slice();

            state[tabName].applied.clear();
            restoreOrder.forEach(function (n) {
                applyStyleImmediate(tabName, n, { silent: true });
            });
            // Silent replay does not push nest; align nest to what actually restored (drops missing CSV styles).
            state[tabName].appliedNestOrder = restoreOrder.filter(function (name) {
                return state[tabName].applied.has(name);
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
                if (!state[tabName].silentMode) {
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
                            if (!goneRec || goneRec.silent) continue;
                            liveP = stripWrapOrTagsFromText(liveP, goneRec.wrapTemplate, goneRec.prompt);
                            liveN = stripWrapOrTagsFromText(liveN, goneRec.negWrapTemplate, goneRec.negative);
                        }
                        if (liveP !== beforeP || liveN !== beforeN) {
                            setPromptValue(livePromptEl, liveP);
                            setPromptValue(liveNegEl, liveN);
                            didStripLive = true;
                        }
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
                            if (!toastRec || toastRec.silent) continue;
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

            if (!state[tabName].silentMode) {
                delete state[tabName]._restoreSimP;
                delete state[tabName]._restoreSimN;
            }
            syncSelectionChrome(tabName);
        }).catch(function () {
            showStatusMessage(tabName, "Refresh failed", true);
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

    // -----------------------------------------------------------------------
    // Dynamic polling for file changes
    // -----------------------------------------------------------------------
    let _pollInterval = null;
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

    // ════════════════════════════════════════════════════
    // UI: PANEL
    // ════════════════════════════════════════════════════
    // Build the Grid Panel
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Build a category section
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Search autocomplete suggestions
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Interaction handlers
    // -----------------------------------------------------------------------

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

        var wcRe = /^\{sg:([^}]+)\}$/i;
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

        if (state[tabName].panel) {
            qsa(".sg-card.sg-selected, .sg-card.sg-applied", state[tabName].panel).forEach(function (c) { c.classList.remove("sg-selected"); c.classList.remove("sg-applied"); });
        }
        setSilentGradio(tabName);
        syncSelectionChrome(tabName);
        syncWildcards(tabName);
        postClearSelectionToIframes(tabName);
    }

    function rebuildPromptFromOrder(tabName) {
        if (state[tabName].silentMode) {
            setSilentGradio(tabName);
            return;
        }
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

    /**
     * Live selection chrome: keep selectedOrder aligned with selected, update trigger badge.
     */
    function syncSelectionChrome(tabName) {
        let order = state[tabName].selectedOrder || [];
        order = order.filter(function (n) { return state[tabName].selected.has(n); });
        state[tabName].selected.forEach(function (n) {
            if (order.indexOf(n) === -1) order.push(n);
        });
        state[tabName].selectedOrder = order;

        const count = state[tabName].selected.size;
        const badge = qs("#sg_btn_badge_" + tabName);
        if (badge) {
            badge.textContent = count > 0 ? count : "";
            badge.style.display = count > 0 ? "flex" : "none";
        }
    }

    // -----------------------------------------------------------------------
    // Style Grid v2 iframe — push SG_INIT to frame when needed
    // -----------------------------------------------------------------------
    function postSGInitToFrame(tabName) {
        var fr = state[tabName].sgFrame;
        if (!fr || !fr.contentWindow) return;
        fetch("/style_grid/styles")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var styles = Array.isArray(data)
                    ? data
                    : Object.values(data.categories || {}).flat();
                fr.contentWindow.postMessage({
                    type: "SG_INIT",
                    tab: tabName,
                    styles: styles,
                    silentMode: !!getSilentMode(tabName),
                }, "*");
                state[tabName].sgV2HostInitSent = true;
            })
            .catch(function () {});
    }

    // -----------------------------------------------------------------------
    // A1111 / Gradio: visible txt2img vs img2img main tab → v2 iframe header badge
    // -----------------------------------------------------------------------
    var _sgForgeTabSyncInstalled = false;
    var _sgLastBroadcastForgeTab = null;
    var _sgForgeTabsObserver = null;
    var _sgForgeTabsPendingRetry = null;

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
        if (_sgLastBroadcastForgeTab === tab) return;
        _sgLastBroadcastForgeTab = tab;
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

    // -----------------------------------------------------------------------
    // Toggle panel visibility
    // -----------------------------------------------------------------------
    var _sgHostPrevBodyOverflow = "";
    var _sgHostPrevDocOverflow = "";
    var _sgHostScrollLocked = false;
    function anySGFrameVisible() {
        return ["txt2img", "img2img"].some(function (t) {
            var fr = state[t] && state[t].sgFrame;
            var wr = state[t] && state[t].sgFrameWrapper;
            var target = wr || fr;
            return !!(target && target.style.display === "block");
        });
    }
    function setHostPageScrollLock(lock) {
        if (lock && !_sgHostScrollLocked) {
            _sgHostPrevBodyOverflow = document.body ? document.body.style.overflow : "";
            _sgHostPrevDocOverflow = document.documentElement ? document.documentElement.style.overflow : "";
            if (document.body) document.body.style.overflow = "hidden";
            if (document.documentElement) document.documentElement.style.overflow = "hidden";
            _sgHostScrollLocked = true;
            return;
        }
        if (!lock && _sgHostScrollLocked) {
            if (document.body) document.body.style.overflow = _sgHostPrevBodyOverflow || "";
            if (document.documentElement) document.documentElement.style.overflow = _sgHostPrevDocOverflow || "";
            _sgHostScrollLocked = false;
        }
    }

    function togglePanel(tabName, show) {
        var panel = state[tabName].panel;
        if (!state[tabName].sgFrame) ensureSGFramesOnce();
        var fr = state[tabName].sgFrame;
        var wr = state[tabName].sgFrameWrapper;
        if (!fr) {
            return;
        }
        if (!wr && fr.parentElement && fr.parentElement.id === "sg-panel-wrapper-" + tabName) {
            wr = fr.parentElement;
            state[tabName].sgFrameWrapper = wr;
        }
        var target = wr || fr;
        if (typeof show === "undefined") show = target.style.display !== "block";
        if (!show) {
            if (panel) panel.classList.remove("sg-visible");
            target.style.display = "none";
            setHostPageScrollLock(anySGFrameVisible());
            return;
        }
        if (panel && panel.classList.contains("sg-visible")) panel.classList.remove("sg-visible");
        target.style.display = "block";
        setHostPageScrollLock(true);
        syncWildcards(tabName);
        if (!state[tabName].sgV2HostInitSent) postSGInitToFrame(tabName);
        _sgLastBroadcastForgeTab = null;
        scheduleSyncForgeHostTabToV2Frames();
    }

    // -----------------------------------------------------------------------
    // Trigger button
    // -----------------------------------------------------------------------
    function createTriggerButton(tabName) {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttributeNS(null, "viewBox", "0 0 24 24");
        svg.setAttributeNS(null, "fill", "none");
        svg.setAttributeNS(null, "stroke", "currentColor");
        svg.setAttributeNS(null, "stroke-width", "2");
        svg.setAttributeNS(null, "stroke-linecap", "round");
        svg.setAttributeNS(null, "stroke-linejoin", "round");
        svg.setAttributeNS(null, "width", "16");
        svg.setAttributeNS(null, "height", "16");
        [[3, 3, 7, 7], [14, 3, 7, 7], [3, 14, 7, 7], [14, 14, 7, 7]].forEach(function (xywh) {
            const rect = document.createElementNS(ns, "rect");
            rect.setAttributeNS(null, "x", String(xywh[0]));
            rect.setAttributeNS(null, "y", String(xywh[1]));
            rect.setAttributeNS(null, "width", String(xywh[2]));
            rect.setAttributeNS(null, "height", String(xywh[3]));
            svg.appendChild(rect);
        });
        const btn = el("button", {
            className: "sg-trigger-btn lg secondary gradio-button tool svelte-cmf5ev",
            id: "sg_trigger_" + tabName, title: "Open Style Grid",
        });
        btn.appendChild(svg);
        const badge = el("span", { className: "sg-btn-badge", id: "sg_btn_badge_" + tabName });
        badge.style.display = "none";
        btn.appendChild(badge);
        btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(tabName); });
        return btn;
    }

    function getStyleGridToolbarHost() {
        var root = (typeof gradioApp === "function" ? gradioApp() : null) || document;
        return root.querySelector(".forge-toolbar-container")
            || root.querySelector("#quicksettings")
            || root.querySelector(".gradio-container .top-row")
            || null;
    }

    function injectButton(tabName) {
        const selectors = [
            "#" + tabName + "_tools",
            "#" + tabName + "_styles_row",
            "#" + tabName + "_actions_column .style_create_row",
            "#" + tabName + "_actions_column",
        ];
        let target = null;
        for (let i = 0; i < selectors.length; i++) { target = qs(selectors[i]); if (target) break; }
        if (!target) {
            const dd = qs("#" + tabName + "_styles_row") || qs("#" + tabName + "_styles");
            if (dd) target = dd.parentElement;
        }
        if (!target) {
            const tab = qs("#tab_" + tabName);
            if (tab) { const btns = tab.querySelectorAll(".tool"); if (btns.length > 0) target = btns[btns.length - 1].parentElement; }
        }
        if (!target) {
            var toolbarHost = getStyleGridToolbarHost();
            if (!toolbarHost) return false;
            const btnToolbar = createTriggerButton(tabName);
            btnToolbar.classList.add("sg-trigger-btn--toolbar-host");
            toolbarHost.appendChild(btnToolbar);
            return true;
        }
        const btn = createTriggerButton(tabName);
        if (target.id && target.id.includes("tools")) {
            var toolsEl = target;
            var formEl = toolsEl.querySelector(":scope > div.form, :scope > div[style*='flex']");
            (formEl || toolsEl).appendChild(btn);
        } else if (target.classList.contains("style_create_row")) target.appendChild(btn);
        else target.parentNode.insertBefore(btn, target.nextSibling);
        return true;
    }

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            ["txt2img", "img2img"].forEach(function (t) {
                var frEsc = state[t].sgFrame;
                var wrEsc = state[t].sgFrameWrapper || (frEsc && frEsc.parentElement && frEsc.parentElement.id === "sg-panel-wrapper-" + t ? frEsc.parentElement : null);
                var targetEsc = wrEsc || frEsc;
                if (targetEsc && targetEsc.style.display === "block") {
                    targetEsc.style.display = "none";
                    setHostPageScrollLock(anySGFrameVisible());
                    e.preventDefault();
                    return;
                }
            });
        }
    });

    // ════════════════════════════════════════════════════
    // STATE + INIT (boot, triggers, MutationObserver)
    // ════════════════════════════════════════════════════
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
                            var cat = s.category || "OTHER";
                            if (!state[tab].categories[cat]) state[tab].categories[cat] = [];
                            var exists = state[tab].categories[cat].some(function (x) {
                                return x.name === s.name;
                            });
                            if (!exists) state[tab].categories[cat].push(s);
                        });
                        if (frame.contentWindow) {
                            frame.contentWindow.postMessage({
                                type: "SG_INIT",
                                tab: tab,
                                styles: allStyles,
                                silentMode: !!getSilentMode(tab),
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
                            var cat = s.category || "OTHER";
                            if (!state[tab].categories[cat]) state[tab].categories[cat] = [];
                            var exists = state[tab].categories[cat].some(function (x) {
                                return x.name === s.name;
                            });
                            if (!exists) state[tab].categories[cat].push(s);
                        });
                        frame.contentWindow.postMessage({
                            type: "SG_INIT",
                            tab: tab,
                            styles: allStyles,
                            silentMode: !!getSilentMode(tab),
                        }, "*");
                        state[tab].sgV2HostInitSent = true;
                    })
                    .catch(function () {});
            }

            if (msg.type === "SG_APPLY") {
                if (msg.silent) {
                    if (!state[tab].selected) state[tab].selected = new Set();
                    state[tab].selected.add(msg.styleId);
                    state[tab].selectedOrder = state[tab].selectedOrder || [];
                    if (state[tab].selectedOrder.indexOf(msg.styleId) === -1) {
                        state[tab].selectedOrder.push(msg.styleId);
                    }
                    state[tab].silentMode = true;
                    setSilentMode(tab, true);
                } else {
                    state[tab].silentMode = false;
                    setSilentMode(tab, false);
                    if (!state[tab].selected) state[tab].selected = new Set();
                    state[tab].selected.add(msg.styleId);
                    state[tab].selectedOrder = state[tab].selectedOrder || [];
                    if (state[tab].selectedOrder.indexOf(msg.styleId) === -1) {
                        state[tab].selectedOrder.push(msg.styleId);
                    }
                }
                window._sgApplyStyle(tab, msg.styleId, {
                    silent: msg.silent,
                    source_file: msg.source_file,
                });
                setSilentGradio(tab);
            }

            if (msg.type === "SG_UNAPPLY") {
                if (state[tab] && state[tab].selected) {
                    state[tab].selected.delete(msg.styleId);
                    state[tab].selectedOrder = (state[tab].selectedOrder || []).filter(function (n) { return n !== msg.styleId; });
                }
                window._sgUnapplyStyle(tab, msg.styleId);
            }

            if (msg.type === "SG_TOGGLE_SILENT") {
                var t = msg.tab || tab;
                if (state[t]) {
                    if (msg.value) {
                        convertLiveAppliesToSilent(t);
                    }
                    state[t].silentMode = msg.value;
                    setSilentMode(t, msg.value);
                    if (!msg.value) {
                        clearHostSilentSelection(t);
                        postClearSelectionToIframes();
                    }
                    setSilentGradio(t);
                }
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

            if (msg.type === "SG_RANDOM") {
                var allStyles = Object.values((state[tab] && state[tab].categories) || {}).flat();
                if (allStyles.length > 0) {
                    var randomStyle = allStyles[Math.floor(Math.random() * allStyles.length)];
                    window._sgApplyStyle(tab, randomStyle.name);
                    if (frame.contentWindow) {
                        frame.contentWindow.postMessage({
                            type: "SG_STYLE_APPLIED",
                            style: randomStyle
                        }, "*");
                    }
                }
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
            if (msg.type === "SG_LOAD_PRESET") {
                var presetName = msg.name;
                var tabName = tab;
                var existing = (state[tabName].presets || {})[presetName];
                if (existing) {
                    loadPreset(tabName, presetName);
                } else {
                    fetch('/style_grid/presets/list')
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            state[tabName].presets = data || {};
                            loadPreset(tabName, presetName);
                        });
                }
            }
            if (msg.type === "SG_PRESETS") {
                showPresetsMenu(tab);
            }
            if (msg.type === "SG_IMPORT_EXPORT") {
                showExportImport(tab);
            }
            if (msg.type === "SG_NEW_STYLE") {
                openStyleEditor(tab, null, msg.sourceFile);
            }
            if (msg.type === "SG_EDIT_STYLE") {
                var styleToEdit = findStyleByName(msg.styleId);
                if (styleToEdit) {
                    openStyleEditor(tab, styleToEdit);
                }
            }
            if (msg.type === "SG_DUPLICATE_STYLE") {
                var styleToDup = findStyleByName(msg.styleId);
                if (styleToDup) {
                    duplicateStyle(tab, styleToDup, refreshAndNotifyFrame);
                }
            }
            if (msg.type === "SG_MOVE_TO_CATEGORY") {
                var styleToMove = findStyleByName(msg.styleId);
                if (styleToMove) {
                    moveToCategory(tab, styleToMove, refreshAndNotifyFrame);
                }
            }
            if (msg.type === "SG_WILDCARD_CATEGORY") {
                var catId = msg.category || "";
                if (catId) {
                    var wcTag = buildSgToken(catId, msg.spec || "");
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
                    var sliceTag = buildSgToken(sliceCat, msg.spec || "");
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
                    removeWildcardCategory(tab, msg.category, msg.spec || "");
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
                            showStatusMessage(tab, "Could not load styles for batch generation", true);
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
                var styleToDelete = findStyleByName(msg.styleId);
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

    init();

    if (typeof onUiLoaded === "function") {
        onUiLoaded(function () {
            state.txt2img.sgFrame = state.txt2img.sgFrame || initSGFrame("txt2img");
            state.img2img.sgFrame = state.img2img.sgFrame || initSGFrame("img2img");
            installForgeMainTabSyncForV2();
        });
    } else if (document.body) {
        ensureSGFramesOnce();
    } else {
        document.addEventListener("DOMContentLoaded", ensureSGFramesOnce);
    }
})();
