/**
 * Style Grid - Visual grid/gallery style selector for Forge WebUI
 * v2.0 — Full-featured: silent mode, dynamic apply, presets,
 * conflict detection, context menu, inline editor, etc.
 */

(function () {
    "use strict";

    // ════════════════════════════════════════════════════
    // STATE & STORAGE
    // ════════════════════════════════════════════════════
    const state = {
        txt2img: {
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
        },
        img2img: {
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
        },
    };

    var _thumbPopup = null;      // single shared popup element
    var _thumbHoverTimer = null; // pending hover timer
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
    function qs(sel, root) { return (root || document).querySelector(sel); }
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
    function nameMatchesQuery(text, query) {
        const n = normalizeSearchText(query); if (!n) return true;
        return n.split(/\s+/).filter(Boolean).every(function (t) { return text.includes(t); });
    }
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
    function findCategoryMatch(q, t) {
        if (!q) return null;
        const names = Object.keys(state[t].categories || {});
        if (getFavorites(t).size > 0) names.push("FAVORITES");
        return names.find(function (c) { return c.toLowerCase().startsWith(q); }) || null;
    }
    function findStyleByName(t, n) {
        for (const styles of Object.values(state[t].categories)) {
            const f = styles.find(function (s) { return s.name === n; });
            if (f) return f;
        }
        return null;
    }
    function parseDescription(desc) {
        if (!desc) return { text: "", combos: [], conflicts: [] };

        var result = { text: "", combos: [], conflicts: [] };

        // Extract Combos: section
        var combosMatch = desc.match(/Combos:\s*([^.]+)/i);
        if (combosMatch) {
            result.combos = combosMatch[1]
                .split(";")
                .map(function (s) { return s.trim(); })
                .filter(Boolean);
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
    function resolveComboItem(tabName, comboStr) {
        var s = comboStr.trim();

        // Wildcard: "SCENE_*" or "PALETTE styles" → category link
        if (s.endsWith("_*") || s.toLowerCase().endsWith(" styles")) {
            var cat = s.replace(/_\*$/, "").replace(/\s+styles$/i, "").toUpperCase();
            return { type: "category", label: cat + " (any)", category: cat };
        }

        // Exact style name match
        var found = findStyleByName(tabName, s);
        if (found) {
            return {
                type: "style",
                label: found.display_name || s,
                styleName: s
            };
        }

        // Partial match: "LIGHTING_Dramatic_Shadow" when display is "Dramatic Shadow"
        // Try finding by scanning all categories
        var cats = state[tabName].categories || {};
        for (var catName in cats) {
            var match = cats[catName].find(function (st) {
                return st.name === s || st.display_name === s;
            });
            if (match) {
                return {
                    type: "style",
                    label: match.display_name || match.name,
                    styleName: match.name
                };
            }
        }

        // Unknown — show as plain text hint
        return { type: "hint", label: s };
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
    function setPromptValue(el, value) {
        if (!el) return;
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function setSilentGradio(tabName) {
        // Update the hidden Gradio textbox with silent mode style names
        const silentEl = qs("#style_grid_silent_" + tabName + " textarea");
        if (!silentEl) return;
        const names = state[tabName].silentMode ? [...state[tabName].selected] : [];
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

    // ════════════════════════════════════════════════════
    // API LAYER
    // ════════════════════════════════════════════════════
    // API helpers
    function apiPost(endpoint, data) {
        return fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data || {}),
        }).then(function (r) {
            return r.json();
        });
    }
    function apiGet(endpoint) {
        return fetch(endpoint).then(function (r) { return r.json(); });
    }

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
    function applyStyleImmediate(tabName, styleName) {
        if (state[tabName].applied.has(styleName)) return;
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

        if (state[tabName].applied.size === 0) {
            state[tabName].userPromptBase = promptEl.value;
            state[tabName].userPromptBaseNeg = negEl.value;
        }

        const snapshotPrompt = promptEl.value;
        const snapshotNeg = negEl.value;
        let prompt = promptEl.value;
        let neg = negEl.value;
        let addedPrompt = "";
        let addedNeg = "";

        if (style.prompt) {
            if (style.prompt.includes("{prompt}")) {
                prompt = style.prompt.replace("{prompt}", prompt);
                addedPrompt = null;
            } else {
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
        setPromptValue(promptEl, prompt);
        setPromptValue(negEl, neg);

        // Mark cards
        qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) {
            c.classList.add("sg-applied");
        });
    }

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

        if (record.wrapTemplate && record.originalPrompt != null) {
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

        if (record.negWrapTemplate && record.originalNeg != null) {
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

    // -----------------------------------------------------------------------
    // Context menu
    // -----------------------------------------------------------------------
    function generateThumbnail(tabName, styleName) {
        showStatusMessage(tabName, "🎨 Generating preview for " +
            styleName.split("_").slice(1).join(" ") + "...");

        apiPost("/style_grid/thumbnail/generate", { name: styleName })
            .then(function (r) {
                if (r.error) {
                    showStatusMessage(tabName, "Generation failed: " + r.error, true);
                    return;
                }
                pollGenerationStatus(tabName, styleName, 0);
            })
            .catch(function () {
                showStatusMessage(tabName, "Generation failed", true);
            });
    }

    function pollGenerationStatus(tabName, styleName, attempts) {
        if (attempts > 60) {
            showStatusMessage(tabName, "Generation timed out", true);
            return;
        }
        apiGet("/style_grid/thumbnail/gen_status?name=" +
            encodeURIComponent(styleName))
            .then(function (r) {
                // r could be a FastAPI 404 JSON like {"detail": "Not Found"}
                if (!r || r.detail === "Not Found" || r.status === undefined) {
                    showStatusMessage(tabName, "Generation endpoint not found", true);
                    return;
                }
                if (r.status === "done") {
                    state[tabName].hasThumbnail.add(styleName);
                    qsa('.sg-card[data-style-name="' +
                        CSS.escape(styleName) + '"]',
                        state[tabName].panel)
                        .forEach(function (c) {
                            c.classList.add("sg-has-thumb");
                        });
                    showStatusMessage(tabName, "✓ Preview ready!");
                } else if (r.status === "error") {
                    showStatusMessage(tabName,
                        "Generation failed: " + (r.message || "unknown"), true);
                } else if (r.status === "running" || r.status === "idle") {
                    setTimeout(function () {
                        pollGenerationStatus(tabName, styleName, attempts + 1);
                    }, 2000);
                } else {
                    showStatusMessage(tabName, "Unknown generation status: " + r.status, true);
                }
            })
            .catch(function (err) {
                // Only retry on actual network errors, not HTTP error responses
                // HTTP errors (404, 500) mean something is structurally wrong — stop
                console.error("[Style Grid] Poll error:", err);
                showStatusMessage(tabName, "Generation status unavailable", true);
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

        if (state[tabName].hasThumbnail.has(styleName)) {
            items.push({
                label: "🗑️ Remove preview image",
                action: function () {
                    fetch("/style_grid/thumbnail?name=" +
                        encodeURIComponent(styleName),
                        { method: "DELETE" }
                    ).then(function () {
                        state[tabName].hasThumbnail.delete(styleName);
                        qsa('.sg-card[data-style-name="' +
                            CSS.escape(styleName) + '"]',
                            state[tabName].panel)
                            .forEach(function (c) {
                                c.classList.remove("sg-has-thumb");
                            });
                        showStatusMessage(tabName, "Preview removed");
                    });
                }
            });
        }
        items.forEach(function (item) {
            const btn = el("div", { className: "sg-ctx-item", textContent: item.label, onClick: function () { menu.remove(); item.action(); } });
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        // Auto-close
        setTimeout(function () {
            const close = function () { menu.remove(); document.removeEventListener("click", close); };
            document.addEventListener("click", close);
        }, 0);
    }

    // -----------------------------------------------------------------------
    // Style editor modal
    // -----------------------------------------------------------------------
    function openStyleEditor(tabName, existingStyle) {
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
                    source: existingStyle ? existingStyle.source : null,
                }).then(function () {
                    overlay.remove();
                    refreshPanel(tabName);
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
        overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        nameInput.focus();
    }

    function duplicateStyle(tabName, style) {
        const newName = style.name + "_copy";
        apiPost("/style_grid/style/save", {
            name: newName, prompt: style.prompt || "", negative_prompt: style.negative_prompt || "", source: style.source,
        }).then(function () {
            refreshPanel(tabName);
        }).catch(function (err) {
            console.error("[Style Grid] API error:", err);
        });
    }

    function deleteStyle(tabName, styleName, source) {
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
                    .then(function () { refreshPanel(tabName); })
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
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    }

    function moveToCategory(tabName, style) {
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
                apiPost("/style_grid/style/delete", { name: oldName, source: style.source }).then(function () {
                    return apiPost("/style_grid/style/save", {
                        name: newName,
                        prompt: style.prompt,
                        negative_prompt: style.negative_prompt,
                        source: style.source
                    });
                }).then(function () {
                    overlay.remove();
                    refreshPanel(tabName);
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
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) overlay.remove();
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
        overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
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
                    }).catch(function (err) {
                        console.error("[Style Grid] API error:", err);
                    });
                } catch (e) { alert("Invalid JSON file"); }
            };
            reader.readAsText(file);
        });
        modal.appendChild(importLabel);
        modal.appendChild(importInput);

        modal.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "Close", onClick: function () { overlay.remove(); } }));
        overlay.appendChild(modal);
        overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
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

    // -----------------------------------------------------------------------
    // Dynamic polling for file changes
    // -----------------------------------------------------------------------
    let _pollInterval = null;
    function startPolling() {
        if (_pollInterval) return;
        _pollInterval = setInterval(function () {
            apiGet("/style_grid/check_update").then(function (r) {
                if (r && r.changed) {
                    console.log("[Style Grid] CSV files changed, refreshing...");
                    ["txt2img", "img2img"].forEach(function (t) {
                        if (state[t].panel) refreshPanel(t);
                    });
                }
            }).catch(function (err) {
                console.error("[Style Grid] API error:", err);
            });
        }, 5000);
    }

    // ════════════════════════════════════════════════════
    // PANEL & UI
    // ════════════════════════════════════════════════════
    // Build the Grid Panel
    // -----------------------------------------------------------------------
    function buildPanel(tabName) {
        const categories = loadStyles(tabName);
        state[tabName].categories = categories;
        state[tabName].silentMode = getSilentMode(tabName);
        const catOrder = getCategoryOrder(tabName);

        const catKeys = Object.keys(categories);
        const sortedCats = [];
        catOrder.forEach(function (c) { if (catKeys.includes(c)) sortedCats.push(c); });
        catKeys.forEach(function (c) { if (!sortedCats.includes(c)) sortedCats.push(c); });

        // Overlay
        const overlay = el("div", { className: "sg-overlay", id: "sg_overlay_" + tabName });
        let overlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) { overlayMouseDownTarget = e.target; }, true);
        overlay.addEventListener("click", function (e) { if (e.target === overlay && overlayMouseDownTarget === overlay) togglePanel(tabName, false); overlayMouseDownTarget = null; });

        const panel = el("div", { className: "sg-panel" });

        // ---- Header ----
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

        // Search row
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
            onClick: function () {
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

        // New style
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "➕", title: "Create new style", onClick: function () { openStyleEditor(tabName, null); } }));

        // Import/Export
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "📥", title: "Import/Export", onClick: function () { showExportImport(tabName); } }));

        // Manual backup
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "💾",
            title: "Backup all CSV style files manually. Saves a timestamped copy to data/backups/ (keeps last 20).",
            onClick: function () {
                apiPost("/style_grid/backup").then(function (r) {
                    if (r && r.ok) alert("Backup saved successfully!");
                    else alert("Nothing to backup or backup failed.");
                }).catch(function (err) {
                    console.error("[Style Grid] API error:", err);
                    showStatusMessage(tabName, "Backup failed", true);
                });
            }
        }));

        // Clear
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "Clear", title: "Clear all selections", onClick: function () { clearAll(tabName); } }));

        // Close
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-close", textContent: "✕", title: "Close", onClick: function () { togglePanel(tabName, false); } }));

        header.appendChild(searchRow);
        panel.appendChild(header);

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
                sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", "data-category": catName, textContent: catName, onClick: function () { showOnlyCategory(catName); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); this.classList.add("sg-active"); } }));
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

        // Footer
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
                    const wcTag = "__" + catId.toLowerCase() + "__";
                    const promptEl = qs("#" + tabName + "_prompt textarea");
                    if (promptEl) {
                        const sep = promptEl.value.trim() ? ", " : "";
                        setPromptValue(promptEl, promptEl.value.replace(/,\s*$/, "") + sep + wcTag);
                    }
                }
            });
            menu.appendChild(item);
            document.body.appendChild(menu);
            setTimeout(function () {
                const close = function () { menu.remove(); document.removeEventListener("click", close); };
                document.addEventListener("click", close);
            }, 0);
        });
        section.appendChild(catHeader);

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
        var popupW = 220;
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
            (Math.floor(Date.now() / 86400000));
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
    // Structured search query parsing
    // -----------------------------------------------------------------------
    function parseSearchQuery(rawQuery) {
        const filters = {
            text: [], tag: [], neg: [], cat: null,
            fav: false, hasPlaceholder: false, usedMin: null
        };
        const tokenRegex = /(\w+):("[^"]*"|\S+)/g;
        let match;
        let remaining = rawQuery;
        while ((match = tokenRegex.exec(rawQuery)) !== null) {
            const key = match[1].toLowerCase();
            const val = match[2].replace(/^"|"$/g, "").toLowerCase();
            remaining = remaining.replace(match[0], "").trim();
            if (key === "tag")      filters.tag.push(val);
            else if (key === "neg") filters.neg.push(val);
            else if (key === "cat") filters.cat = val;
            else if (key === "fav" && val === "yes")          filters.fav = true;
            else if (key === "has" && val === "placeholder")  filters.hasPlaceholder = true;
            else if (key === "used") {
                const m = val.match(/^>(\d+)$/);
                if (m) filters.usedMin = parseInt(m[1], 10);
            }
        }
        if (remaining.trim())
            filters.text.push.apply(filters.text, remaining.trim().split(/\s+/).filter(Boolean));
        return filters;
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

            parsed.combos.forEach(function (comboStr) {
                var resolved = resolveComboItem(tabName, comboStr);
                var chip = el("span", { className: "sg-combo-chip" });

                if (resolved.type === "style") {
                    chip.textContent = resolved.label;
                    chip.classList.add("sg-combo-chip-style");
                    var alreadySelected = state[tabName].selected.has(resolved.styleName);
                    if (alreadySelected) chip.classList.add("sg-combo-chip-active");
                    chip.title = resolved.styleName;
                    chip.addEventListener("click", function () {
                        if (state[tabName].selected.has(resolved.styleName)) return;
                        state[tabName].selected.add(resolved.styleName);
                        if (state[tabName].selectedOrder.indexOf(resolved.styleName) === -1)
                            state[tabName].selectedOrder.push(resolved.styleName);
                        applyStyleImmediate(tabName, resolved.styleName);
                        qsa('.sg-card[data-style-name="' +
                            CSS.escape(resolved.styleName) + '"]', panel)
                            .forEach(function (c) {
                                c.classList.add("sg-selected", "sg-applied");
                            });
                        chip.classList.add("sg-combo-chip-active");
                        updateSelectedUI(tabName);
                        updateConflicts(tabName);
                        updateCombosPanel(tabName, styleName);
                    });

                } else if (resolved.type === "category") {
                    chip.textContent = resolved.label;
                    chip.classList.add("sg-combo-chip-cat");
                    chip.title = "Filter to " + resolved.category + " category";
                    chip.addEventListener("click", function () {
                        // Focus search with cat: filter
                        var searchEl = qs("#sg_search_" + tabName, panel);
                        if (searchEl) {
                            searchEl.value = "cat:" + resolved.category.toLowerCase();
                            searchEl.dispatchEvent(new Event("input", { bubbles: true }));
                            searchEl.focus();
                        }
                    });

                } else {
                    // Plain hint — not clickable
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

    function toggleStyle(tabName, styleName, cardEl) {
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
    }

    function filterStyles(tabName) {
        const panel = state[tabName].panel;
        if (!panel) return;
        const searchEl = qs("#sg_search_" + tabName, panel);
        const rawQuery = searchEl ? normalizeSearchText(searchEl.value) : "";
        const selectedSource = state[tabName].selectedSource || "All";
        const filters = parseSearchQuery(rawQuery);

        function sourceFilter(src) {
            return selectedSource === "All" || src === selectedSource;
        }

        function cardPasses(card) {
            const style = card._styleRef;
            if (!sourceFilter(card.getAttribute("data-source") || "")) return false;
            if (filters.fav &&
                !getFavorites(tabName).has(card.getAttribute("data-style-name")))
                return false;
            if (filters.hasPlaceholder &&
                !card.classList.contains("sg-has-placeholder"))
                return false;
            if (filters.cat &&
                (card.getAttribute("data-category") || "").toLowerCase() !== filters.cat)
                return false;
            if (filters.usedMin !== null) {
                console.log("[SG debug] usedMin filter:", filters.usedMin);
                const styleName = card.getAttribute("data-style-name");
                const usageData = state[tabName].usage || {};
                const count = (usageData[styleName] || {}).count || 0;
                if (count <= filters.usedMin) return false;
            }
            if (filters.tag.length && style) {
                const prompt = (style.prompt || "").toLowerCase();
                if (!filters.tag.every(function (t) { return prompt.indexOf(t) !== -1; })) return false;
            }
            if (filters.neg.length && style) {
                const neg = (style.negative_prompt || "").toLowerCase();
                if (!filters.neg.every(function (t) { return neg.indexOf(t) !== -1; })) return false;
            }
            if (filters.text.length) {
                const searchName = card.getAttribute("data-search-name") || "";
                const desc = (style && style.description || "").toLowerCase();
                if (!filters.text.every(function (t) {
                    return searchName.indexOf(t) !== -1 || desc.indexOf(t) !== -1;
                })) return false;
            }
            return true;
        }

        requestAnimationFrame(function () {
            qsa(".sg-card", panel).forEach(function (card) {
                card.classList.toggle("sg-card-hidden", !cardPasses(card));
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
                    qsa(".sg-tag", tagsEl).forEach(function (t) {
                        t.classList.remove("sg-drag-over-left", "sg-drag-over-right");
                    });
                    if (e.clientX < midX) {
                        this.classList.add("sg-drag-over-left");
                    } else {
                        this.classList.add("sg-drag-over-right");
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
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) overlay.remove();
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
    // Toggle panel visibility
    // -----------------------------------------------------------------------
    function togglePanel(tabName, show) {
        var panel = state[tabName].panel;
        if (typeof show === "undefined")
            show = !panel || !panel.classList.contains("sg-visible");

        if (!show) {
            if (panel) panel.classList.remove("sg-visible");
            return;
        }

        var hasData = Object.keys(state[tabName].categories || {}).length > 0;
        if (!panel || !hasData) {
            if (!panel) panel = buildPanel(tabName);
            if (!hasData) {
                apiGet("/style_grid/styles").then(function (data) {
                    state[tabName].categories = data.categories || {};
                    state[tabName].usage = data.usage || {};
                    if (state[tabName].panel) {
                        state[tabName].panel.remove();
                        state[tabName].panel = null;
                    }
                    buildPanel(tabName);
                    state[tabName].panel.classList.add("sg-visible");
                    filterStyles(tabName);
                    var s = qs("#sg_search_" + tabName, state[tabName].panel);
                    if (s) setTimeout(function () { s.focus(); }, 100);
                    loadThumbnailList(tabName);
                }).catch(function (err) {
                    console.error("[Style Grid] Failed to load styles:", err);
                });
                return;
            }
        }

        panel.classList.add("sg-visible");
        filterStyles(tabName);
        setTimeout(function () {
            var s = qs("#sg_search_" + tabName, panel);
            if (s) s.focus();
        }, 100);
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
                if (state[t].panel && state[t].panel.classList.contains("sg-visible")) { togglePanel(t, false); e.preventDefault(); }
            });
        }
    });

    // -----------------------------------------------------------------------
    // Init with MutationObserver re-injection guard
    // -----------------------------------------------------------------------
    function ensureButtons() {
        const t1 = !!qs("#sg_trigger_txt2img") || injectButton("txt2img");
        const t2 = !!qs("#sg_trigger_img2img") || injectButton("img2img");
        if (t1) console.log("[Style Grid] txt2img trigger OK");
        if (t2) console.log("[Style Grid] img2img trigger OK");
        return t1 && t2;
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
})();
