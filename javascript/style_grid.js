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
            usage: {},
            presets: {},
            silentMode: false,
            userPromptBase: "",
            userPromptBaseNeg: "",
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

    var _thumbPopup = null;      // single shared popup element
    var _thumbHoverTimer = null; // pending hover timer
    var _thumbVersions = (function () {
        try { return JSON.parse(localStorage.getItem("sg_thumb_versions") || "{}"); }
        catch (_) { return {}; }
    })();
    function _saveThumbVersions() {
        try { localStorage.setItem("sg_thumb_versions", JSON.stringify(_thumbVersions)); }
        catch (_) { }
    }
    var _thumbProgressTimer = null;

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
    function loadCategoryOrder() {
        try {
            return JSON.parse(localStorage.getItem("sg_cat_order") || "null");
        } catch (_) {
            return null;
        }
    }
    function saveCategoryOrder(order) {
        try {
            localStorage.setItem("sg_cat_order", JSON.stringify(order));
        } catch (_) { }
        // Also persist to server for cross-browser persistence
        apiPost("/style_grid/category_order/save", { order: order }).catch(function () { });
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

    // Favorites
    const FAV_CAT = "FAVORITES";
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
    function toggleFavorite(t, n) {
        const f = getFavorites(t);
        if (f.has(n)) f.delete(n);
        else f.add(n);
        setFavorites(t, f);
    }

    // Recent history
    function getRecentHistory(t) {
        try {
            return JSON.parse(localStorage.getItem("sg_recent_" + t) || "[]");
        } catch (_) {
            return [];
        }
    }
    function addToRecentHistory(t, names) {
        let h = getRecentHistory(t);
        names.forEach(function (n) { h = h.filter(function (x) { return x !== n; }); h.unshift(n); });
        if (h.length > 10) h = h.slice(0, 10);
        localStorage.setItem("sg_recent_" + t, JSON.stringify(h));
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------
    function hashString(s) {
        if (!s) s = "";
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h = h & h;
        }
        return Math.abs(h);
    }
    function getCategoryColor(c) {
        const h = hashString(c) % 360;
        const s = 55 + (hashString(c + "s") % 25);
        const l = 48 + (hashString(c + "l") % 12);
        return "hsl(" + h + "," + s + "%," + l + "%)";
    }
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

    function normalizeSearchText(s) { return (s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
    function buildSearchText(style) { return normalizeSearchText([style.name, style.display_name].filter(Boolean).join(" ")); }
    function acMatches(candidate, query) {
        const normalized = normalizeSearchText(candidate);
        const q = normalizeSearchText(query);
        if (!q) return true;
        return q.split(/\s+/).filter(Boolean).every(function (token) {
            return normalized.includes(token);
        });
    }
    function getUniqueSources(t) {
        const cats = state[t].categories || {};
        const s = new Set();
        Object.values(cats).forEach(function (arr) { arr.forEach(function (st) { if (st.source) s.add(st.source); }); });
        return Array.from(s).sort();
    }
    function findStyleByName(t, n) {
        // Looks up style by name inside host cache state[tab].categories.
        for (const styles of Object.values(state[t].categories)) {
            const f = styles.find(function (s) { return s.name === n; });
            if (f) return f;
        }
        return null;
    }
    function getLoadedStylesWithCategory(tabName) {
        var out = [];
        var cats = state[tabName].categories || {};
        for (var catName in cats) {
            (cats[catName] || []).forEach(function (s) {
                out.push({
                    name: s.name,
                    display_name: s.display_name,
                    category: catName
                });
            });
        }
        return out;
    }

    // ════════════════════════════════════════════════════
    // CONFLICTS / COMBOS (description parsing & chips)
    // ════════════════════════════════════════════════════
    function parseDescription(desc) {
        if (!desc) return { text: "", combos: [], conflicts: [] };

        var result = { text: "", combos: [], conflicts: [] };

        // Extract Combos: section — after "Combos:" until end or first period
        var combosMatch = desc.match(/Combos:\s*([^.]+)/i);
        if (combosMatch) {
            var block = combosMatch[1].trim();
            var rawTokens = block.split(/\s*;\s*|\s+or\s+/i).map(function (s) { return s.trim(); });
            result.combos = rawTokens.map(function (token) {
                token = token.replace(/\.\s*$/, "").trim();
                var parts = token.split(/\s+/);
                var out = [];
                for (var i = 0; i < parts.length; i++) {
                    if (/^[a-z]/.test(parts[i]) || parts[i].toLowerCase() === "for") break;
                    out.push(parts[i]);
                }
                return out.join(" ").trim();
            }).filter(Boolean);
        }

        // Extract Conflicts: section
        var conflictsMatch = desc.match(/Conflicts:\s*([^.]+)/i);
        if (conflictsMatch) {
            result.conflicts = conflictsMatch[1]
                .split(";")
                .map(function (s) { return s.trim(); })
                .filter(Boolean);
        }

        // Plain text = everything before first "Combos:" or "Conflicts:"
        result.text = desc
            .replace(/Combos:[^.]+\.?/i, "")
            .replace(/Conflicts:[^.]+\.?/i, "")
            .replace(/\s+/g, " ")
            .trim();

        return result;
    }
    function findStyleByToken(token, loadedStyles) {
        var list = loadedStyles || [];
        var found = list.find(function (s) { return s.name === token; });
        if (found) return found;

        var parts = token.split("_");
        if (parts.length >= 2) {
            var swapped = [parts[1], parts[0]].concat(parts.slice(2)).join("_");
            found = list.find(function (s) { return s.name === swapped; });
            if (found) return found;
        }

        var lower = token.toLowerCase();
        found = list.find(function (s) { return (s.name || "").toLowerCase() === lower; });
        if (found) return found;

        if (parts.length >= 2) {
            var swappedLower = [parts[1], parts[0]].concat(parts.slice(2)).join("_").toLowerCase();
            found = list.find(function (s) { return (s.name || "").toLowerCase() === swappedLower; });
            if (found) return found;
        }

        return null;
    }
    function resolveComboItem(tabName, comboStr, loadedStyles) {
        var token = (comboStr || "").trim();
        if (!token) return { type: "plain", label: comboStr || "" };

        var list = loadedStyles || [];

        // Type 1: WILDCARD — ends with _*
        if (token.endsWith("_*")) {
            var prefixWithUnderscore = token.slice(0, -2).trim() + "_";
            var chipLabel = prefixWithUnderscore.replace(/_$/, "") || token;
            return {
                type: "wildcard",
                label: chipLabel,
                searchPrefix: prefixWithUnderscore
            };
        }

        // Type 2: EXACT STYLE NAME (with swap fallback for SUBJECT_CATEGORY vs CATEGORY_SUBJECT)
        var styleMatch = findStyleByToken(token, list);
        if (styleMatch) {
            return {
                type: "style",
                label: token,
                styleName: styleMatch.name
            };
        }

        return { type: "plain", label: comboStr };
    }

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

    // Canonical copy in javascript/sg_prompt_utils.js — keep in sync (Forge loads this file only).
    /* eslint-disable no-unused-vars -- Duplicated prompt helpers; call sites TBD; single source: sg_prompt_utils.js */
    function splitTopLevelCommas(s) {
        if (!s || !String(s).trim()) return [];
        var str = String(s);
        var parts = [];
        var depth = 0;
        var cur = "";
        for (var i = 0; i < str.length; i++) {
            var c = str[i];
            if (c === "(") depth++;
            else if (c === ")") depth = Math.max(0, depth - 1);
            if (c === "," && depth === 0) {
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
        var names = state[tabName].silentMode ? [...state[tabName].selected] : [];
        if (!silentEl) return;
        setPromptValue(silentEl, JSON.stringify(names));
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
        } catch (e) { console.error("[Style Grid] Parse error:", e); return {}; }
    }
    function getCategoryOrder(tabName) {
        const el = qs("#style_grid_cat_order_" + tabName + " textarea");
        if (!el || !el.value) return [];
        try { return JSON.parse(el.value); } catch (_) { return []; }
    }

    function getCollapsedCategories() {
        try {
            return JSON.parse(localStorage.getItem("sg_collapsed") || "[]");
        } catch (_) { return []; }
    }
    function saveCollapsedCategories(tabName) {
        var panel = state[tabName].panel;
        if (!panel) return;
        var collapsed = [];
        qsa(".sg-category.sg-collapsed", panel).forEach(function (sec) {
            var cat = sec.getAttribute("data-category");
            if (cat) collapsed.push(cat);
        });
        try { localStorage.setItem("sg_collapsed", JSON.stringify(collapsed)); }
        catch (_) { }
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

    /** Reject when API returns HTTP 200 with { error: "..." } (style routes, etc.). Thumbnail generate keeps soft errors in .then handlers. */
    function assertNoApiError(result) {
        if (result && result.error) {
            return Promise.reject(new Error(result.error));
        }
        return result;
    }
    function apiGet(endpoint) {
        return fetch(endpoint).then(function (r) { return r.json(); });
    }

    // ════════════════════════════════════════════════════
    // THUMBNAILS
    // ════════════════════════════════════════════════════
    function loadThumbnailList(tabName) {
        apiGet("/style_grid/thumbnails/list")
            .then(function (data) {
                state[tabName].hasThumbnail = new Set(data.has_thumbnail || []);
                var panel = state[tabName].panel;
                if (!panel) return;
                qsa(".sg-card", panel).forEach(function (card) {
                    var name = card.getAttribute("data-style-name");
                    card.classList.toggle(
                        "sg-has-thumb",
                        state[tabName].hasThumbnail.has(name)
                    );
                });
            })
            .catch(function (err) {
                console.error("[Style Grid] Thumbnail list error:", err);
            });
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
    function checkConflictsLocal(tabName) {
        const selected = [...state[tabName].selected];
        if (selected.length < 2) return [];
        const conflicts = [];
        const tokenMap = {};
        selected.forEach(function (name) {
            const s = findStyleByName(tabName, name);
            if (!s) return;
            tokenMap[name] = { pos: new Set(), neg: new Set() };
            (s.prompt || "").split(",").forEach(function (t) {
                t = t.trim().toLowerCase();
                if (t && t !== "{prompt}") tokenMap[name].pos.add(t);
            });
            (s.negative_prompt || "").split(",").forEach(function (t) {
                t = t.trim().toLowerCase();
                if (t && t !== "{prompt}") tokenMap[name].neg.add(t);
            });
        });
        const names = Object.keys(tokenMap);
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) {
                const a = names[i];
                const b = names[j];

                // A adds what B negates
                const overlap1 = new Set();
                tokenMap[a].pos.forEach(function (t) {
                    if (tokenMap[b].neg.has(t)) overlap1.add(t);
                });
                if (overlap1.size > 0) {
                    conflicts.push({
                        styleA: a,
                        styleB: b,
                        tokens: [...overlap1].slice(0, 5),
                        suggestion: "drop_b",
                        suggestionText: "Remove \"" + b + "\" (negates tokens from \"" + a + "\")"
                    });
                }

                // B adds what A negates
                const overlap2 = new Set();
                tokenMap[b].pos.forEach(function (t) {
                    if (tokenMap[a].neg.has(t)) overlap2.add(t);
                });
                if (overlap2.size > 0) {
                    conflicts.push({
                        styleA: b,
                        styleB: a,
                        tokens: [...overlap2].slice(0, 5),
                        suggestion: "drop_b",
                        suggestionText: "Remove \"" + a + "\" (negates tokens from \"" + b + "\")"
                    });
                }
            }
        }
        return conflicts;
    }

    // -----------------------------------------------------------------------
    // Dynamic apply / unapply a single style
    // -----------------------------------------------------------------------
    function applyStyleImmediate(tabName, styleName, opts) {
        opts = opts || {};
        var restoreOnly = opts.silent === true;
        if (!restoreOnly && state[tabName].applied.has(styleName)) return;
        const style = findStyleByName(tabName, styleName);
        if (!style) return;

        if (state[tabName].silentMode) {
            // Silent: just track, don't touch prompt fields
            state[tabName].applied.set(styleName, { prompt: style.prompt || null, negative: style.negative_prompt || null, silent: true });
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
                prompt = style.prompt.replace("{prompt}", prompt);
                addedPrompt = null;
            } else {
                if (prompt == null) prompt = "";
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
                neg = style.negative_prompt.replace("{prompt}", neg);
                addedNeg = null;
            } else {
                if (neg == null) neg = "";
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
            originalNeg: isNegWrap ? snapshotNeg : null
        });
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
    }

    // Exposed on window so iframe message handlers can trigger host-side prompt mutations.
    window._sgApplyStyle = applyStyleImmediate;
    // Exposed on window so iframe message handlers can trigger host-side prompt rollback.
    window._sgUnapplyStyle = unapplyStyle;

    function unapplyStyle(tabName, styleName) {
        const record = state[tabName].applied.get(styleName);
        if (!record) return;

        if (record.silent || state[tabName].silentMode) {
            state[tabName].applied.delete(styleName);
            setSilentGradio(tabName);
            qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-applied"); });
            return;
        }

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

        state[tabName].applied.delete(styleName);
        qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-applied"); });
    }

   // THUMBNAILS (batch / generate / upload — context menu entry points below)
   var _batchState = { running: false, cancelled: false, skipped: false };

   function startBatchThumbnails(tabName, catName, styles) {
       if (_batchState.running) {
           showStatusMessage(tabName, "Batch generation already running", true);
           return;
       }

       var queue = styles.filter(function (s) {
           return !state[tabName].hasThumbnail.has(s.name);
       });
       if (queue.length === 0) {
           showStatusMessage(tabName, "All styles already have previews");
           return;
       }

       _batchState = { running: true, cancelled: false, skipped: false };
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

       var btnRow = el("div", { className: "sg-editor-btns" });
       var skipBtn = el("button", {
           className: "sg-btn sg-btn-secondary",
           textContent: "⏭ Skip",
           onClick: function () { _batchState.skipped = true; }
       });
       var cancelBtn = el("button", {
           className: "sg-btn",
           style: "background:#dc2626; border-color:#dc2626; color:#fff;",
           textContent: "✕ Cancel",
           onClick: function () {
               _batchState.cancelled = true;
               cancelBtn.textContent = "Cancelling...";
               cancelBtn.disabled = true;
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
               overlay.remove();
               var msg = "Done: " + done + "/" + total + " generated";
               if (failed > 0) msg += ", " + failed + " failed";
               if (skipped > 0) msg += ", " + skipped + " skipped";
               showStatusMessage(tabName, msg);
               loadThumbnailList(tabName);
               return;
           }

           var styleName = queue[index].name;
           _batchState.skipped = false;
           updateProgress(index + 1, styleName, "generating...");

           apiPost("/style_grid/thumbnail/generate", { name: styleName })
               .then(function (r) {
                   if (r.error) {
                       if (r.error.indexOf("busy") !== -1) {
                           // SD busy — wait and retry same index
                           updateProgress(index + 1, styleName, "SD busy, waiting...");
                           setTimeout(function () { processNext(index); }, 5000);
                           return;
                       }
                       failed++;
                       processNext(index + 1);
                       return;
                   }
                   pollBatchStatus(tabName, styleName, index, 0);
               })
               .catch(function () {
                   failed++;
                   processNext(index + 1);
               });
       }

       function pollBatchStatus(tabName2, styleName, index, attempts) {
           if (_batchState.cancelled) {
               _batchState.running = false;
               overlay.remove();
               showStatusMessage(tabName2, "Cancelled. " + done + "/" + total + " completed.");
               loadThumbnailList(tabName2);
               return;
           }
           if (_batchState.skipped) {
               skipped++;
               processNext(index + 1);
               return;
           }
           if (attempts > 60) {
               failed++;
               processNext(index + 1);
               return;
           }

           apiGet("/style_grid/thumbnail/gen_status?name=" +
               encodeURIComponent(styleName))
               .then(function (r) {
                   if (!r || r.detail === "Not Found" || r.status === undefined) {
                       failed++;
                       processNext(index + 1);
                       return;
                   }
                   if (r.status === "done") {
                       done++;
                       state[tabName2].hasThumbnail.add(styleName);
                       _thumbVersions[styleName] = Date.now();
                       localStorage.setItem("sg_thumb_v_" + styleName, _thumbVersions[styleName].toString());
                       _saveThumbVersions();
                       qsa('.sg-card[data-style-name="' +
                           CSS.escape(styleName) + '"]', state[tabName2].panel)
                           .forEach(function (c) { c.classList.add("sg-has-thumb"); });
                       updateProgress(index + 1, styleName, "✓");
                       setTimeout(function () { processNext(index + 1); }, 300);
                   } else if (r.status === "error") {
                       failed++;
                       processNext(index + 1);
                   } else {
                       setTimeout(function () {
                           pollBatchStatus(tabName2, styleName, index, attempts + 1);
                       }, 2000);
                   }
               })
               .catch(function () {
                   failed++;
                   processNext(index + 1);
               });
       }

       processNext(0);
   }

   function generateThumbnail(tabName, styleName, onDone, onProgress) {
        showStatusMessage(tabName, "🎨 Generating preview for " +
            styleName.split("_").slice(1).join(" ") + "...");
        if (typeof onProgress === "function") {
            onProgress("generating", 0);
        }

        apiPost("/style_grid/thumbnail/generate", { name: styleName })
            .then(function (r) {
                if (r.error) {
                    showStatusMessage(tabName, "Generation failed: " + r.error, true);
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                pollGenerationStatus(tabName, styleName, 0, onDone, onProgress);
            })
            .catch(function () {
                showStatusMessage(tabName, "Generation failed", true);
                if (typeof onProgress === "function") {
                    onProgress("error");
                }
            });
    }

    function pollGenerationStatus(tabName, styleName, attempts, onDone, onProgress) {
        if (attempts > 60) {
            showStatusMessage(tabName, "Generation timed out", true);
            if (typeof onProgress === "function") {
                onProgress("error");
            }
            return;
        }
        apiGet("/style_grid/thumbnail/gen_status?name=" +
            encodeURIComponent(styleName))
            .then(function (r) {
                // r could be a FastAPI 404 JSON like {"detail": "Not Found"}
                if (!r || r.detail === "Not Found" || r.status === undefined) {
                    showStatusMessage(tabName, "Generation endpoint not found", true);
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                if (r.status === "done") {
                    state[tabName].hasThumbnail.add(styleName);
                    _thumbVersions[styleName] = Date.now();
                    localStorage.setItem("sg_thumb_v_" + styleName, _thumbVersions[styleName].toString());
                    _saveThumbVersions();
                    qsa('.sg-card[data-style-name="' +
                        CSS.escape(styleName) + '"]',
                        state[tabName].panel)
                        .forEach(function (c) {
                            c.classList.add("sg-has-thumb");
                        });
                    showStatusMessage(tabName, "✓ Preview ready!");
                    if (typeof onProgress === "function") {
                        onProgress("done", 100);
                    }
                    if (typeof onDone === "function") onDone(_thumbVersions[styleName]);
                } else if (r.status === "error") {
                    showStatusMessage(tabName,
                        "Generation failed: " + (r.message || "unknown"), true);
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                } else if (r.status === "running" || r.status === "idle") {
                    if (typeof onProgress === "function") {
                        onProgress("generating", Math.min(90, Math.round((attempts / 60) * 100)));
                    }
                    setTimeout(function () {
                        pollGenerationStatus(tabName, styleName, attempts + 1, onDone, onProgress);
                    }, 2000);
                } else {
                    showStatusMessage(tabName, "Unknown generation status: " + r.status, true);
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                }
            })
            .catch(function (err) {
                // Only retry on actual network errors, not HTTP error responses
                // HTTP errors (404, 500) mean something is structurally wrong — stop
                console.error("[Style Grid] Poll error:", err);
                showStatusMessage(tabName, "Generation status unavailable", true);
                if (typeof onProgress === "function") {
                    onProgress("error");
                }
            });
    }

    function uploadThumbnail(tabName, styleName) {
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
                    image: reader.result
                })
                    .then(function (r) {
                        if (r.ok) {
                            state[tabName].hasThumbnail.add(styleName);
                            qsa('.sg-card[data-style-name="' +
                                CSS.escape(styleName) + '"]',
                                state[tabName].panel)
                                .forEach(function (c) {
                                    c.classList.add("sg-has-thumb");
                                });
                            _thumbVersions[styleName] = Date.now();
                            localStorage.setItem("sg_thumb_v_" + styleName, _thumbVersions[styleName].toString());
                            _saveThumbVersions();
                            showStatusMessage(tabName, "Preview saved ✓");
                        } else {
                            showStatusMessage(tabName,
                                "Upload failed: " + (r.error || "?"), true);
                        }
                    })
                    .catch(function () {
                        showStatusMessage(tabName, "Upload failed", true);
                    });
            };
            reader.readAsDataURL(file);
        });
        input.click();
    }

    // ════════════════════════════════════════════════════
    // UI: EDITOR / CONTEXT MENU
    // ════════════════════════════════════════════════════
    function showContextMenu(e, tabName, styleName, style) {
        e.preventDefault();
        // Remove existing
        const old = qs(".sg-context-menu");
        if (old) old.remove();

        const menu = el("div", { className: "sg-context-menu" });
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";

        const items = [
            { label: "✏️ Edit style", action: function () { openStyleEditor(tabName, style); } },
            { label: "📋 Duplicate", action: function () { duplicateStyle(tabName, style); } },
            { label: "🗑️ Delete", action: function () { deleteStyle(tabName, styleName, style.source); } },
            { label: "📂 Move to category...", action: function () { moveToCategory(tabName, style); } },
            { label: "📎 Copy prompt", action: function () { navigator.clipboard.writeText(style.prompt || ""); } },
        ];

        items.push({
            label: "🎨 Generate preview (SD)",
            action: function () { generateThumbnail(tabName, styleName); }
        });

        items.push({
            label: "🖼️ Upload preview image",
            action: function () { uploadThumbnail(tabName, styleName); }
        });

        items.forEach(function (item) {
            const btn = el("div", { className: "sg-ctx-item", textContent: item.label, onClick: function () { menu.remove(); item.action(); } });
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        // Clamp position to viewport
        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = parseFloat(menu.style.left) || e.clientX;
        let y = parseFloat(menu.style.top) || e.clientY;

        if (x + rect.width > vw) x = vw - rect.width - 8;
        if (y + rect.height > vh) y = vh - rect.height - 8;
        if (x < 8) x = 8;
        if (y < 8) y = 8;

        menu.style.left = x + "px";
        menu.style.top = y + "px";

        // Auto-close
        setTimeout(function () {
            const close = function () { menu.remove(); document.removeEventListener("click", close); };
            document.addEventListener("click", close);
        }, 0);
    }

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
                apiPost("/style_grid/style/save", {
                    name: name,
                    prompt: promptInput.value,
                    negative_prompt: negInput.value,
                    description: descInput.value,
                    source: existingStyle ? existingStyle.source : (sourceFile || null),
                }).then(assertNoApiError).then(function () {
                    overlay.remove();
                    refreshPanel(tabName);
                    var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                    if (typeof notify === "function") notify();
                }).catch(function (err) {
                    console.error("[Style Grid] API error:", err);
                    showStatusMessage(tabName, "Save failed", true);
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

    var CSV_TABLE_FIELDS = ["name", "prompt", "negative_prompt", "description", "category"];

    function openCsvTableEditor(tabName) {
        var selectedSource = state[tabName].selectedSource || "All";
        if (selectedSource === "All") {
            alert("Choose a single CSV in the source filter (not “All Sources”) to edit that file as a table.");
            return;
        }
        var rows = [];
        Object.values(state[tabName].categories || {}).forEach(function (arr) {
            arr.forEach(function (s) {
                if (s.source === selectedSource) {
                    rows.push({
                        name: s.name || "",
                        prompt: s.prompt || "",
                        negative_prompt: s.negative_prompt || "",
                        description: s.description || "",
                        category: (s.category_explicit !== null && s.category_explicit !== undefined && String(s.category_explicit).trim() !== "")
                            ? String(s.category_explicit).trim()
                            : (s.category || ""),
                        source: s.source || selectedSource,
                    });
                }
            });
        });
        rows.sort(function (a, b) { return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }); });

        var baselineRows = rows.map(function (r) {
            var o = {};
            CSV_TABLE_FIELDS.forEach(function (f) { o[f] = (r[f] !== null && r[f] !== undefined) ? String(r[f]) : ""; });
            o.source = r.source;
            return o;
        });
        var rowModels = baselineRows.map(function (r) {
            var o = {};
            CSV_TABLE_FIELDS.forEach(function (f) { o[f] = r[f]; });
            o.source = r.source;
            return o;
        });
        var dirty = {};

        function hasTableUnsavedChanges() {
            recomputeDirty();
            return Object.keys(dirty).length > 0;
        }

        function closeCsvEditorOverlay() {
            overlay.remove();
        }

        function requestCloseCsvEditor() {
            if (hasTableUnsavedChanges()) {
                if (!confirm("Close the table editor? Unsaved changes will be lost.")) return;
            }
            closeCsvEditorOverlay();
        }

        function recomputeDirty() {
            dirty = {};
            rowModels.forEach(function (rm, i) {
                var base = i < baselineRows.length ? baselineRows[i] : null;
                var empty = { name: "", prompt: "", negative_prompt: "", description: "", category: "" };
                var ref = base || empty;
                CSV_TABLE_FIELDS.forEach(function (f) {
                    if (String(rm[f] !== null && rm[f] !== undefined ? rm[f] : "") !== String(ref[f] !== null && ref[f] !== undefined ? ref[f] : "")) {
                        if (!dirty[i]) dirty[i] = {};
                        dirty[i][f] = rm[f];
                    }
                });
            });
        }

        function refreshDirtyUi() {
            recomputeDirty();
            qsa("tr.sg-csv-data-row", tbody).forEach(function (tr) {
                var ri = parseInt(tr.getAttribute("data-row-index"), 10);
                tr.classList.toggle("sg-csv-dirty", !!dirty[ri]);
            });
        }

        var overlay = el("div", { className: "sg-csv-editor-overlay" });
        var shell = el("div", { className: "sg-csv-editor-shell" });

        var topBar = el("div", { className: "sg-csv-editor-topbar" });
        topBar.appendChild(el("h2", {
            className: "sg-csv-editor-title",
            textContent: "Edit CSV — " + selectedSource,
        }));
        var closeTop = el("button", {
            type: "button",
            className: "sg-btn sg-csv-editor-close",
            textContent: "✕",
            title: "Close",
            onClick: function () { requestCloseCsvEditor(); },
        });
        topBar.appendChild(closeTop);
        shell.appendChild(topBar);

        var toolRow = el("div", { className: "sg-csv-editor-toolbar" });
        var filterInputs = {};
        function clearFilters() {
            Object.keys(filterInputs).forEach(function (k) {
                filterInputs[k].value = "";
            });
            applyFilters();
        }
        toolRow.appendChild(el("button", {
            type: "button",
            className: "sg-btn sg-btn-primary",
            textContent: "💾 Save Changes",
            onClick: function () {
                recomputeDirty();
                var indices = Object.keys(dirty).map(function (x) { return parseInt(x, 10); }).filter(function (i) { return !isNaN(i); });
                if (indices.length === 0) {
                    alert("No changes to save.");
                    return;
                }
                indices.sort(function (a, b) { return a - b; });
                var v;
                for (v = 0; v < indices.length; v++) {
                    var vi = indices[v];
                    if (!(rowModels[vi].name || "").trim()) {
                        alert("Row " + (vi + 1) + ": name is required.");
                        return;
                    }
                }
                var usedNames = Object.create(null);
                var u;
                for (u = 0; u < rowModels.length; u++) {
                    var un = (rowModels[u].name || "").trim();
                    if (!un) continue;
                    if (usedNames[un]) {
                        alert("Duplicate style name \"" + un + "\". Each row must have a unique name before saving.");
                        return;
                    }
                    usedNames[un] = true;
                }
                var totalDirty = indices.length;
                var savedCount = 0;
                clearSaveStatusUi();
                indices.forEach(function (idx) {
                    setRowSaveStatus(idx, "pending", "Pending");
                });
                var chain = Promise.resolve();
                indices.forEach(function (i) {
                    var rm = rowModels[i];
                    var orig = i < baselineRows.length ? baselineRows[i] : null;
                    var nameTrim = (rm.name || "").trim();
                    var src = (orig && orig.source) || selectedSource;
                    chain = chain.then(function () {
                        setRowSaveStatus(i, "saving", "Saving…");
                        var savePromise;
                        if (orig && orig.name !== nameTrim) {
                            savePromise = apiPost("/style_grid/style/delete", { name: orig.name, source: orig.source || selectedSource })
                                .then(assertNoApiError)
                                .then(function () {
                                    return apiPost("/style_grid/style/save", {
                                        name: nameTrim,
                                        prompt: rm.prompt || "",
                                        negative_prompt: rm.negative_prompt || "",
                                        description: rm.description || "",
                                        category: rm.category || "",
                                        source: src,
                                    }).then(assertNoApiError);
                                });
                        } else {
                            savePromise = apiPost("/style_grid/style/save", {
                                name: nameTrim,
                                prompt: rm.prompt || "",
                                negative_prompt: rm.negative_prompt || "",
                                description: rm.description || "",
                                category: rm.category || "",
                                source: src,
                            }).then(assertNoApiError);
                        }
                        return savePromise.then(function () {
                            savedCount++;
                            setRowSaveStatus(i, "saved", "✓ saved");
                        }).catch(function (err) {
                            setRowSaveStatus(i, "error", "✗ error");
                            var msg = (err && err.message) ? err.message : "unknown error";
                            var wrapped = new Error(msg);
                            wrapped._sgCsvSaved = savedCount;
                            wrapped._sgCsvTotal = totalDirty;
                            wrapped._sgCsvRowName = nameTrim;
                            throw wrapped;
                        });
                    });
                });
                chain.then(function () {
                    closeCsvEditorOverlay();
                    refreshPanel(tabName);
                    var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                    if (typeof notify === "function") notify();
                }).catch(function (e) {
                    console.error("[Style Grid] CSV table save:", e);
                    var x = (e && e._sgCsvSaved !== null && e._sgCsvSaved !== undefined) ? e._sgCsvSaved : 0;
                    var n = (e && e._sgCsvTotal !== null && e._sgCsvTotal !== undefined) ? e._sgCsvTotal : totalDirty;
                    var nm = (e && e._sgCsvRowName) ? e._sgCsvRowName : "?";
                    var msg = (e && e.message) ? e.message : "unknown error";
                    alert("Saved " + x + " of " + n + " rows. Row \"" + nm + "\" failed: " + msg + ". Rows above are written to disk.");
                });
            },
        }));
        toolRow.appendChild(el("button", {
            type: "button",
            className: "sg-btn sg-btn-secondary",
            textContent: "Discard",
            onClick: function () {
                rowModels = baselineRows.map(function (r) {
                    var o = {};
                    CSV_TABLE_FIELDS.forEach(function (f) { o[f] = r[f]; });
                    o.source = r.source;
                    return o;
                });
                renderTableBody();
                recomputeDirty();
                refreshDirtyUi();
            },
        }));
        toolRow.appendChild(el("button", {
            type: "button",
            className: "sg-btn sg-btn-secondary",
            textContent: "➕ Add Row",
            onClick: function () {
                rowModels.push({
                    name: "",
                    prompt: "",
                    negative_prompt: "",
                    description: "",
                    category: "",
                    source: selectedSource,
                });
                renderTableBody();
                refreshDirtyUi();
            },
        }));
        toolRow.appendChild(el("button", {
            type: "button",
            className: "sg-btn sg-btn-secondary",
            textContent: "Clear filters",
            onClick: function () { clearFilters(); },
        }));
        shell.appendChild(toolRow);

        var filterRowWrap = el("div", { className: "sg-csv-editor-filters" });
        var filterTable = el("table", { className: "sg-csv-editor-filter-table" });
        var filterTr = el("tr");
        filterTr.appendChild(el("th", { className: "sg-csv-col-actions" }));
        filterTr.appendChild(el("th", { className: "sg-csv-col-status" }));
        CSV_TABLE_FIELDS.forEach(function (f) {
            var th = el("th");
            var inp = el("input", {
                type: "text",
                className: "sg-csv-filter-input",
                placeholder: "Filter " + f.replace(/_/g, " ") + "…",
            });
            filterInputs[f] = inp;
            inp.addEventListener("input", function () { applyFilters(); });
            th.appendChild(inp);
            filterTr.appendChild(th);
        });
        var filterThead = el("thead");
        filterThead.appendChild(filterTr);
        filterTable.appendChild(filterThead);
        filterRowWrap.appendChild(filterTable);
        shell.appendChild(filterRowWrap);

        var scroll = el("div", { className: "sg-csv-editor-scroll" });
        var dataTable = el("table", { className: "sg-csv-editor-table" });
        var thead = el("thead");
        var headTr = el("tr");
        headTr.appendChild(el("th", { className: "sg-csv-col-actions", textContent: "" }));
        headTr.appendChild(el("th", { className: "sg-csv-col-status", textContent: "Status" }));
        headTr.appendChild(el("th", { textContent: "Name" }));
        headTr.appendChild(el("th", { textContent: "Prompt" }));
        headTr.appendChild(el("th", { textContent: "Negative Prompt" }));
        headTr.appendChild(el("th", { textContent: "Description" }));
        headTr.appendChild(el("th", { textContent: "Category" }));
        thead.appendChild(headTr);
        dataTable.appendChild(thead);
        var tbody = el("tbody");
        dataTable.appendChild(tbody);
        scroll.appendChild(dataTable);
        shell.appendChild(scroll);

        function clearSaveStatusUi() {
            qsa("tr.sg-csv-data-row", tbody).forEach(function (tr) {
                tr.classList.remove("sg-csv-save-pending", "sg-csv-save-saving", "sg-csv-save-ok", "sg-csv-save-err");
                var st = tr.querySelector(".sg-csv-save-status-text");
                if (st) st.textContent = "";
            });
        }

        function setRowSaveStatus(rowIndex, phase, label) {
            var tr = tbody.querySelector('tr.sg-csv-data-row[data-row-index="' + rowIndex + '"]');
            if (!tr) return;
            tr.classList.remove("sg-csv-save-pending", "sg-csv-save-saving", "sg-csv-save-ok", "sg-csv-save-err");
            if (phase === "pending") tr.classList.add("sg-csv-save-pending");
            else if (phase === "saving") tr.classList.add("sg-csv-save-saving");
            else if (phase === "saved") tr.classList.add("sg-csv-save-ok");
            else if (phase === "error") tr.classList.add("sg-csv-save-err");
            var st = tr.querySelector(".sg-csv-save-status-text");
            if (st) st.textContent = (label !== null && label !== undefined) ? label : "";
        }

        function applyFilters() {
            qsa("tr.sg-csv-data-row", tbody).forEach(function (tr) {
                var show = true;
                CSV_TABLE_FIELDS.forEach(function (f) {
                    var q = (filterInputs[f].value || "").trim().toLowerCase();
                    if (!q) return;
                    var cell = tr.querySelector('.sg-csv-cell--' + f + ' .sg-csv-cell-input');
                    var val = cell ? (cell.value || "").toLowerCase() : "";
                    if (val.indexOf(q) === -1) show = false;
                });
                tr.style.display = show ? "" : "none";
            });
        }

        function focusNextCell(elInput) {
            var all = Array.prototype.slice.call(tbody.querySelectorAll("input.sg-csv-cell-input, textarea.sg-csv-cell-input"));
            var idx = all.indexOf(elInput);
            if (idx === -1) return;
            var j = idx + 1;
            while (j < all.length) {
                var next = all[j];
                var tr = next.closest && next.closest("tr");
                if (tr && tr.style.display !== "none") {
                    next.focus();
                    if (next.select) next.select();
                    return;
                }
                j++;
            }
        }

        function deleteRowAt(rowIndex) {
            var rm = rowModels[rowIndex];
            if (rowIndex < baselineRows.length) {
                if (!confirm("Delete style \"" + (rm.name || "") + "\" from CSV?")) return;
                apiPost("/style_grid/style/delete", { name: baselineRows[rowIndex].name, source: baselineRows[rowIndex].source || selectedSource })
                    .then(assertNoApiError)
                    .then(function () {
                        rowModels.splice(rowIndex, 1);
                        baselineRows.splice(rowIndex, 1);
                        renderTableBody();
                        refreshDirtyUi();
                    })
                    .catch(function (err) {
                        console.error("[Style Grid] Delete failed:", err);
                        alert("Delete failed");
                    });
            } else {
                rowModels.splice(rowIndex, 1);
                renderTableBody();
                refreshDirtyUi();
            }
        }

        function renderTableBody() {
            tbody.innerHTML = "";
            rowModels.forEach(function (rm, rowIdx) {
                var tr = el("tr", { className: "sg-csv-data-row", "data-row-index": String(rowIdx) });
                tr.addEventListener("contextmenu", function (e) {
                    e.preventDefault();
                    var prevMenu = qs(".sg-context-menu");
                    if (prevMenu) prevMenu.remove();
                    var menu = el("div", { className: "sg-context-menu" });
                    menu.style.left = e.clientX + "px";
                    menu.style.top = e.clientY + "px";
                    menu.appendChild(el("div", {
                        className: "sg-ctx-item",
                        textContent: "🗑️ Delete row",
                        onClick: function () {
                            menu.remove();
                            deleteRowAt(rowIdx);
                        },
                    }));
                    document.body.appendChild(menu);
                    setTimeout(function () {
                        var close = function () { menu.remove(); document.removeEventListener("click", close); };
                        document.addEventListener("click", close);
                    }, 0);
                });

                var tdAct = el("td", { className: "sg-csv-col-actions" });
                var delBtn = el("button", {
                    type: "button",
                    className: "sg-csv-row-del",
                    textContent: "×",
                    title: "Delete row",
                    onClick: function (ev) {
                        ev.stopPropagation();
                        deleteRowAt(rowIdx);
                    },
                });
                tdAct.appendChild(delBtn);
                tr.appendChild(tdAct);

                var tdSaveSt = el("td", { className: "sg-csv-col-status" });
                tdSaveSt.appendChild(el("span", { className: "sg-csv-save-status-text" }));
                tr.appendChild(tdSaveSt);

                CSV_TABLE_FIELDS.forEach(function (field) {
                    var isLong = field === "prompt" || field === "negative_prompt";
                    var td = el("td", { className: "sg-csv-cell sg-csv-cell--" + field });
                    var inp = isLong
                        ? el("textarea", { className: "sg-csv-cell-input", rows: field === "prompt" ? 4 : 3 })
                        : el("input", { type: "text", className: "sg-csv-cell-input" });
                    inp.value = (rm[field] !== null && rm[field] !== undefined) ? String(rm[field]) : "";
                    inp.setAttribute("data-row", String(rowIdx));
                    inp.setAttribute("data-field", field);
                    inp.addEventListener("input", function () {
                        rowModels[rowIdx][field] = inp.value;
                        refreshDirtyUi();
                    });
                    inp.addEventListener("keydown", function (e) {
                        if (e.key === "Tab" && !e.shiftKey) {
                            e.preventDefault();
                            focusNextCell(inp);
                        }
                    });
                    td.appendChild(inp);
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            applyFilters();
            refreshDirtyUi();
        }

        renderTableBody();
        overlay.appendChild(shell);
        var csvOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            csvOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (csvOverlayMouseDownTarget === overlay || csvOverlayMouseDownTarget === e.currentTarget) {
                requestCloseCsvEditor();
            }
            csvOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
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
        }).catch(function (err) {
            console.error("[Style Grid] API error:", err);
        });
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
                        refreshPanel(tabName);
                        var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                        if (typeof notify === "function") notify();
                        if (typeof onDeleted === "function") onDeleted();
                    })
                    .catch(function (err) {
                        console.error("[Style Grid] Delete failed:", err);
                        showStatusMessage(tabName, "Delete failed", true);
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
                    refreshPanel(tabName);
                    var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                    if (typeof notify === "function") notify();
                    if (typeof onDone === "function") onDone();
                }).catch(function (err) {
                    console.error("[Style Grid] API error:", err);
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
    function showPresetsMenu(tabName) {
        const old = qs(".sg-presets-overlay");
        if (old) old.remove();

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
                apiPost("/style_grid/presets/save", { name: name, styles: [...state[tabName].selected] }).then(function (r) {
                    state[tabName].presets = r.presets || {};
                    renderPresetsList();
                    nameIn.value = "";
                }).catch(function (err) {
                    console.error("[Style Grid] API error:", err);
                });
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
                        // Clear current and load preset
                        clearAll(tabName);
                        const presetStyles = p.styles || [];
                        presetStyles.forEach(function (sn) {
                            state[tabName].selected.add(sn);
                            state[tabName].selectedOrder.push(sn);
                            applyStyleImmediate(tabName, sn);
                            qsa('.sg-card[data-style-name="' + CSS.escape(sn) + '"]', state[tabName].panel).forEach(function (c) { c.classList.add("sg-selected"); c.classList.add("sg-applied"); });
                        });
                        updateSelectedUI(tabName);
                        overlay.remove();
                    }
                }));
                row.appendChild(el("button", {
                    className: "sg-btn sg-btn-secondary", textContent: "🗑️",
                    onClick: function () {
                        apiPost("/style_grid/presets/delete", { name: name }).then(function (r) {
                            state[tabName].presets = r.presets || {};
                            renderPresetsList();
                        }).catch(function (err) {
                            console.error("[Style Grid] API error:", err);
                        });
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
                }).catch(function (err) {
                    console.error("[Style Grid] API error:", err);
                });
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
                    apiPost("/style_grid/import", data).then(function () {
                        overlay.remove();
                        refreshPanel(tabName);
                        var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                        if (typeof notify === "function") notify();
                    }).catch(function (err) {
                        console.error("[Style Grid] API error:", err);
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
    function refreshPanel(tabName) {
        apiGet("/style_grid/styles").then(function (data) {
            const dataEl = qs("#style_grid_data_" + tabName + " textarea");
            if (dataEl) {
                const full = { categories: data.categories || {}, usage: data.usage || {}, presets: state[tabName].presets };
                setPromptValue(dataEl, JSON.stringify(full));
            }
            // Save state before rebuild
            const savedSelection = new Set(state[tabName].selected);
            const wasVisible = state[tabName].panel && state[tabName].panel.classList.contains("sg-visible");
            if (state[tabName].panel) {
                state[tabName].panel.remove();
                state[tabName].panel = null;
            }
            state[tabName].categories = data.categories || {};
            state[tabName].usage = data.usage || {};
            buildPanel(tabName);
            // Restore selection
            savedSelection.forEach(function (n) {
                state[tabName].selected.add(n);
                qsa('.sg-card[data-style-name="' + CSS.escape(n) + '"]', state[tabName].panel).forEach(function (c) {
                    c.classList.add("sg-selected");
                    c.classList.add("sg-applied");
                });
            });
            var restoreOrder;
            if (state[tabName].appliedOrder && state[tabName].appliedOrder.length) {
                restoreOrder = state[tabName].appliedOrder.filter(function (n) { return savedSelection.has(n); });
            } else {
                restoreOrder = [];
                savedSelection.forEach(function (n) { restoreOrder.push(n); });
            }
            state[tabName].applied.clear();
            if (!state[tabName].silentMode) {
                state[tabName]._restoreSimP = state[tabName].userPromptBase;
                state[tabName]._restoreSimN = state[tabName].userPromptBaseNeg;
            }
            restoreOrder.forEach(function (n) {
                applyStyleImmediate(tabName, n, { silent: true });
            });
            if (!state[tabName].silentMode) {
                delete state[tabName]._restoreSimP;
                delete state[tabName]._restoreSimN;
            }
            updateSelectedUI(tabName);
            // Restore visibility — keep panel open if it was open
            if (wasVisible) {
                state[tabName].panel.classList.add("sg-visible");
            }
        }).catch(function (err) {
            console.error("[Style Grid] API error:", err);
            showStatusMessage(tabName, "Refresh failed", true);
        });
    }

    function applyRandomStyle(tabName) {
        const allStyles = [];
        const src = state[tabName].selectedSource;
        Object.values(state[tabName].categories).forEach(function (arr) {
            arr.forEach(function (s) {
                if (src === "All" || s.source === src) allStyles.push(s);
            });
        });
        if (allStyles.length === 0) return;
        const rand = allStyles[Math.floor(Math.random() * allStyles.length)];
        if (!state[tabName].selected.has(rand.name)) {
            state[tabName].selected.add(rand.name);
            if (state[tabName].selectedOrder.indexOf(rand.name) === -1) state[tabName].selectedOrder.push(rand.name);
            applyStyleImmediate(tabName, rand.name);
            qsa('.sg-card[data-style-name="' + CSS.escape(rand.name) + '"]', state[tabName].panel).forEach(function (c) { c.classList.add("sg-selected"); c.classList.add("sg-applied"); });
            updateSelectedUI(tabName);
        }
    }

    function runManualStyleBackup(tabName) {
        apiPost("/style_grid/backup").then(function (r) {
            if (r && r.ok) alert("Backup saved successfully!");
            else alert("Nothing to backup or backup failed.");
        }).catch(function (err) {
            console.error("[Style Grid] API error:", err);
            showStatusMessage(tabName, "Backup failed", true);
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
                        if (state[t].panel) refreshPanel(t);
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
                                // Full list for v2: dedupe by name only in iframe when "All sources" (stylesStore.filteredStyles).
                                var v2styles = Object.values(state[t].categories).flat();
                                frame.contentWindow.postMessage({
                                    type: "SG_STYLES_UPDATE",
                                    styles: v2styles
                                }, "*");
                            }
                        });
                    });
                }
            }).catch(function (err) {
                console.error("[Style Grid] API error:", err);
            });
        }, 5000);
    }

    // ════════════════════════════════════════════════════
    // UI: PANEL
    // ════════════════════════════════════════════════════
    // Build the Grid Panel
    // -----------------------------------------------------------------------
    function buildPanel(tabName) {
        const categories = loadStyles(tabName);
        state[tabName].categories = categories;
        state[tabName].silentMode = getSilentMode(tabName);
        const catOrder = getCategoryOrder(tabName);

        const catKeys = Object.keys(categories);
        var savedOrder = loadCategoryOrder();
        const sortedCats = [];
        if (savedOrder && Array.isArray(savedOrder)) {
            savedOrder.forEach(function (c) { if (catKeys.includes(c)) sortedCats.push(c); });
            catKeys.sort().forEach(function (c) { if (!sortedCats.includes(c)) sortedCats.push(c); });
        } else {
            catOrder.forEach(function (c) { if (catKeys.includes(c)) sortedCats.push(c); });
            catKeys.sort().forEach(function (c) { if (!sortedCats.includes(c)) sortedCats.push(c); });
        }

        // Overlay
        const overlay = el("div", { className: "sg-overlay", id: "sg_overlay_" + tabName });
        const panel = el("div", { className: "sg-panel" });

        function _attachPanelEventDelegation() {
            let overlayMouseDownTarget = null;
            overlay.addEventListener("mousedown", function (e) { overlayMouseDownTarget = e.target; }, true);
            overlay.addEventListener("click", function (e) { if (e.target === overlay && overlayMouseDownTarget === overlay) togglePanel(tabName, false); overlayMouseDownTarget = null; });
        }
        _attachPanelEventDelegation();

        function _buildPanelHeader() {
        const header = el("div", { className: "sg-header" });
        const titleRow = el("div", { className: "sg-title-row" });
        titleRow.appendChild(el("span", { className: "sg-title", textContent: "🎨 Style Grid" }));

        // Conflict warning area
        const conflictBadge = el("span", { className: "sg-conflict-badge", id: "sg_conflict_" + tabName });
        conflictBadge.style.display = "none";
        conflictBadge.addEventListener("click", function () {
            showConflictResolver(tabName, conflictBadge._conflicts || []);
        });
        titleRow.appendChild(conflictBadge);

        const selectedCount = el("span", { className: "sg-selected-count", id: "sg_count_" + tabName, textContent: "0 selected" });
        titleRow.appendChild(selectedCount);
        header.appendChild(titleRow);
        return header;
        }

        function _buildSourceList() {
        const searchRow = el("div", { className: "sg-search-row" });

        // Source dropdown
        state[tabName].selectedSource = getStoredSource(tabName);
        const sources = getUniqueSources(tabName);
        let currentSource = state[tabName].selectedSource;
        if (sources.indexOf(currentSource) === -1) currentSource = "All";
        state[tabName].selectedSource = currentSource;

        const srcWrap = el("div", { className: "sg-source-dropdown-wrap" });
        const srcBtn = el("button", { type: "button", className: "sg-source-select lg secondary gradio-button", id: "sg_source_" + tabName, title: "Filter by source", textContent: currentSource === "All" ? "All Sources" : currentSource });
        const srcList = el("div", { className: "sg-source-dropdown-list" });
        [{ value: "All", label: "All Sources" }].concat(sources.map(function (s) { return { value: s, label: s }; })).forEach(function (opt) {
            const item = el("div", { className: "sg-source-dropdown-item" + (opt.value === currentSource ? " sg-active" : ""), "data-value": opt.value, textContent: opt.label });
            item.addEventListener("click", function (e) {
                e.stopPropagation();
                state[tabName].selectedSource = opt.value;
                setStoredSource(tabName, opt.value);
                srcBtn.textContent = opt.label;
                srcList.classList.remove("sg-open");
                qsa(".sg-source-dropdown-item", srcList).forEach(function (i) { i.classList.toggle("sg-active", i.getAttribute("data-value") === opt.value); });
                filterStyles(tabName);
            });
            srcList.appendChild(item);
        });
        srcBtn.addEventListener("click", function (e) {
            e.stopPropagation();
                srcList.classList.toggle("sg-open");
            if (srcList.classList.contains("sg-open")) {
                    const close = function (e2) { if (!srcWrap.contains(e2.target)) { srcList.classList.remove("sg-open"); document.removeEventListener("click", close); } };
                setTimeout(function () { document.addEventListener("click", close); }, 0);
            }
        });
        srcWrap.appendChild(srcBtn);
        srcWrap.appendChild(srcList);
        searchRow.appendChild(srcWrap);

        // Search
        const searchInput = el("input", { className: "sg-search", type: "text", placeholder: "Search styles...", id: "sg_search_" + tabName, maxlength: "200" });
        const searchWrapper = el("div", { className: "sg-search-wrapper" });
        const clearBtn = el("span", { className: "sg-search-clear", textContent: "×" });
        clearBtn.addEventListener("click", function () {
            searchInput.value = "";
            clearBtn.classList.remove("sg-visible");
            filterStyles(tabName);
        });

        const acDropdown = el("div", { className: "sg-ac-dropdown" });
        acDropdown.style.display = "none";
        searchWrapper.style.position = "relative";
        searchWrapper.appendChild(searchInput);
        searchWrapper.appendChild(clearBtn);
        searchWrapper.appendChild(acDropdown);
        searchRow.appendChild(searchWrapper);

        let acSuppressNext = false;

        searchInput.addEventListener("input", function () {
            const val = this.value;
            clearBtn.classList.toggle("sg-visible", val.length > 0);

            if (acSuppressNext) {
                acSuppressNext = false;
                if (window._sgSearchTimer) clearTimeout(window._sgSearchTimer);
                window._sgSearchTimer = setTimeout(function () { filterStyles(tabName); }, 200);
                return;
            }

            if (!val.trim()) {
                acDropdown.style.display = "none";
            } else {
                const tokens = val.split(/\s+/);
                const lastToken = tokens[tokens.length - 1] || "";

                const suggestions = buildSuggestions(tabName);
                const matches = suggestions.filter(function (s) {
                    return acMatches(s, lastToken);
                }).slice(0, 8);

                if (matches.length === 0) {
                    acDropdown.style.display = "none";
                } else {
                    acDropdown.innerHTML = "";
                    matches.forEach(function (match) {
                        const item = el("div", {
                            className: "sg-ac-item",
                            textContent: match
                        });
                        item.addEventListener("mousedown", function (e) {
                            e.preventDefault();
                            const tokensInner = val.split(/\s+/);
                            tokensInner[tokensInner.length - 1] = match;
                            const needsValue = match.lastIndexOf(":") === match.length - 1;
                            searchInput.value = tokensInner.join(" ") + (needsValue ? "" : " ");
                            acSuppressNext = true;
                            acDropdown.style.display = "none";
                            var styleObj = findStyleByName(tabName, match);
                            if (!styleObj) {
                                Object.values(state[tabName].categories || {}).forEach(function (arr) {
                                    if (styleObj) return;
                                    var f = arr.find(function (st) { return (st.display_name || st.name) === match; });
                                    if (f) styleObj = f;
                                });
                            }
                            if (styleObj) {
                                if (!state[tabName].selected.has(styleObj.name)) {
                                    state[tabName].selected.add(styleObj.name);
                                    if (state[tabName].selectedOrder.indexOf(styleObj.name) === -1) {
                                        state[tabName].selectedOrder.push(styleObj.name);
                                    }
                                    applyStyleImmediate(tabName, styleObj.name);
                                    qsa('.sg-card[data-style-name="' + CSS.escape(styleObj.name) + '"]', state[tabName].panel).forEach(function (c) {
                                        c.classList.add("sg-selected");
                                        c.classList.add("sg-applied");
                                    });
                                    updateSelectedUI(tabName);
                                }
                            }
                            searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                            searchInput.focus();
                        });
                        acDropdown.appendChild(item);
                    });
                    acDropdown.style.display = "block";
                }
            }

            if (window._sgSearchTimer) clearTimeout(window._sgSearchTimer);
            window._sgSearchTimer = setTimeout(function () { filterStyles(tabName); }, 200);
        });

        searchInput.addEventListener("focus", function () {
            if (!this.value.trim()) {
                acDropdown.style.display = "none";
            }
        });

        searchInput.addEventListener("blur", function () {
            setTimeout(function () { acDropdown.style.display = "none"; }, 150);
        });

        searchInput.addEventListener("keydown", function (e) {
            const items = Array.prototype.slice.call(qsa(".sg-ac-item", acDropdown));
            if (!items.length || acDropdown.style.display === "none") return;
            const active = qs(".sg-ac-item.sg-ac-active", acDropdown);
            const idx = items.indexOf(active);
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (active) active.classList.remove("sg-ac-active");
                const next = items[idx + 1 < items.length ? idx + 1 : 0];
                if (next) next.classList.add("sg-ac-active");
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (active) active.classList.remove("sg-ac-active");
                const prev = items[idx - 1 >= 0 ? idx - 1 : items.length - 1];
                if (prev) prev.classList.add("sg-ac-active");
            } else if ((e.key === "Enter" || e.key === "Tab") && active) {
                e.preventDefault();
                active.dispatchEvent(new MouseEvent("mousedown"));
            } else if (e.key === "Escape") {
                acDropdown.style.display = "none";
            }
        });

        // Silent mode toggle
        const silentBtn = el("button", {
            className: "sg-btn sg-btn-secondary" + (state[tabName].silentMode ? " sg-active" : ""),
            textContent: "👁 Silent",
            title: "Silent mode: styles won't appear in prompt fields but will be applied during generation",
            onClick: function () {
                state[tabName].silentMode = !state[tabName].silentMode;
                setSilentMode(tabName, state[tabName].silentMode);
                silentBtn.classList.toggle("sg-active", state[tabName].silentMode);
                setSilentGradio(tabName);
            }
        });
        searchRow.appendChild(silentBtn);

        // Random style
        const btnRandom = el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "🎲", title: "Random style (use at your own risk!)",
            onClick: function () { applyRandomStyle(tabName); }
        });
        searchRow.appendChild(btnRandom);

        // Presets
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "📦", title: "Presets", onClick: function () { showPresetsMenu(tabName); } }));

        // Collapse/Expand
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "↕", title: "Collapse all",
            onClick: function () {
                const allCollapsed = qsa(".sg-category:not(.sg-collapsed)", panel).length === 0;
                qsa(".sg-category", panel).forEach(function (sec) {
                    if (allCollapsed) { sec.classList.remove("sg-collapsed"); const a = sec.querySelector(".sg-cat-arrow"); if (a) a.textContent = "▾"; }
                    else { sec.classList.add("sg-collapsed"); const a = sec.querySelector(".sg-cat-arrow"); if (a) a.textContent = "▸"; }
                });
            }
        }));

        // Compact
        let compactMode = localStorage.getItem("sg_compact") === "1";
        const btnCompact = el("button", {
            className: "sg-btn sg-btn-secondary" + (compactMode ? " sg-active" : ""), textContent: "▪", title: "Compact mode",
            onClick: function () { compactMode = !compactMode; localStorage.setItem("sg_compact", compactMode ? "1" : "0"); panel.classList.toggle("sg-compact", compactMode); btnCompact.classList.toggle("sg-active", compactMode); }
        });
        if (compactMode) panel.classList.add("sg-compact");
        searchRow.appendChild(btnCompact);

        // Refresh
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "🔄", title: "Refresh styles", onClick: function () { refreshPanel(tabName); } }));

        // Table editor (current source CSV)
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "📋",
            title: "Edit all styles in the selected CSV (table)",
            onClick: function () { openCsvTableEditor(tabName); },
        }));

        // New style
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "➕", title: "Create new style", onClick: function () { openStyleEditor(tabName, null); } }));

        // Import/Export
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "📥", title: "Import/Export", onClick: function () { showExportImport(tabName); } }));

        // Manual backup
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "💾",
            title: "Backup all CSV style files manually. Saves a timestamped copy to data/backups/ (keeps last 20).",
            onClick: function () { runManualStyleBackup(tabName); }
        }));

        // Thumbnail cleanup — remove orphaned previews
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "🧹",
            title: "Clean up orphaned thumbnail previews. Removes preview images for styles that no longer exist in any CSV.",
            onClick: function () {
                if (!confirm("Remove preview images for styles that no longer exist in any CSV?")) return;
                apiPost("/style_grid/thumbnails/cleanup").then(function (r) {
                    if (r && r.removed !== undefined) {
                        alert("Cleaned up " + r.removed + " orphaned thumbnail(s).");
                    } else {
                        alert("Cleanup failed.");
                    }
                }).catch(function () {
                    showStatusMessage(tabName, "Cleanup failed", true);
                });
            }
        }));

        // Clear
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "Clear", title: "Clear all selections", onClick: function () { clearAll(tabName); } }));

        // Close
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-close", textContent: "✕", title: "Close", onClick: function () { togglePanel(tabName, false); } }));

        return searchRow;
        }
        var header = _buildPanelHeader();
        header.appendChild(_buildSourceList());
        panel.appendChild(header);

        function _buildCategoryGrid() {
        // ---- Body ----
        const body = el("div", { className: "sg-body" });
        const main = el("div", { className: "sg-main", id: "sg_main_" + tabName });
        const showSidebar = sortedCats.length > 5;
        const favSet = getFavorites(tabName);

        function showOnlyCategory(catId) {
            qsa(".sg-category", main).forEach(function (sec) {
                const vis = sec.querySelectorAll(".sg-card:not(.sg-card-hidden)").length;
                if (vis === 0) { sec.style.display = "none"; return; }
                if (catId === null) { sec.style.display = ""; }
                else { sec.style.display = (sec.getAttribute("data-category") === catId) ? "" : "none"; }
            });
        }

        if (showSidebar) {
            const sidebar = el("div", { className: "sg-sidebar" });
            sidebar.appendChild(el("div", { className: "sg-sidebar-label", textContent: "Categories" }));
            const btnAll = el("button", { type: "button", className: "sg-sidebar-btn sg-sidebar-btn-all sg-active", textContent: "All", onClick: function () { showOnlyCategory(null); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); btnAll.classList.add("sg-active"); } });
            sidebar.appendChild(btnAll);
            sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: "★ Favorites", onClick: function () { showOnlyCategory("FAVORITES"); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); this.classList.add("sg-active"); } }));
            sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: "🕑 Recent", onClick: function () { showOnlyCategory("RECENT"); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); this.classList.add("sg-active"); } }));
            sortedCats.forEach(function (catName) {
                var btn = el("button", {
                    type: "button",
                    className: "sg-sidebar-btn",
                    "data-category": catName,
                    textContent: catName,
                    draggable: "true",
                    onClick: function () {
                        showOnlyCategory(catName);
                        qsa(".sg-sidebar-btn", sidebar).forEach(function (b) {
                            b.classList.remove("sg-active");
                        });
                        btn.classList.add("sg-active");
                    }
                });

                btn.addEventListener("dragstart", function (e) {
                    e.dataTransfer.setData("text/plain", catName);
                    e.dataTransfer.effectAllowed = "move";
                    btn.classList.add("sg-sidebar-dragging");
                });
                btn.addEventListener("dragend", function () {
                    btn.classList.remove("sg-sidebar-dragging");
                    qsa(".sg-sidebar-btn", sidebar).forEach(function (b) {
                        b.classList.remove("sg-drag-over-top", "sg-drag-over-bottom");
                    });
                });
                btn.addEventListener("dragover", function (e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    // Clear ALL sidebar buttons first — same pattern as footer tags
                    qsa(".sg-sidebar-btn[data-category]", sidebar).forEach(function (b) {
                        b.classList.remove("sg-drag-over-top", "sg-drag-over-bottom");
                    });
                    var rect = btn.getBoundingClientRect();
                    var midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                        btn.classList.add("sg-drag-over-top");
                    } else {
                        btn.classList.add("sg-drag-over-bottom");
                    }
                });
                btn.addEventListener("dragleave", function () {
                    btn.classList.remove("sg-drag-over-top", "sg-drag-over-bottom");
                });
                btn.addEventListener("drop", function (e) {
                    e.preventDefault();
                    qsa(".sg-sidebar-btn[data-category]", sidebar).forEach(function (b) {
                        b.classList.remove("sg-drag-over-top", "sg-drag-over-bottom");
                    });
                    var fromCat = e.dataTransfer.getData("text/plain");
                    if (!fromCat || fromCat === catName) return;

                    // Reorder sortedCats in-place
                    var fromIdx = sortedCats.indexOf(fromCat);
                    var toIdx = sortedCats.indexOf(catName);
                    if (fromIdx === -1 || toIdx === -1) return;

                    var rect2 = btn.getBoundingClientRect();
                    var insertIdx = e.clientY < (rect2.top + rect2.height / 2) ? toIdx : toIdx + 1;
                    sortedCats.splice(fromIdx, 1);
                    if (fromIdx < insertIdx) insertIdx--;
                    sortedCats.splice(insertIdx, 0, fromCat);

                    // Save custom order
                    saveCategoryOrder(sortedCats);

                    // Rebuild grid to match new order
                    rebuildGridCards(tabName);
                });

                sidebar.appendChild(btn);
            });
            body.appendChild(sidebar);
        } else {
            const filterBar = el("div", { className: "sg-filter-bar" });
            const fAll = el("button", { type: "button", className: "sg-filter-btn sg-active", textContent: "All", onClick: function () { showOnlyCategory(null); fAll.classList.add("sg-active"); fFav.classList.remove("sg-active"); } });
            const fFav = el("button", { type: "button", className: "sg-filter-btn", textContent: "★ Favorites", onClick: function () { showOnlyCategory("FAVORITES"); fFav.classList.add("sg-active"); fAll.classList.remove("sg-active"); } });
            filterBar.appendChild(fAll);
            filterBar.appendChild(fFav);
            body.appendChild(filterBar);
        }

        // Build favorites section
        const favStyles = [];
        sortedCats.forEach(function (catName) {
            (categories[catName] || []).forEach(function (s) { if (favSet.has(s.name)) favStyles.push(s); });
        });
        appendCategorySection(main, "★ " + FAV_CAT, favStyles, "#eab308", true, tabName);

        // Build recent section
        const recentHistory = getRecentHistory(tabName);
        const recentStyles = [];
        recentHistory.slice(0, 10).forEach(function (n) {
            const s = findStyleByName(tabName, n);
            if (s) recentStyles.push(s);
        });
        if (recentStyles.length > 0) {
            appendCategorySection(main, "🕑 RECENT", recentStyles, "#8b5cf6", false, tabName, "RECENT");
        }

        // Build category sections
        sortedCats.forEach(function (catName) {
            const styles = categories[catName];
            if (!styles || styles.length === 0) return;
            appendCategorySection(main, catName, styles, getCategoryColor(catName), false, tabName);
        });

        body.appendChild(main);
        panel.appendChild(body);
        }
        _buildCategoryGrid();

        function _buildPanelFooter() {
        const footer = el("div", { className: "sg-footer", id: "sg_footer_" + tabName });
        footer.appendChild(el("span", { className: "sg-footer-label", textContent: "Selected: " }));
        footer.appendChild(el("div", { className: "sg-footer-tags", id: "sg_tags_" + tabName }));
        const combosRow = el("div", {
            className: "sg-combos-row",
            id: "sg_combos_" + tabName
        });
        combosRow.style.display = "none";
        footer.appendChild(combosRow);
        panel.appendChild(footer);
        }
        _buildPanelFooter();

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        state[tabName].panel = overlay;
        filterStyles(tabName);
        loadThumbnailList(tabName);
        return overlay;
    }

    function rebuildGridCards(tabName) {
      const wasVisible =
        state[tabName].panel &&
        state[tabName].panel.classList.contains("sg-visible");
      const savedSelection = new Set(state[tabName].selected);
      const savedOrder = (state[tabName].selectedOrder || []).slice();
      const savedApplied = new Map(state[tabName].applied);
      if (state[tabName].panel) {
        state[tabName].panel.remove();
        state[tabName].panel = null;
      }
      buildPanel(tabName);
      state[tabName].selectedOrder = savedOrder.filter(function (n) { return savedSelection.has(n); });
      savedSelection.forEach(function (n) {
        state[tabName].selected.add(n);
        if (state[tabName].selectedOrder.indexOf(n) === -1) state[tabName].selectedOrder.push(n);
        qsa(
          '.sg-card[data-style-name="' + CSS.escape(n) + '"]',
          state[tabName].panel,
        ).forEach(function (c) {
          c.classList.add("sg-selected");
          if (savedApplied.has(n)) c.classList.add("sg-applied");
        });
      });
      state[tabName].applied = savedApplied;
      updateSelectedUI(tabName);
      if (wasVisible) state[tabName].panel.classList.add("sg-visible");
    }

    // -----------------------------------------------------------------------
    // Build a category section
    // -----------------------------------------------------------------------
    function appendCategorySection(container, catName, styles, color, isFav, tabName, overrideCatId) {
        const catId = overrideCatId || (isFav ? "FAVORITES" : catName);
        const section = el("div", { className: "sg-category", "data-category": catId });
        section.id = "sg-cat-" + catId.replace(/\s/g, "_");

        const catHeader = el("div", { className: "sg-cat-header" });
        catHeader.style.borderLeftColor = color;
        const catTitle = el("span", { className: "sg-cat-title" });
        const catBadge = el("span", { className: "sg-cat-badge" }); catBadge.style.backgroundColor = color; catBadge.textContent = catName;
        catTitle.appendChild(catBadge);
        catTitle.appendChild(document.createTextNode(" (" + styles.length + ")"));
        const catArrow = el("span", { className: "sg-cat-arrow", textContent: "▾" });
        const catSelectAll = el("button", {
            className: "sg-cat-select-all", textContent: "Select All",
            onClick: function (e) { e.stopPropagation(); toggleCategoryAll(tabName, catId); }
        });
        catHeader.appendChild(catTitle);
        catHeader.appendChild(catSelectAll);
        catHeader.appendChild(catArrow);
        catHeader.addEventListener("click", function () {
            section.classList.toggle("sg-collapsed");
            catArrow.textContent = section.classList.contains("sg-collapsed") ? "▸" : "▾";
            saveCollapsedCategories(tabName);
        });
       catHeader.addEventListener("contextmenu", function (e) {
           e.preventDefault();
           e.stopPropagation();
           const old = qs(".sg-context-menu"); if (old) old.remove();
           const menu = el("div", { className: "sg-context-menu" });
           menu.style.left = e.clientX + "px"; menu.style.top = e.clientY + "px";
           const item = el("div", {
               className: "sg-ctx-item",
               textContent: "🎲 Add category as wildcard",
               onClick: function () {
                   menu.remove();
                   const wcTag = "{sg:" + catId.toLowerCase() + "}";
                   const promptEl = qs("#" + tabName + "_prompt textarea");
                   if (promptEl) {
                       const sep = promptEl.value.trim() ? ", " : "";
                       setPromptValue(promptEl, promptEl.value.replace(/,\s*$/, "") + sep + wcTag);
                   }
               }
           });
           menu.appendChild(item);

           // Batch thumbnail generation for this category
           var stylesInCat = styles || [];
           var activeSource = state[tabName].selectedSource || "All";
           if (activeSource !== "All") {
               stylesInCat = stylesInCat.filter(function (s) { return s.source === activeSource; });
           }
           var missingCount = 0;
           stylesInCat.forEach(function (s) {
               if (!state[tabName].hasThumbnail.has(s.name)) missingCount++;
           });
           if (missingCount > 0) {
               var batchItem = el("div", {
                   className: "sg-ctx-item",
                   textContent: "🎨 Generate previews (" + missingCount + " missing)",
                   onClick: function () {
                       menu.remove();
                       startBatchThumbnails(tabName, catId, stylesInCat);
                   }
               });
               menu.appendChild(batchItem);
           }

           document.body.appendChild(menu);
           setTimeout(function () {
               const close = function () { menu.remove(); document.removeEventListener("click", close); };
               document.addEventListener("click", close);
           }, 0);
       });
        section.appendChild(catHeader);

        // Restore collapsed state from localStorage
        var collapsedList = getCollapsedCategories();
        if (collapsedList.indexOf(catId) !== -1) {
            section.classList.add("sg-collapsed");
            catArrow.textContent = "▸";
        }

        const grid = el("div", { className: "sg-grid" });
        styles.forEach(function (style) {
            const card = el("div", {
                className: "sg-card" + (style.has_placeholder ? " sg-has-placeholder" : ""),
                "data-style-name": style.name,
                "data-category": catId,
                "data-search-name": buildSearchText(style),
                "data-source": style.source || "",
            });
            card._styleRef = style;
            card.style.setProperty("--cat-color", color);
            if (state[tabName].selected.has(style.name)) { card.classList.add("sg-selected"); card.classList.add("sg-applied"); }

            const icons = el("div", { className: "sg-card-icons" });
            const check = el("span", { className: "sg-card-check", textContent: "✓" });
            icons.appendChild(check);
            const star = el("span", {
                className: "sg-card-star" + (getFavorites(tabName).has(style.name) ? " sg-fav" : ""),
                title: "Toggle favorite", textContent: "★",
                onClick: function (e) {
                    e.stopPropagation();
                    toggleFavorite(tabName, style.name);
                    star.classList.toggle("sg-fav", getFavorites(tabName).has(style.name));
                }
            });
            icons.appendChild(star);
            card.appendChild(icons);

            const usage = state[tabName].usage || {};
            const uCount = (usage[style.name] || {}).count || 0;
            if (uCount > 0) {
                const uBadge = el("span", { className: "sg-card-usage", textContent: uCount.toString(), title: "Used " + uCount + " times" });
                card.appendChild(uBadge);
            }

            card.appendChild(el("div", { className: "sg-card-name", textContent: style.display_name || style.name }));

            card.addEventListener("click", function () { toggleStyle(tabName, style.name, card); });
            card.addEventListener("contextmenu", function (e) { showContextMenu(e, tabName, style.name, style); });

            card.addEventListener("mouseenter", function () {
                var name = card.getAttribute("data-style-name");
                var displayName = (card.querySelector(".sg-card-name") || {}).textContent
                    || name;
                var styleRef = card._styleRef;
                var promptText = styleRef ? (styleRef.prompt || "") : "";

                clearTimeout(_thumbHoverTimer);
                _thumbHoverTimer = setTimeout(function () {
                    showThumbPopup(card, name, tabName, displayName, promptText);
                }, 700);

                if (state[tabName].hasThumbnail && state[tabName].hasThumbnail.has(name)) {
                    card.classList.add("sg-thumb-loading");
                    _thumbProgressTimer = setTimeout(function () {
                        card.classList.remove("sg-thumb-loading");
                    }, 700);
                }

                updateCombosPanel(tabName, name);
            });

            card.addEventListener("mouseleave", function () {
                clearTimeout(_thumbHoverTimer);
                clearTimeout(_thumbProgressTimer);
                card.classList.remove("sg-thumb-loading");
                hideThumbPopup();
                var lastSelected = state[tabName].selectedOrder.length > 0
                    ? state[tabName].selectedOrder[state[tabName].selectedOrder.length - 1]
                    : null;
                updateCombosPanel(tabName, lastSelected);
            });

            grid.appendChild(card);
        });
        section.appendChild(grid);
        container.appendChild(section);
    }

    function createThumbPopup() {
        if (_thumbPopup) return _thumbPopup;
        var popup = el("div", { className: "sg-thumb-popup" });

        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "sg-thumb-progress");
        svg.setAttribute("viewBox", "0 0 36 36");
        var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("class", "sg-thumb-progress-ring");
        circle.setAttribute("cx", "18");
        circle.setAttribute("cy", "18");
        circle.setAttribute("r", "15");
        svg.appendChild(circle);
        popup.appendChild(svg);

        var img = el("img", { className: "sg-thumb-img" });
        img.style.display = "none";
        popup.appendChild(img);

        var info = el("div", { className: "sg-thumb-info" });
        popup.appendChild(info);

        document.body.appendChild(popup);
        _thumbPopup = popup;
        return popup;
    }

    function showThumbPopup(card, styleName, tabName, displayName, promptText) {
        var popup = createThumbPopup();
        var hasThumbnail = state[tabName].hasThumbnail.has(styleName);

        var rect = card.getBoundingClientRect();
        var popupW = 253;
        var left = rect.right + 10;
        if (left + popupW > window.innerWidth - 20) {
            left = rect.left - popupW - 10;
        }
        var top = Math.max(10, Math.min(
            rect.top,
            window.innerHeight - 300
        ));
        popup.style.left = left + "px";
        popup.style.top = top + "px";

        var img = popup.querySelector(".sg-thumb-img");
        var info = popup.querySelector(".sg-thumb-info");
        var svg = popup.querySelector(".sg-thumb-progress");
        img.style.display = "none";
        svg.style.display = "block";
        popup.classList.add("sg-thumb-popup-visible");

        info.innerHTML = "";
        info.appendChild(el("div", {
            className: "sg-thumb-name",
            textContent: displayName
        }));
        if (promptText) {
            info.appendChild(el("div", {
                className: "sg-thumb-prompt",
                textContent: promptText.length > 100
                    ? promptText.slice(0, 100) + "…"
                    : promptText
            }));
        }
        if (!hasThumbnail) {
            info.appendChild(el("div", {
                className: "sg-thumb-hint",
                textContent: "Right-click → Upload preview image"
            }));
            svg.style.display = "none";
            return;
        }

        var url = "/style_grid/thumbnail?name=" +
            encodeURIComponent(styleName) + "&t=" +
            (_thumbVersions[styleName] || Date.now());
        img.onload = function () {
            svg.style.display = "none";
            img.style.display = "block";
        };
        img.onerror = function () {
            svg.style.display = "none";
            img.style.display = "none";
        };
        img.src = url;
    }

    function hideThumbPopup() {
        clearTimeout(_thumbHoverTimer);
        clearTimeout(_thumbProgressTimer);
        _thumbHoverTimer = null;
        if (_thumbPopup) {
            _thumbPopup.classList.remove("sg-thumb-popup-visible");
            var img = _thumbPopup.querySelector(".sg-thumb-img");
            if (img) { img.src = ""; img.style.display = "none"; }
        }
    }

    // -----------------------------------------------------------------------
    // Search autocomplete suggestions
    // -----------------------------------------------------------------------
    function buildSuggestions(tabName) {
        const sugg = new Set();
        var selectedSource = state[tabName].selectedSource || "All";
        Object.values(state[tabName].categories || {}).forEach(function (arr) {
            arr.forEach(function (style) {
                if (selectedSource === "All" || style.source === selectedSource) {
                    sugg.add(style.display_name || style.name);
                }
            });
        });
        return Array.from(sugg);
    }

    // -----------------------------------------------------------------------
    // Interaction handlers
    // -----------------------------------------------------------------------
    function updateCombosPanel(tabName, styleName) {
        var panel = state[tabName].panel;
        if (!panel) return;

        var combosEl = qs("#sg_combos_" + tabName, panel);
        if (!combosEl) return;

        if (!styleName) {
            combosEl.style.display = "none";
            return;
        }

        var style = findStyleByName(tabName, styleName);
        if (!style || !style.description) {
            combosEl.style.display = "none";
            return;
        }

        var parsed = parseDescription(style.description);
        if (!parsed.combos.length && !parsed.conflicts.length && !parsed.text) {
            combosEl.style.display = "none";
            return;
        }

        combosEl.innerHTML = "";
        combosEl.style.display = "flex";

        // Description text (truncated)
        if (parsed.text) {
            var descEl = el("span", {
                className: "sg-combo-desc",
                textContent: parsed.text.length > 80
                    ? parsed.text.slice(0, 80) + "…"
                    : parsed.text
            });
            descEl.title = parsed.text;
            combosEl.appendChild(descEl);
        }

        // Combos
        if (parsed.combos.length) {
            var labelEl = el("span", {
                className: "sg-combo-label",
                textContent: "Works with:"
            });
            combosEl.appendChild(labelEl);

            var loadedStyles = getLoadedStylesWithCategory(tabName);
            parsed.combos.forEach(function (comboStr) {
                var resolved = resolveComboItem(tabName, comboStr, loadedStyles);
                var chip = el("span", { className: "sg-combo-chip" });

                if (resolved.type === "style") {
                    chip.textContent = resolved.label;
                    chip.classList.add("sg-combo-chip-style");
                    var alreadySelected = state[tabName].selected.has(resolved.styleName);
                    if (alreadySelected) chip.classList.add("sg-combo-chip-active");
                    chip.title = resolved.styleName;
                    chip.addEventListener("click", function () {
                        var cardEl = qs('.sg-card[data-style-name="' + CSS.escape(resolved.styleName) + '"]', panel);
                        if (!cardEl) cardEl = { classList: { remove: function () {} } };
                        toggleStyle(tabName, resolved.styleName, cardEl);
                        chip.classList.toggle("sg-combo-chip-active", state[tabName].selected.has(resolved.styleName));
                    });

                } else if (resolved.type === "wildcard") {
                    chip.textContent = resolved.label;
                    chip.classList.add("sg-combo-chip-cat");
                    chip.title = "Filter styles by prefix " + (resolved.searchPrefix || resolved.label);
                    chip.addEventListener("click", function () {
                        var searchEl = qs("#sg_search_" + tabName, panel);
                        if (searchEl && resolved.searchPrefix) {
                            searchEl.value = resolved.searchPrefix;
                            searchEl.dispatchEvent(new Event("input", { bubbles: true }));
                            searchEl.focus();
                        }
                    });
                } else {
                    // Plain text — not a valid category or style, gray non-clickable
                    chip.textContent = resolved.label;
                    chip.classList.add("sg-combo-chip-hint");
                }

                combosEl.appendChild(chip);
            });
        }

        // Conflicts warning
        if (parsed.conflicts.length) {
            var conflLabel = el("span", {
                className: "sg-combo-label sg-combo-conflict-label",
                textContent: "⚠ Avoid:"
            });
            combosEl.appendChild(conflLabel);
            parsed.conflicts.forEach(function (c) {
                combosEl.appendChild(el("span", {
                    className: "sg-combo-chip sg-combo-chip-conflict",
                    textContent: c
                }));
            });
        }
    }

    function showSourcePicker(tabName, styleName, anchorCard) {
        // Remove any existing picker
        var old = qs(".sg-source-picker");
        if (old) old.remove();

        var ownSource = anchorCard.getAttribute("data-source");
        var ownStyle = anchorCard._styleRef;
        var variants = anchorCard._sourceVariants || [];
        var allVariants = (ownSource && ownStyle)
            ? [{ source: ownSource, style: ownStyle }].concat(variants)
            : variants;
        if (allVariants.length < 2) return;

        var picker = el("div", { className: "sg-source-picker" });
        picker.appendChild(el("div", {
            className: "sg-source-picker-title",
            textContent: "Source for \"" + (anchorCard.querySelector(".sg-card-name") || {}).textContent + "\":"
        }));

        allVariants.forEach(function (v) {
            var sourceLabel = v.source.replace(/\.csv$/i, "").replace(/^styles_?/i, "") || v.source;
            var row = el("div", { className: "sg-source-picker-row" });
            row.appendChild(el("span", {
                className: "sg-source-picker-name",
                textContent: sourceLabel
            }));
            // Show first few prompt tags as preview
            var preview = (v.style.prompt || "").split(",").slice(0, 3).map(function (t) { return t.trim(); }).filter(Boolean).join(", ");
            if (preview.length > 60) preview = preview.slice(0, 60) + "…";
            row.appendChild(el("span", {
                className: "sg-source-picker-preview",
                textContent: preview
            }));
            row.addEventListener("click", function (e) {
                e.stopPropagation();
                picker.remove();
                // Temporarily swap card's styleRef to chosen source
                anchorCard._styleRef = v.style;
                anchorCard.setAttribute("data-source", v.source);
                anchorCard._sourceVariants = [];
                toggleStyle(tabName, styleName, anchorCard);
            });
            picker.appendChild(row);
        });

        // Position near the card
        var rect = anchorCard.getBoundingClientRect();
        picker.style.position = "fixed";
        picker.style.zIndex = "10005";
        if (rect.width > 0 && rect.height > 0) {
            // Card is on-screen — position beside it
            picker.style.left = Math.min(rect.right + 8, window.innerWidth - 260) + "px";
            picker.style.top = Math.max(8, rect.top) + "px";
        } else {
            // Card is in a hidden/collapsed category — center the picker
            picker.style.left = Math.max(8, Math.round((window.innerWidth - 260) / 2)) + "px";
            picker.style.top = Math.max(8, Math.round((window.innerHeight - 200) / 2)) + "px";
        }

        document.body.appendChild(picker);

        // Auto-close on outside click
        setTimeout(function () {
            var close = function (e2) {
                if (!picker.contains(e2.target)) {
                    picker.remove();
                    document.removeEventListener("click", close);
                }
            };
            document.addEventListener("click", close);
        }, 0);
    }

    function toggleStyle(tabName, styleName, cardEl) {
        // If card has multiple source variants and style is not yet selected,
        // show source picker instead of immediately toggling
        var cardElResolved = cardEl || qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]:not(.sg-card-hidden)', state[tabName].panel)[0];
        if (cardElResolved && cardElResolved._sourceVariants && cardElResolved._sourceVariants.length > 1
            && !state[tabName].selected.has(styleName)) {
            showSourcePicker(tabName, styleName, cardElResolved);
            return;
        }
        cardEl = cardElResolved || cardEl;

        if (state[tabName].selected.has(styleName)) {
            state[tabName].selected.delete(styleName);
            state[tabName].selectedOrder = state[tabName].selectedOrder.filter(function (n) { return n !== styleName; });
            cardEl.classList.remove("sg-selected");
            cardEl.classList.remove("sg-applied");
            unapplyStyle(tabName, styleName);
            // Also update all duplicate cards (e.g. in favorites)
            qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) {
                c.classList.remove("sg-selected");
                c.classList.remove("sg-applied");
            });
        } else {
            state[tabName].selected.add(styleName);
            if (state[tabName].selectedOrder.indexOf(styleName) === -1) state[tabName].selectedOrder.push(styleName);
            applyStyleImmediate(tabName, styleName);
            // Update all matching cards
            qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) {
                c.classList.add("sg-selected");
                c.classList.add("sg-applied");
            });
            addToRecentHistory(tabName, [styleName]);
            if (!state[tabName].usage[styleName]) {
                state[tabName].usage[styleName] = { count: 0 };
            }
            state[tabName].usage[styleName].count =
                (state[tabName].usage[styleName].count || 0) + 1;
        }
        updateSelectedUI(tabName);
        // Check conflicts
        updateConflicts(tabName);
        var lastSelected = state[tabName].selectedOrder.length > 0
            ? state[tabName].selectedOrder[state[tabName].selectedOrder.length - 1]
            : null;
        updateCombosPanel(tabName, lastSelected);
    }

    function clearAll(tabName) {
        state[tabName].applied.forEach(function (_, n) { unapplyStyle(tabName, n); });
        state[tabName].selected.clear();
        state[tabName].selectedOrder = [];
        state[tabName].applied.clear();
        state[tabName].userPromptBase = "";
        state[tabName].userPromptBaseNeg = "";
        if (state[tabName].panel) {
            qsa(".sg-card.sg-selected, .sg-card.sg-applied", state[tabName].panel).forEach(function (c) { c.classList.remove("sg-selected"); c.classList.remove("sg-applied"); });
        }
        setSilentGradio(tabName);
        updateSelectedUI(tabName);
        updateConflicts(tabName);
        updateCombosPanel(tabName, null);
    }

    function toggleCategoryAll(tabName, catName) {
        const cards = qsa('.sg-category[data-category="' + catName + '"] .sg-card', state[tabName].panel);
        const allSelected = Array.from(cards).every(function (c) { return c.classList.contains("sg-selected"); });
        cards.forEach(function (c) {
            const name = c.getAttribute("data-style-name");
            if (allSelected) {
                unapplyStyle(tabName, name);
                state[tabName].selected.delete(name);
                state[tabName].selectedOrder = state[tabName].selectedOrder.filter(function (n) { return n !== name; });
                c.classList.remove("sg-selected");
                c.classList.remove("sg-applied");
            } else {
                if (!state[tabName].selected.has(name)) {
                    state[tabName].selected.add(name);
                    if (state[tabName].selectedOrder.indexOf(name) === -1) state[tabName].selectedOrder.push(name);
                    applyStyleImmediate(tabName, name);
                }
                c.classList.add("sg-selected");
                c.classList.add("sg-applied");
            }
        });
        updateSelectedUI(tabName);
        updateConflicts(tabName);
        updateCombosPanel(tabName, state[tabName].selectedOrder.length > 0
            ? state[tabName].selectedOrder[state[tabName].selectedOrder.length - 1]
            : null);
        saveCollapsedCategories(tabName);
    }

    function filterStyles(tabName) {
        const panel = state[tabName].panel;
        if (!panel) return;
        const searchEl = qs("#sg_search_" + tabName, panel);
        const rawQuery = searchEl ? normalizeSearchText(searchEl.value) : "";
        const selectedSource = state[tabName].selectedSource || "All";

        function sourceFilter(src) {
            return selectedSource === "All" || src === selectedSource;
        }

        function cardPasses(card) {
            if (!sourceFilter(card.getAttribute("data-source") || "")) return false;

            if (!rawQuery) return true;

            var searchName = card.getAttribute("data-search-name") || "";
            var style = card._styleRef;
            var desc = (style && style.description || "").toLowerCase();

            return rawQuery.split(/\s+/).filter(Boolean).every(function (t) {
                return searchName.indexOf(t) !== -1 || desc.indexOf(t) !== -1;
            });
        }

        requestAnimationFrame(function () {
            // Dedup: when "All Sources", show only first card per name per category
            var dedupEnabled = selectedSource === "All";
            var seenPerCat = {};

            // Always reset variants first; will be re-populated below if dedupEnabled
            qsa(".sg-card", panel).forEach(function (card) {
                card._sourceVariants = [];
            });

            qsa(".sg-card", panel).forEach(function (card) {
                var visible = cardPasses(card);

                if (visible && dedupEnabled) {
                    var styleName = card.getAttribute("data-style-name");
                    var cat = card.getAttribute("data-category") || "_";
                    if (!seenPerCat[cat]) seenPerCat[cat] = {};
                    if (seenPerCat[cat][styleName]) {
                        // This is a duplicate — hide it, but record its source
                        // on the first (visible) card
                        var firstCard = seenPerCat[cat][styleName];
                        if (!firstCard._sourceVariants) firstCard._sourceVariants = [];
                        var dupSource = card.getAttribute("data-source") || "";
                        var dupStyle = card._styleRef;
                        if (dupSource && dupStyle) {
                            firstCard._sourceVariants.push({
                                source: dupSource,
                                style: dupStyle
                            });
                        }
                        visible = false;
                    } else {
                        // First occurrence — store card ref, init variants with own source
                        card._sourceVariants = [];
                        var ownSource = card.getAttribute("data-source") || "";
                        if (ownSource && card._styleRef) {
                            card._sourceVariants.push({
                                source: ownSource,
                                style: card._styleRef
                            });
                        }
                        seenPerCat[cat][styleName] = card;
                    }
                }

                card.classList.toggle("sg-card-hidden", !visible);
            });

            qsa(".sg-category", panel).forEach(function (sec) {
                const visible = sec.querySelectorAll(".sg-card:not(.sg-card-hidden)").length;
                const ct = sec.querySelector(".sg-cat-title");
                if (ct && ct.childNodes.length >= 2)
                    ct.childNodes[1].textContent = " (" + visible + ")";
                sec.style.display = visible > 0 ? "" : "none";
            });

            const sidebar = panel.querySelector(".sg-sidebar");
            if (sidebar) {
                qsa(".sg-sidebar-btn[data-category]", sidebar).forEach(function (btn) {
                    const sec = panel.querySelector(
                        "#sg-cat-" +
                        (btn.getAttribute("data-category") || "").replace(/\s/g, "_")
                    );
                    btn.style.display =
                        (!sec || sec.querySelectorAll(".sg-card:not(.sg-card-hidden)").length > 0)
                        ? "" : "none";
                });
            }
        });
    }

    function rebuildPromptFromOrder(tabName) {
        if (state[tabName].silentMode) {
            setSilentGradio(tabName);
            return;
        }
        const promptEl = qs("#" + tabName + "_prompt textarea");
        const negEl = qs("#" + tabName + "_neg_prompt textarea");
        if (!promptEl || !negEl) return;
        const order = state[tabName].selectedOrder || [];
        const orderedApplied = order.filter(function (n) { return state[tabName].applied.has(n); });
        const prompts = orderedApplied.map(function (n) {
            const r = state[tabName].applied.get(n);
            return r && r.prompt ? r.prompt : null;
        }).filter(Boolean);
        const negs = orderedApplied.map(function (n) {
            const r = state[tabName].applied.get(n);
            return r && r.negative ? r.negative : null;
        }).filter(Boolean);
        const base = (state[tabName].userPromptBase || "").trim();
        const newPrompt = base + (prompts.length ? (base ? ", " : "") + prompts.join(", ") : "");
        const baseNeg = (state[tabName].userPromptBaseNeg || "").trim();
        const newNeg = baseNeg + (negs.length ? (baseNeg ? ", " : "") + negs.join(", ") : "");
        setPromptValue(promptEl, newPrompt);
        setPromptValue(negEl, newNeg);
    }

    function updateSelectedUI(tabName) {
        const count = state[tabName].selected.size;
        const countEl = qs("#sg_count_" + tabName);
        if (countEl) countEl.textContent = count + " selected";

        let order = state[tabName].selectedOrder || [];
        order = order.filter(function (n) { return state[tabName].selected.has(n); });
        state[tabName].selected.forEach(function (n) {
            if (order.indexOf(n) === -1) order.push(n);
        });
        state[tabName].selectedOrder = order;

        const tagsEl = qs("#sg_tags_" + tabName);
        if (tagsEl) {
            tagsEl.innerHTML = "";
            order.forEach(function (name) {
                const tag = el("span", { className: "sg-tag", draggable: "true", "data-style-name": name });
                let displayName = name;
                for (const styles of Object.values(state[tabName].categories)) {
                    const f = styles.find(function (s) { return s.name === name; });
                    if (f) { displayName = f.display_name; break; }
                }
                tag.textContent = displayName;
                tag.appendChild(el("span", {
                    className: "sg-tag-remove", textContent: "×",
                    onClick: function (e) {
                        e.stopPropagation();
                        unapplyStyle(tabName, name);
                        state[tabName].selected.delete(name);
                        state[tabName].selectedOrder = state[tabName].selectedOrder.filter(function (n) { return n !== name; });
                        qsa('.sg-card[data-style-name="' + CSS.escape(name) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-selected"); c.classList.remove("sg-applied"); });
                        updateSelectedUI(tabName);
                        updateConflicts(tabName);
                    }
                }));

                tag.addEventListener("dragstart", function (e) {
                    if (e.target.closest(".sg-tag-remove")) { e.preventDefault(); return; }
                    e.dataTransfer.setData("text/plain", name);
                    e.dataTransfer.effectAllowed = "move";
                    tag.classList.add("sg-tag-dragging");
                });
                tag.addEventListener("dragend", function () {
                    tag.classList.remove("sg-tag-dragging");
                    qsa(".sg-tag", tagsEl).forEach(function (t) { t.classList.remove("sg-drag-over-left", "sg-drag-over-right"); });
                });
                tag.addEventListener("dragover", function (e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = this.getBoundingClientRect();
                    const midX = rect.left + rect.width / 2;
                    const newClass = e.clientX < midX ? "sg-drag-over-left" : "sg-drag-over-right";
                    const removeClass = newClass === "sg-drag-over-left" ? "sg-drag-over-right" : "sg-drag-over-left";
                    // Only touch DOM if something actually changed
                    if (!this.classList.contains(newClass)) {
                        qsa(".sg-tag", tagsEl).forEach(function (t) {
                            t.classList.remove("sg-drag-over-left", "sg-drag-over-right");
                        });
                        this.classList.add(newClass);
                    } else if (this.classList.contains(removeClass)) {
                        this.classList.remove(removeClass);
                        this.classList.add(newClass);
                    }
                });
                tag.addEventListener("dragleave", function () {
                    this.classList.remove("sg-drag-over-left", "sg-drag-over-right");
                });
                tag.addEventListener("drop", function (e) {
                    e.preventDefault();
                    const rect = this.getBoundingClientRect();
                    const midX = rect.left + rect.width / 2;
                    qsa(".sg-tag", tagsEl).forEach(function (t) {
                        t.classList.remove("sg-drag-over-left", "sg-drag-over-right");
                    });
                    const fromName = e.dataTransfer.getData("text/plain");
                    if (!fromName || fromName === name) return;
                    const ord = state[tabName].selectedOrder.slice();
                    const fromIdx = ord.indexOf(fromName);
                    const toIdx = ord.indexOf(name);
                    if (fromIdx === -1 || toIdx === -1) return;
                    let insertIdx = e.clientX < midX ? toIdx : toIdx + 1;
                    ord.splice(fromIdx, 1);
                    if (fromIdx < insertIdx) insertIdx--;
                    ord.splice(insertIdx, 0, fromName);
                    state[tabName].selectedOrder = ord;
                    rebuildPromptFromOrder(tabName);
                    updateSelectedUI(tabName);
                });

                tagsEl.appendChild(tag);
            });
        }

        const badge = qs("#sg_btn_badge_" + tabName);
        if (badge) { badge.textContent = count > 0 ? count : ""; badge.style.display = count > 0 ? "flex" : "none"; }
    }

    function updateConflicts(tabName) {
        const conflicts = checkConflictsLocal(tabName);
        const badge = qs("#sg_conflict_" + tabName);
        if (!badge) return;
        // Store conflicts on badge for resolver to read
        badge._conflicts = conflicts;
        if (conflicts.length > 0) {
            badge.style.display = "inline-flex";
            badge.style.cursor = "pointer";
            badge.textContent = "⚠ " + conflicts.length +
                " conflict" + (conflicts.length > 1 ? "s" : "");
            badge.title = "Click to resolve";
        } else {
            badge.style.display = "none";
            badge._conflicts = [];
        }
    }

    function showConflictResolver(tabName, initialConflicts) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });
        let conflicts = initialConflicts || [];

        function render() {
            modal.innerHTML = "";
            modal.appendChild(el("h3", {
                className: "sg-editor-title",
                textContent: "⚠ Style Conflicts (" + conflicts.length + ")"
            }));

            if (conflicts.length === 0) {
                modal.appendChild(el("div", {
                    className: "sg-preset-empty",
                    textContent: "✓ All conflicts resolved!"
                }));
                modal.appendChild(el("button", {
                    className: "sg-btn sg-btn-secondary",
                    textContent: "Close",
                    onClick: function () { overlay.remove(); }
                }));
                return;
            }

            // Auto-fix all button
            const autoFixable = conflicts.filter(function (c) { return c.suggestion === "drop_b"; });
            if (autoFixable.length > 0) {
                modal.appendChild(el("button", {
                    className: "sg-btn sg-btn-primary",
                    textContent: "⚡ Auto-fix all (" + autoFixable.length + ")",
                    style: "margin-bottom: 10px;",
                    onClick: function () {
                        const toRemove = new Set(
                            autoFixable.map(function (c) { return c.styleB; })
                        );
                        toRemove.forEach(function (name) { removeStyleForConflict(tabName, name); });
                        conflicts = checkConflictsLocal(tabName);
                        render();
                    }
                }));
            }

            // Per-conflict rows
            conflicts.forEach(function (conflict) {
                const row = el("div", {
                    style: "padding:10px; margin-bottom:8px; border-radius:6px; " +
                        "border:1px solid rgba(239,68,68,0.3); " +
                        "background:rgba(239,68,68,0.05);"
                });
                row.appendChild(el("div", {
                    textContent: "⚡ " + conflict.tokens.join(", "),
                    style: "font-size:11px; color:#fca5a5; margin-bottom:6px;"
                }));
                row.appendChild(el("div", {
                    textContent: conflict.suggestionText,
                    style: "font-size:12px; color:var(--body-text-color,#d1d5db); " +
                        "margin-bottom:8px;"
                }));
                const btns = el("div", { className: "sg-editor-btns" });
                btns.appendChild(el("button", {
                    className: "sg-btn",
                    style: "background:#dc2626; border-color:#dc2626; color:#fff;",
                    textContent: "Remove \"" + conflict.styleB + "\"",
                    onClick: function () {
                        removeStyleForConflict(tabName, conflict.styleB);
                        conflicts = checkConflictsLocal(tabName);
                        render();
                    }
                }));
                btns.appendChild(el("button", {
                    className: "sg-btn sg-btn-secondary",
                    textContent: "Ignore",
                    onClick: function () {
                        conflicts = conflicts.filter(function (c) { return c !== conflict; });
                        render();
                    }
                }));
                row.appendChild(btns);
                modal.appendChild(row);
            });

            modal.appendChild(el("button", {
                className: "sg-btn sg-btn-secondary",
                textContent: "Close",
                onClick: function () { overlay.remove(); }
            }));
        }

        render();
        overlay.appendChild(modal);
        var conflictOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            conflictOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (conflictOverlayMouseDownTarget === overlay || conflictOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            conflictOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
    }

    function removeStyleForConflict(tabName, name) {
        unapplyStyle(tabName, name);
        state[tabName].selected.delete(name);
        state[tabName].selectedOrder =
            state[tabName].selectedOrder.filter(function (n) { return n !== name; });
        qsa('.sg-card[data-style-name="' + CSS.escape(name) + '"]',
            state[tabName].panel
        ).forEach(function (c) {
            c.classList.remove("sg-selected", "sg-applied");
            c.setAttribute("aria-checked", "false");
        });
        updateSelectedUI(tabName);
        updateConflicts(tabName);
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
                }, "*");
                state[tabName].sgV2HostInitSent = true;
            })
            .catch(function (err) {
                console.error("[Style Grid] v2: failed to load styles for iframe:", err);
            });
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
            console.error("[Style Grid] iframe failed to initialize for tab:", tabName);
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
        if (!state[tabName].sgV2HostInitSent) postSGInitToFrame(tabName);
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
        if (!target) return false;
        const btn = createTriggerButton(tabName);
        if (target.id && target.id.includes("tools")) target.appendChild(btn);
        else if (target.classList.contains("style_create_row")) target.appendChild(btn);
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
                if (state[t].panel && state[t].panel.classList.contains("sg-visible")) { togglePanel(t, false); e.preventDefault(); }
            });
        }
    });

    // ════════════════════════════════════════════════════
    // STATE + INIT (boot, triggers, MutationObserver)
    // ════════════════════════════════════════════════════
    // React iframe bridge (txt2img iframe first; init once via onUiLoaded).
    // Creates iframe wrapper, wires SG_* message bridge, and hydrates host style cache.
    function initSGFrame(tab) {
        var existing = document.getElementById("sg-frame-" + tab);
        if (existing) {
            return existing;
        }
        const frame = document.createElement("iframe");
        frame.id = "sg-frame-" + tab;
        frame.src = "/file=extensions/sd-webui-style-organizer/ui/dist/index.html";
        // Wrap iframe in a resizable container div
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
        // Close panel when clicking anywhere outside the extension window.
        document.addEventListener("mousedown", function (e) {
            if (wrapper.style.display !== "block") return;
            var target = e.target;
            if (!target) return;
            // Ignore trigger button clicks to preserve explicit toggle behavior.
            if (target.closest && target.closest(".sg-trigger-btn")) return;
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
            const msg = e.data;
            // Event-driven refresh path used after SG actions that mutate styles on disk.
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
                        var v2frame = document.getElementById("sg-frame-txt2img");
                        if (v2frame && v2frame.contentWindow) {
                            v2frame.contentWindow.postMessage({
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
                        }, "*");
                        state[tab].sgV2HostInitSent = true;
                    })
                    .catch(function (err) {
                        console.error("[Style Grid] v2: failed to load styles for iframe:", err);
                    });
            }

            if (msg.type === "SG_APPLY") {
                if (msg.silent) {
                    if (!state[tab].selected) state[tab].selected = new Set();
                    state[tab].selected.add(msg.styleId);
                    state[tab].silentMode = true;
                } else {
                    state[tab].silentMode = false;
                    state[tab].selected = new Set();
                }
                window._sgApplyStyle(tab, msg.styleId, { silent: msg.silent });
                setSilentGradio(tab);
            }

            if (msg.type === "SG_UNAPPLY") {
                window._sgUnapplyStyle(tab, msg.styleId);
            }

            if (msg.type === "SG_TOGGLE_SILENT") {
                var t = msg.tab || tab;
                if (state[t]) {
                    state[t].silentMode = msg.value;
                    setSilentMode(t, msg.value);
                    setSilentGradio(t);
                }
            }

            if (msg.type === "SG_REORDER_STYLES") {
                var ids = Array.isArray(msg.styleIds) ? msg.styleIds : [];
                state[tab].selectedOrder = ids;
                
                // Ensure applied Map has all entries
                ids.forEach(function (styleId) {
                    if (!state[tab].applied.has(styleId)) {
                        var styleObj = findStyleByName(styleId);
                        if (styleObj) {
                            state[tab].applied.set(styleId, {
                                prompt: styleObj.prompt,
                                negative: styleObj.negative_prompt,
                                wrapTemplate: null,
                                negWrapTemplate: null,
                                originalPrompt: styleObj.prompt,
                                originalNeg: styleObj.negative_prompt
                            });
                        }
                    }
                });
                
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
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (frame.contentWindow) {
                            frame.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: data.error ? ("Backup failed: " + data.error) : "💾 Backup created",
                                variant: data.error ? "error" : "success"
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
            if (msg.type === "SG_CSV_EDITOR") {
                openCsvTableEditor(tab);
            }
            if (msg.type === "SG_CLEAR_ALL") {
                clearAll(tab);
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
                    var wcTag = "{sg:" + String(catId).toLowerCase() + "}";
                    var promptEl = qs("#" + tab + "_prompt textarea");
                    if (promptEl) {
                        var sep = promptEl.value.trim() ? ", " : "";
                        setPromptValue(promptEl, promptEl.value.replace(/,\s*$/, "") + sep + wcTag);
                    }
                }
            }
            if (msg.type === "SG_GENERATE_CATEGORY_PREVIEWS") {
                var catName = msg.category || "";
                if (catName) {
                    var stylesInCat = ((state[tab] && state[tab].categories && state[tab].categories[catName]) || []).slice();
                    var activeSource = (state[tab] && state[tab].selectedSource) || "All";
                    if (activeSource !== "All") {
                        stylesInCat = stylesInCat.filter(function (s) { return s.source === activeSource; });
                    }
                    startBatchThumbnails(tab, catName, stylesInCat);
                }
            }
            if (msg.type === "SG_GENERATE_PREVIEW") {
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
                });
            }
            if (msg.type === "SG_UPLOAD_PREVIEW") {
                uploadThumbnail(tab, msg.styleId);
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
        });
    } else if (document.body) {
        ensureSGFramesOnce();
    } else {
        document.addEventListener("DOMContentLoaded", ensureSGFramesOnce);
    }
})();
