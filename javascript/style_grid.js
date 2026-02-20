/**
 * Style Grid - Visual grid/gallery style selector for Forge WebUI
 * v2.0 — Full-featured: silent mode, dynamic apply, presets, sorting,
 * conflict detection, context menu, inline editor, etc.
 */

(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    const state = {
        txt2img: { selected: new Set(), applied: new Map(), categories: {}, panel: null, selectedSource: "All", usage: {}, presets: {}, silentMode: false, sortMode: "name" },
        img2img: { selected: new Set(), applied: new Map(), categories: {}, panel: null, selectedSource: "All", usage: {}, presets: {}, silentMode: false, sortMode: "name" },
    };

    // -----------------------------------------------------------------------
    // Storage helpers
    // -----------------------------------------------------------------------
    const SOURCE_STORAGE_KEY = "sg_source";
    function getStoredSource(t) { try { var d = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || "{}"); return d[t] || "All"; } catch (_) { return "All"; } }
    function setStoredSource(t, v) { try { var d = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || "{}"); d[t] = v; localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(d)); } catch (_) {} }
    function getSilentMode(t) { try { var d = JSON.parse(localStorage.getItem("sg_silent") || "{}"); return !!d[t]; } catch (_) { return false; } }
    function setSilentMode(t, v) { try { var d = JSON.parse(localStorage.getItem("sg_silent") || "{}"); d[t] = v; localStorage.setItem("sg_silent", JSON.stringify(d)); } catch (_) {} }
    function getSortMode(t) { try { var d = JSON.parse(localStorage.getItem("sg_sort") || "{}"); return d[t] || "name"; } catch (_) { return "name"; } }
    function setSortMode(t, v) { try { var d = JSON.parse(localStorage.getItem("sg_sort") || "{}"); d[t] = v; localStorage.setItem("sg_sort", JSON.stringify(d)); } catch (_) {} }

    // Favorites
    const FAV_CAT = "FAVORITES";
    function getFavorites(t) { try { var d = JSON.parse(localStorage.getItem("sg_favorites") || "{}"); return new Set(d[t] || []); } catch (_) { return new Set(); } }
    function setFavorites(t, s) { try { var d = JSON.parse(localStorage.getItem("sg_favorites") || "{}"); d[t] = [...s]; localStorage.setItem("sg_favorites", JSON.stringify(d)); } catch (_) {} }
    function toggleFavorite(t, n) { var f = getFavorites(t); if (f.has(n)) f.delete(n); else f.add(n); setFavorites(t, f); }

    // Recent history
    function getRecentHistory(t) { try { return JSON.parse(localStorage.getItem("sg_recent_" + t) || "[]"); } catch (_) { return []; } }
    function addToRecentHistory(t, names) {
        var h = getRecentHistory(t);
        names.forEach(function (n) { h = h.filter(function (x) { return x !== n; }); h.unshift(n); });
        if (h.length > 10) h = h.slice(0, 10);
        localStorage.setItem("sg_recent_" + t, JSON.stringify(h));
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------
    function hashString(s) { if (!s) s = ""; var h = 0; for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; } return Math.abs(h); }
    function getCategoryColor(c) { var h = hashString(c) % 360, s = 55 + (hashString(c + "s") % 25), l = 48 + (hashString(c + "l") % 12); return "hsl(" + h + "," + s + "%," + l + "%)"; }
    function qs(sel, root) { return (root || document).querySelector(sel); }
    function qsa(sel, root) { return (root || document).querySelectorAll(sel); }
    function el(tag, attrs, children) {
        var e = document.createElement(tag);
        if (attrs) Object.entries(attrs).forEach(function (kv) {
            var k = kv[0], v = kv[1];
            if (k === "className") e.className = v;
            else if (k === "textContent") e.textContent = v;
            else if (k === "innerHTML") e.innerHTML = v;
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
        var n = normalizeSearchText(query); if (!n) return true;
        return n.split(/\s+/).filter(Boolean).every(function (t) { return text.includes(t); });
    }
    function getUniqueSources(t) {
        var cats = state[t].categories || {}, s = new Set();
        Object.values(cats).forEach(function (arr) { arr.forEach(function (st) { if (st.source) s.add(st.source); }); });
        return Array.from(s).sort();
    }
    function findCategoryMatch(q, t) {
        if (!q) return null;
        var names = Object.keys(state[t].categories || {});
        if (getFavorites(t).size > 0) names.push("FAVORITES");
        return names.find(function (c) { return c.toLowerCase().startsWith(q); }) || null;
    }
    function findStyleByName(t, n) {
        for (var styles of Object.values(state[t].categories)) {
            var f = styles.find(function (s) { return s.name === n; });
            if (f) return f;
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Prompt manipulation
    // -----------------------------------------------------------------------
    function removeSubstringFromPrompt(val, sub) {
        if (!sub || !val) return val;
        var idx = val.indexOf(sub);
        if (idx === -1) return val;
        var before = val.substring(0, idx).replace(/,\s*$/, "");
        var after = val.substring(idx + sub.length).replace(/^,\s*/, "");
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
        var silentEl = qs("#style_grid_silent_" + tabName + " textarea");
        if (!silentEl) return;
        var names = state[tabName].silentMode ? [...state[tabName].selected] : [];
        setPromptValue(silentEl, JSON.stringify(names));
    }

    // -----------------------------------------------------------------------
    // Load data from Gradio hidden component
    // -----------------------------------------------------------------------
    function loadStyles(tabName) {
        var dataEl = qs("#style_grid_data_" + tabName + " textarea");
        if (!dataEl || !dataEl.value) return {};
        try {
            var data = JSON.parse(dataEl.value);
            state[tabName].usage = data.usage || {};
            state[tabName].presets = data.presets || {};
            return data.categories || {};
        } catch (e) { console.error("[Style Grid] Parse error:", e); return {}; }
    }
    function getCategoryOrder(tabName) {
        var el = qs("#style_grid_cat_order_" + tabName + " textarea");
        if (!el || !el.value) return [];
        try { return JSON.parse(el.value); } catch (_) { return []; }
    }

    // -----------------------------------------------------------------------
    // Sorting
    // -----------------------------------------------------------------------
    function sortStyles(styles, mode, tabName) {
        var usage = state[tabName].usage || {};
        var sorted = styles.slice();
        switch (mode) {
            case "name":
                sorted.sort(function (a, b) { return (a.display_name || a.name).toLowerCase().localeCompare((b.display_name || b.name).toLowerCase()); });
                break;
            case "usage":
                sorted.sort(function (a, b) {
                    var ua = (usage[a.name] || {}).count || 0, ub = (usage[b.name] || {}).count || 0;
                    return ub - ua || (a.display_name || a.name).toLowerCase().localeCompare((b.display_name || b.name).toLowerCase());
                });
                break;
            case "recent":
                var recent = getRecentHistory(tabName);
                sorted.sort(function (a, b) {
                    var ia = recent.indexOf(a.name), ib = recent.indexOf(b.name);
                    if (ia === -1) ia = 9999; if (ib === -1) ib = 9999;
                    return ia - ib || (a.display_name || a.name).toLowerCase().localeCompare((b.display_name || b.name).toLowerCase());
                });
                break;
        }
        return sorted;
    }

    // -----------------------------------------------------------------------
    // API helpers
    // -----------------------------------------------------------------------
    function apiPost(endpoint, data) {
        return fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) }).then(function (r) { return r.json(); });
    }
    function apiGet(endpoint) {
        return fetch(endpoint).then(function (r) { return r.json(); });
    }

    // -----------------------------------------------------------------------
    // Conflict detection (client-side quick check)
    // -----------------------------------------------------------------------
    function checkConflictsLocal(tabName) {
        var selected = [...state[tabName].selected];
        if (selected.length < 2) return [];
        var conflicts = [];
        var tokenMap = {};
        selected.forEach(function (name) {
            var s = findStyleByName(tabName, name);
            if (!s) return;
            tokenMap[name] = { pos: new Set(), neg: new Set() };
            (s.prompt || "").split(",").forEach(function (t) { t = t.trim().toLowerCase(); if (t && t !== "{prompt}") tokenMap[name].pos.add(t); });
            (s.negative_prompt || "").split(",").forEach(function (t) { t = t.trim().toLowerCase(); if (t && t !== "{prompt}") tokenMap[name].neg.add(t); });
        });
        var names = Object.keys(tokenMap);
        for (var i = 0; i < names.length; i++) {
            for (var j = i + 1; j < names.length; j++) {
                var a = names[i], b = names[j];
                tokenMap[a].pos.forEach(function (t) {
                    if (tokenMap[b].neg.has(t)) conflicts.push("'" + a + "' adds '" + t + "' but '" + b + "' negates it");
                });
                tokenMap[b].pos.forEach(function (t) {
                    if (tokenMap[a].neg.has(t)) conflicts.push("'" + b + "' adds '" + t + "' but '" + a + "' negates it");
                });
            }
        }
        return conflicts;
    }

    // -----------------------------------------------------------------------
    // Dynamic apply / unapply a single style
    // -----------------------------------------------------------------------
    function applyStyleImmediate(tabName, styleName) {
        if (state[tabName].applied.has(styleName)) return;
        var style = findStyleByName(tabName, styleName);
        if (!style) return;

        if (state[tabName].silentMode) {
            // Silent: just track, don't touch prompt fields
            state[tabName].applied.set(styleName, { prompt: style.prompt || null, negative: style.negative_prompt || null, silent: true });
            setSilentGradio(tabName);
            return;
        }

        var promptEl = qs("#" + tabName + "_prompt textarea");
        var negEl = qs("#" + tabName + "_neg_prompt textarea");
        if (!promptEl || !negEl) return;

        var prompt = promptEl.value;
        var neg = negEl.value;
        var addedPrompt = "";
        var addedNeg = "";

        if (style.prompt) {
            if (style.prompt.includes("{prompt}")) {
                prompt = style.prompt.replace("{prompt}", prompt);
                addedPrompt = null;
            } else {
                addedPrompt = style.prompt;
                var sep = prompt.trim() ? ", " : "";
                prompt = prompt.replace(/,\s*$/, "") + sep + addedPrompt;
            }
        }
        if (style.negative_prompt) {
            if (style.negative_prompt.includes("{prompt}")) {
                neg = style.negative_prompt.replace("{prompt}", neg);
                addedNeg = null;
            } else {
                addedNeg = style.negative_prompt;
                var sepN = neg.trim() ? ", " : "";
                neg = neg.replace(/,\s*$/, "") + sepN + addedNeg;
            }
        }

        state[tabName].applied.set(styleName, { prompt: addedPrompt, negative: addedNeg });
        setPromptValue(promptEl, prompt);
        setPromptValue(negEl, neg);

        // Mark cards
        qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) {
            c.classList.add("sg-applied");
        });
    }

    function unapplyStyle(tabName, styleName) {
        var record = state[tabName].applied.get(styleName);
        if (!record) return;

        if (record.silent || state[tabName].silentMode) {
            state[tabName].applied.delete(styleName);
            setSilentGradio(tabName);
            qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-applied"); });
            return;
        }

        var promptEl = qs("#" + tabName + "_prompt textarea");
        var negEl = qs("#" + tabName + "_neg_prompt textarea");
        if (!promptEl || !negEl) return;

        if (record.prompt) setPromptValue(promptEl, removeSubstringFromPrompt(promptEl.value, record.prompt));
        if (record.negative) setPromptValue(negEl, removeSubstringFromPrompt(negEl.value, record.negative));

        state[tabName].applied.delete(styleName);
        qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-applied"); });
    }

    // -----------------------------------------------------------------------
    // Context menu
    // -----------------------------------------------------------------------
    function showContextMenu(e, tabName, styleName, style) {
        e.preventDefault();
        // Remove existing
        var old = qs(".sg-context-menu");
        if (old) old.remove();

        var menu = el("div", { className: "sg-context-menu" });
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";

        var items = [
            { label: "✏️ Edit style", action: function () { openStyleEditor(tabName, style); } },
            { label: "📋 Duplicate", action: function () { duplicateStyle(tabName, style); } },
            { label: "🗑️ Delete", action: function () { deleteStyle(tabName, styleName, style.source); } },
            { label: "📂 Move to category...", action: function () { moveToCategory(tabName, style); } },
            { label: "📎 Copy prompt", action: function () { navigator.clipboard.writeText(style.prompt || ""); } },
        ];
        items.forEach(function (item) {
            var btn = el("div", { className: "sg-ctx-item", textContent: item.label, onClick: function () { menu.remove(); item.action(); } });
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        // Auto-close
        setTimeout(function () {
            var close = function () { menu.remove(); document.removeEventListener("click", close); };
            document.addEventListener("click", close);
        }, 0);
    }

    // -----------------------------------------------------------------------
    // Style editor modal
    // -----------------------------------------------------------------------
    function openStyleEditor(tabName, existingStyle) {
        var isNew = !existingStyle;
        var overlay = el("div", { className: "sg-editor-overlay" });
        var modal = el("div", { className: "sg-editor-modal" });

        var title = el("h3", { textContent: isNew ? "Create New Style" : "Edit Style: " + (existingStyle ? existingStyle.name : ""), className: "sg-editor-title" });
        modal.appendChild(title);

        var nameInput = el("input", { className: "sg-editor-input", type: "text", placeholder: "Style name (e.g. BODY_Thicc)", value: existingStyle ? existingStyle.name : "" });
        var promptInput = el("textarea", { className: "sg-editor-textarea", placeholder: "Prompt (use {prompt} as placeholder)", rows: "4" });
        promptInput.value = existingStyle ? (existingStyle.prompt || "") : "";
        var negInput = el("textarea", { className: "sg-editor-textarea", placeholder: "Negative prompt", rows: "3" });
        negInput.value = existingStyle ? (existingStyle.negative_prompt || "") : "";

        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Name" }));
        modal.appendChild(nameInput);
        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Prompt" }));
        modal.appendChild(promptInput);
        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Negative Prompt" }));
        modal.appendChild(negInput);

        var btnRow = el("div", { className: "sg-editor-btns" });
        btnRow.appendChild(el("button", {
            className: "sg-btn sg-btn-primary", textContent: "💾 Save",
            onClick: function () {
                var name = nameInput.value.trim();
                if (!name) { nameInput.style.borderColor = "#f87171"; return; }
                apiPost("/style_grid/style/save", {
                    name: name, prompt: promptInput.value, negative_prompt: negInput.value,
                    source: existingStyle ? existingStyle.source : null,
                }).then(function () { overlay.remove(); refreshPanel(tabName); });
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
        var newName = style.name + "_copy";
        apiPost("/style_grid/style/save", {
            name: newName, prompt: style.prompt || "", negative_prompt: style.negative_prompt || "", source: style.source,
        }).then(function () { refreshPanel(tabName); });
    }

    function deleteStyle(tabName, styleName, source) {
        if (!confirm("Delete style '" + styleName + "'?")) return;
        apiPost("/style_grid/style/delete", { name: styleName, source: source }).then(function () { refreshPanel(tabName); });
    }

    function moveToCategory(tabName, style) {
        var newCat = prompt("New category name (prefix before _):", style.category || "");
        if (!newCat) return;
        var oldName = style.name;
        var rest = oldName.includes("_") ? oldName.split("_").slice(1).join("_") : oldName;
        var newName = newCat.toUpperCase() + "_" + rest;
        // Delete old, save new
        apiPost("/style_grid/style/delete", { name: oldName, source: style.source }).then(function () {
            return apiPost("/style_grid/style/save", { name: newName, prompt: style.prompt, negative_prompt: style.negative_prompt, source: style.source });
        }).then(function () { refreshPanel(tabName); });
    }

    // -----------------------------------------------------------------------
    // Presets UI
    // -----------------------------------------------------------------------
    function showPresetsMenu(tabName) {
        var old = qs(".sg-presets-overlay");
        if (old) old.remove();

        var overlay = el("div", { className: "sg-editor-overlay sg-presets-overlay" });
        var modal = el("div", { className: "sg-editor-modal" });
        modal.appendChild(el("h3", { className: "sg-editor-title", textContent: "📦 Style Presets" }));

        // Save current as preset
        var saveRow = el("div", { className: "sg-presets-save-row" });
        var nameIn = el("input", { className: "sg-editor-input", type: "text", placeholder: "Preset name..." });
        var saveBtn = el("button", {
            className: "sg-btn sg-btn-primary", textContent: "💾 Save current",
            onClick: function () {
                var name = nameIn.value.trim();
                if (!name) return;
                apiPost("/style_grid/presets/save", { name: name, styles: [...state[tabName].selected] }).then(function (r) {
                    state[tabName].presets = r.presets || {};
                    renderPresetsList();
                    nameIn.value = "";
                });
            }
        });
        saveRow.appendChild(nameIn);
        saveRow.appendChild(saveBtn);
        modal.appendChild(saveRow);

        var list = el("div", { className: "sg-presets-list" });
        modal.appendChild(list);

        function renderPresetsList() {
            list.innerHTML = "";
            var presets = state[tabName].presets || {};
            Object.keys(presets).forEach(function (name) {
                var p = presets[name];
                var row = el("div", { className: "sg-preset-row" });
                row.appendChild(el("span", { className: "sg-preset-name", textContent: name + " (" + (p.styles || []).length + " styles)" }));
                row.appendChild(el("button", {
                    className: "sg-btn sg-btn-secondary", textContent: "Load",
                    onClick: function () {
                        // Clear current and load preset
                        clearAll(tabName);
                        (p.styles || []).forEach(function (sn) {
                            state[tabName].selected.add(sn);
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

        var closeBtn = el("button", { className: "sg-btn sg-btn-secondary", textContent: "Close", onClick: function () { overlay.remove(); } });
        modal.appendChild(closeBtn);
        overlay.appendChild(modal);
        overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // -----------------------------------------------------------------------
    // Import/Export
    // -----------------------------------------------------------------------
    function showExportImport(tabName) {
        var overlay = el("div", { className: "sg-editor-overlay" });
        var modal = el("div", { className: "sg-editor-modal" });
        modal.appendChild(el("h3", { className: "sg-editor-title", textContent: "📥 Import / Export" }));

        var btnExport = el("button", {
            className: "sg-btn sg-btn-primary", textContent: "⬇️ Export all (JSON)",
            onClick: function () {
                apiGet("/style_grid/export").then(function (data) {
                    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    var a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "style_grid_export_" + new Date().toISOString().slice(0, 10) + ".json";
                    a.click();
                });
            }
        });
        modal.appendChild(btnExport);

        var importLabel = el("label", { className: "sg-editor-label", textContent: "Import JSON file:" });
        var importInput = el("input", { type: "file", accept: ".json" });
        importInput.addEventListener("change", function () {
            var file = importInput.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var data = JSON.parse(reader.result);
                    apiPost("/style_grid/import", data).then(function () {
                        overlay.remove();
                        refreshPanel(tabName);
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
            var dataEl = qs("#style_grid_data_" + tabName + " textarea");
            if (dataEl) {
                var full = { categories: data.categories || {}, usage: data.usage || {}, presets: state[tabName].presets };
                setPromptValue(dataEl, JSON.stringify(full));
            }
            // Save state before rebuild
            var savedSelection = new Set(state[tabName].selected);
            var wasVisible = state[tabName].panel && state[tabName].panel.classList.contains("sg-visible");
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
        });
    }

    // -----------------------------------------------------------------------
    // Dynamic polling for file changes
    // -----------------------------------------------------------------------
    var _pollInterval = null;
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
            }).catch(function () {});
        }, 5000);
    }

    // -----------------------------------------------------------------------
    // Build the Grid Panel
    // -----------------------------------------------------------------------
    function buildPanel(tabName) {
        var categories = loadStyles(tabName);
        state[tabName].categories = categories;
        state[tabName].silentMode = getSilentMode(tabName);
        state[tabName].sortMode = getSortMode(tabName);
        var catOrder = getCategoryOrder(tabName);

        var catKeys = Object.keys(categories);
        var sortedCats = [];
        catOrder.forEach(function (c) { if (catKeys.includes(c)) sortedCats.push(c); });
        catKeys.forEach(function (c) { if (!sortedCats.includes(c)) sortedCats.push(c); });

        // Overlay
        var overlay = el("div", { className: "sg-overlay", id: "sg_overlay_" + tabName });
        var overlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) { overlayMouseDownTarget = e.target; }, true);
        overlay.addEventListener("click", function (e) { if (e.target === overlay && overlayMouseDownTarget === overlay) togglePanel(tabName, false); overlayMouseDownTarget = null; });

        var panel = el("div", { className: "sg-panel" });

        // ---- Header ----
        var header = el("div", { className: "sg-header" });
        var titleRow = el("div", { className: "sg-title-row" });
        titleRow.appendChild(el("span", { className: "sg-title", textContent: "🎨 Style Grid" }));

        // Conflict warning area
        var conflictBadge = el("span", { className: "sg-conflict-badge", id: "sg_conflict_" + tabName });
        conflictBadge.style.display = "none";
        titleRow.appendChild(conflictBadge);

        var selectedCount = el("span", { className: "sg-selected-count", id: "sg_count_" + tabName, textContent: "0 selected" });
        titleRow.appendChild(selectedCount);
        header.appendChild(titleRow);

        // Search row
        var searchRow = el("div", { className: "sg-search-row" });

        // Source dropdown
        state[tabName].selectedSource = getStoredSource(tabName);
        var sources = getUniqueSources(tabName);
        var currentSource = state[tabName].selectedSource;
        if (sources.indexOf(currentSource) === -1) currentSource = "All";
        state[tabName].selectedSource = currentSource;

        var srcWrap = el("div", { className: "sg-source-dropdown-wrap" });
        var srcBtn = el("button", { type: "button", className: "sg-source-select lg secondary gradio-button", id: "sg_source_" + tabName, title: "Filter by source", textContent: currentSource === "All" ? "All Sources" : currentSource });
        var srcList = el("div", { className: "sg-source-dropdown-list" });
        [{ value: "All", label: "All Sources" }].concat(sources.map(function (s) { return { value: s, label: s }; })).forEach(function (opt) {
            var item = el("div", { className: "sg-source-dropdown-item" + (opt.value === currentSource ? " sg-active" : ""), "data-value": opt.value, textContent: opt.label });
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
                var close = function (e2) { if (!srcWrap.contains(e2.target)) { srcList.classList.remove("sg-open"); document.removeEventListener("click", close); } };
                setTimeout(function () { document.addEventListener("click", close); }, 0);
            }
        });
        srcWrap.appendChild(srcBtn);
        srcWrap.appendChild(srcList);
        searchRow.appendChild(srcWrap);

        // Search
        var searchInput = el("input", { className: "sg-search", type: "text", placeholder: "Search styles...", id: "sg_search_" + tabName });
        (function () {
            var timer = null;
            searchInput.addEventListener("input", function () { if (timer) clearTimeout(timer); timer = setTimeout(function () { filterStyles(tabName); }, 200); });
        })();
        searchRow.appendChild(searchInput);

        // Sort dropdown
        var sortBtn = el("button", {
            className: "sg-btn sg-btn-secondary", title: "Sort styles",
            textContent: "⇅ " + ({ name: "A-Z", usage: "Usage", recent: "Recent" }[state[tabName].sortMode] || "A-Z"),
            onClick: function () {
                var modes = ["name", "usage", "recent"];
                var idx = (modes.indexOf(state[tabName].sortMode) + 1) % modes.length;
                state[tabName].sortMode = modes[idx];
                setSortMode(tabName, modes[idx]);
                sortBtn.textContent = "⇅ " + ({ name: "A-Z", usage: "Usage", recent: "Recent" }[modes[idx]]);
                rebuildGridCards(tabName);
            }
        });
        searchRow.appendChild(sortBtn);

        // Silent mode toggle
        var silentBtn = el("button", {
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
        var btnRandom = el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "🎲", title: "Random style (use at your own risk!)",
            onClick: function () {
                var allStyles = [];
                Object.values(state[tabName].categories).forEach(function (arr) { arr.forEach(function (s) { allStyles.push(s); }); });
                if (allStyles.length === 0) return;
                var rand = allStyles[Math.floor(Math.random() * allStyles.length)];
                if (!state[tabName].selected.has(rand.name)) {
                    state[tabName].selected.add(rand.name);
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
                var allCollapsed = qsa(".sg-category:not(.sg-collapsed)", panel).length === 0;
                qsa(".sg-category", panel).forEach(function (sec) {
                    if (allCollapsed) { sec.classList.remove("sg-collapsed"); var a = sec.querySelector(".sg-cat-arrow"); if (a) a.textContent = "▾"; }
                    else { sec.classList.add("sg-collapsed"); var a = sec.querySelector(".sg-cat-arrow"); if (a) a.textContent = "▸"; }
                });
            }
        }));

        // Compact
        var compactMode = localStorage.getItem("sg_compact") === "1";
        var btnCompact = el("button", {
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
                });
            }
        }));

        // Clear
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "Clear", title: "Clear all selections", onClick: function () { clearAll(tabName); } }));

        // Close
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-close", innerHTML: "✕", title: "Close", onClick: function () { togglePanel(tabName, false); } }));

        header.appendChild(searchRow);
        panel.appendChild(header);

        // ---- Body ----
        var body = el("div", { className: "sg-body" });
        var main = el("div", { className: "sg-main", id: "sg_main_" + tabName });
        var showSidebar = sortedCats.length > 5;
        var favSet = getFavorites(tabName);

        function showOnlyCategory(catId) {
            qsa(".sg-category", main).forEach(function (sec) {
                var vis = sec.querySelectorAll(".sg-card:not(.sg-card-hidden)").length;
                if (vis === 0) { sec.style.display = "none"; return; }
                if (catId === null) { sec.style.display = ""; }
                else { sec.style.display = (sec.getAttribute("data-category") === catId) ? "" : "none"; }
            });
        }

        if (showSidebar) {
            var sidebar = el("div", { className: "sg-sidebar" });
            sidebar.appendChild(el("div", { className: "sg-sidebar-label", textContent: "Categories" }));
            var btnAll = el("button", { type: "button", className: "sg-sidebar-btn sg-sidebar-btn-all sg-active", textContent: "All", onClick: function () { showOnlyCategory(null); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); btnAll.classList.add("sg-active"); } });
            sidebar.appendChild(btnAll);
            sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: "★ Favorites", onClick: function () { showOnlyCategory("FAVORITES"); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); this.classList.add("sg-active"); } }));
            sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: "🕑 Recent", onClick: function () { showOnlyCategory("RECENT"); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); this.classList.add("sg-active"); } }));
            sortedCats.forEach(function (catName) {
                sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", "data-category": catName, textContent: catName, onClick: function () { showOnlyCategory(catName); qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); }); this.classList.add("sg-active"); } }));
            });
            body.appendChild(sidebar);
        } else {
            var filterBar = el("div", { className: "sg-filter-bar" });
            var fAll = el("button", { type: "button", className: "sg-filter-btn sg-active", textContent: "All", onClick: function () { showOnlyCategory(null); fAll.classList.add("sg-active"); fFav.classList.remove("sg-active"); } });
            var fFav = el("button", { type: "button", className: "sg-filter-btn", textContent: "★ Favorites", onClick: function () { showOnlyCategory("FAVORITES"); fFav.classList.add("sg-active"); fAll.classList.remove("sg-active"); } });
            filterBar.appendChild(fAll);
            filterBar.appendChild(fFav);
            body.appendChild(filterBar);
        }

        // Build favorites section
        var favStyles = [];
        sortedCats.forEach(function (catName) {
            (categories[catName] || []).forEach(function (s) { if (favSet.has(s.name)) favStyles.push(s); });
        });
        favStyles = sortStyles(favStyles, state[tabName].sortMode, tabName);
        appendCategorySection(main, "★ " + FAV_CAT, favStyles, "#eab308", true, tabName);

        // Build recent section
        var recentHistory = getRecentHistory(tabName);
        var recentStyles = [];
        recentHistory.slice(0, 10).forEach(function (n) {
            var s = findStyleByName(tabName, n);
            if (s) recentStyles.push(s);
        });
        if (recentStyles.length > 0) {
            appendCategorySection(main, "🕑 RECENT", recentStyles, "#8b5cf6", false, tabName, "RECENT");
        }

        // Build category sections
        sortedCats.forEach(function (catName) {
            var styles = categories[catName];
            if (!styles || styles.length === 0) return;
            styles = sortStyles(styles, state[tabName].sortMode, tabName);
            appendCategorySection(main, catName, styles, getCategoryColor(catName), false, tabName);
        });

        body.appendChild(main);
        panel.appendChild(body);

        // Footer
        var footer = el("div", { className: "sg-footer", id: "sg_footer_" + tabName });
        footer.appendChild(el("span", { className: "sg-footer-label", textContent: "Selected: " }));
        footer.appendChild(el("div", { className: "sg-footer-tags", id: "sg_tags_" + tabName }));
        panel.appendChild(footer);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        state[tabName].panel = overlay;
        filterStyles(tabName);
        return overlay;
    }

    function rebuildGridCards(tabName) {
        // Re-sort cards within each category grid
        var panel = state[tabName].panel;
        if (!panel) return;
        qsa(".sg-category", panel).forEach(function (sec) {
            var catName = sec.getAttribute("data-category");
            var grid = sec.querySelector(".sg-grid");
            if (!grid) return;
            var cards = Array.from(grid.children);
            var styles = cards.map(function (c) { return findStyleByName(tabName, c.getAttribute("data-style-name")); }).filter(Boolean);
            styles = sortStyles(styles, state[tabName].sortMode, tabName);
            var nameOrder = styles.map(function (s) { return s.name; });
            cards.sort(function (a, b) { return nameOrder.indexOf(a.getAttribute("data-style-name")) - nameOrder.indexOf(b.getAttribute("data-style-name")); });
            cards.forEach(function (c) { grid.appendChild(c); });
        });
    }

    // -----------------------------------------------------------------------
    // Build a category section
    // -----------------------------------------------------------------------
    function appendCategorySection(container, catName, styles, color, isFav, tabName, overrideCatId) {
        var catId = overrideCatId || (isFav ? "FAVORITES" : catName);
        var section = el("div", { className: "sg-category", "data-category": catId });
        section.id = "sg-cat-" + catId.replace(/\s/g, "_");

        var catHeader = el("div", { className: "sg-cat-header" });
        catHeader.style.borderLeftColor = color;
        var catTitle = el("span", { className: "sg-cat-title" });
        var catBadge = el("span", { className: "sg-cat-badge" }); catBadge.style.backgroundColor = color; catBadge.textContent = catName;
        catTitle.appendChild(catBadge);
        catTitle.appendChild(document.createTextNode(" (" + styles.length + ")"));
        var catArrow = el("span", { className: "sg-cat-arrow", textContent: "▾" });
        var catSelectAll = el("button", {
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
        section.appendChild(catHeader);

        var grid = el("div", { className: "sg-grid" });
        styles.forEach(function (style) {
            var card = el("div", {
                className: "sg-card" + (style.has_placeholder ? " sg-has-placeholder" : ""),
                "data-style-name": style.name,
                "data-category": catId,
                "data-search-name": buildSearchText(style),
                "data-source": style.source || "",
            });
            card.style.setProperty("--cat-color", color);
            if (state[tabName].selected.has(style.name)) { card.classList.add("sg-selected"); card.classList.add("sg-applied"); }

            // Icons container (top-right): check + star side by side
            var icons = el("div", { className: "sg-card-icons" });

            // Check icon (shows when selected)
            var check = el("span", { className: "sg-card-check", innerHTML: "✓" });
            icons.appendChild(check);

            // Star icon
            var star = el("span", {
                className: "sg-card-star" + (getFavorites(tabName).has(style.name) ? " sg-fav" : ""),
                title: "Toggle favorite", innerHTML: "★",
                onClick: function (e) {
                    e.stopPropagation();
                    toggleFavorite(tabName, style.name);
                    star.classList.toggle("sg-fav", getFavorites(tabName).has(style.name));
                }
            });
            icons.appendChild(star);
            card.appendChild(icons);

            // Usage badge
            var usage = state[tabName].usage || {};
            var uCount = (usage[style.name] || {}).count || 0;
            if (uCount > 0) {
                var uBadge = el("span", { className: "sg-card-usage", textContent: uCount.toString(), title: "Used " + uCount + " times" });
                card.appendChild(uBadge);
            }

            // Name
            card.appendChild(el("div", { className: "sg-card-name", textContent: style.display_name || style.name }));

            // Tooltip
            if (style.prompt) {
                card.title = (style.prompt.length > 120 ? style.prompt.substring(0, 120) + "…" : style.prompt);
            }

            // Click = dynamic apply/unapply
            card.addEventListener("click", function () { toggleStyle(tabName, style.name, card); });

            // Right-click = context menu
            card.addEventListener("contextmenu", function (e) { showContextMenu(e, tabName, style.name, style); });

            grid.appendChild(card);
        });
        section.appendChild(grid);
        container.appendChild(section);
    }

    // -----------------------------------------------------------------------
    // Interaction handlers
    // -----------------------------------------------------------------------
    function toggleStyle(tabName, styleName, cardEl) {
        if (state[tabName].selected.has(styleName)) {
            state[tabName].selected.delete(styleName);
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
            applyStyleImmediate(tabName, styleName);
            // Update all matching cards
            qsa('.sg-card[data-style-name="' + CSS.escape(styleName) + '"]', state[tabName].panel).forEach(function (c) {
                c.classList.add("sg-selected");
                c.classList.add("sg-applied");
            });
            addToRecentHistory(tabName, [styleName]);
        }
        updateSelectedUI(tabName);
        // Check conflicts
        updateConflicts(tabName);
    }

    function clearAll(tabName) {
        state[tabName].applied.forEach(function (_, n) { unapplyStyle(tabName, n); });
        state[tabName].selected.clear();
        state[tabName].applied.clear();
        if (state[tabName].panel) {
            qsa(".sg-card.sg-selected, .sg-card.sg-applied", state[tabName].panel).forEach(function (c) { c.classList.remove("sg-selected"); c.classList.remove("sg-applied"); });
        }
        setSilentGradio(tabName);
        updateSelectedUI(tabName);
        updateConflicts(tabName);
    }

    function toggleCategoryAll(tabName, catName) {
        var cards = qsa('.sg-category[data-category="' + catName + '"] .sg-card', state[tabName].panel);
        var allSelected = Array.from(cards).every(function (c) { return c.classList.contains("sg-selected"); });
        cards.forEach(function (c) {
            var name = c.getAttribute("data-style-name");
            if (allSelected) {
                unapplyStyle(tabName, name);
                state[tabName].selected.delete(name);
                c.classList.remove("sg-selected");
                c.classList.remove("sg-applied");
            } else {
                if (!state[tabName].selected.has(name)) {
                    state[tabName].selected.add(name);
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
        var panel = state[tabName].panel;
        if (!panel) return;
        var searchEl = qs("#sg_search_" + tabName, panel);
        var query = searchEl ? normalizeSearchText(searchEl.value) : "";
        var selectedSource = state[tabName].selectedSource || "All";
        var cards = qsa(".sg-card", panel);
        var sections = qsa(".sg-category", panel);

        function sourceMatch(card) { return selectedSource === "All" || (card.getAttribute("data-source") || "") === selectedSource; }

        var matchedCat = findCategoryMatch(query, tabName);
        if (matchedCat) {
            sections.forEach(function (sec) { sec.style.display = sec.getAttribute("data-category") === matchedCat ? "" : "none"; });
            cards.forEach(function (card) { card.classList.toggle("sg-card-hidden", !(card.getAttribute("data-category") === matchedCat && sourceMatch(card))); });
        } else {
            sections.forEach(function (sec) { sec.style.display = ""; });
            cards.forEach(function (card) {
                var text = card.getAttribute("data-search-name") || "";
                card.classList.toggle("sg-card-hidden", !((!query || nameMatchesQuery(text, query)) && sourceMatch(card)));
            });
            sections.forEach(function (sec) { sec.style.display = sec.querySelectorAll(".sg-card:not(.sg-card-hidden)").length > 0 ? "" : "none"; });
        }
        // Update counts
        sections.forEach(function (sec) {
            var n = sec.querySelectorAll(".sg-card:not(.sg-card-hidden)").length;
            var ct = sec.querySelector(".sg-cat-title");
            if (ct && ct.childNodes.length >= 2) ct.childNodes[1].textContent = " (" + n + ")";
            if (n === 0) sec.style.display = "none";
        });
        // Sidebar visibility
        var sidebar = panel.querySelector(".sg-sidebar");
        if (sidebar) {
            qsa(".sg-sidebar-btn[data-category]", sidebar).forEach(function (btn) {
                var sec = panel.querySelector("#sg-cat-" + (btn.getAttribute("data-category") || "").replace(/\s/g, "_"));
                btn.style.display = (!sec || sec.querySelectorAll(".sg-card:not(.sg-card-hidden)").length > 0) ? "" : "none";
            });
        }
    }

    function updateSelectedUI(tabName) {
        var count = state[tabName].selected.size;
        var countEl = qs("#sg_count_" + tabName);
        if (countEl) countEl.textContent = count + " selected";

        var tagsEl = qs("#sg_tags_" + tabName);
        if (tagsEl) {
            tagsEl.innerHTML = "";
            state[tabName].selected.forEach(function (name) {
                var tag = el("span", { className: "sg-tag" });
                var displayName = name;
                for (var styles of Object.values(state[tabName].categories)) {
                    var f = styles.find(function (s) { return s.name === name; });
                    if (f) { displayName = f.display_name; break; }
                }
                tag.textContent = displayName;
                tag.appendChild(el("span", {
                    className: "sg-tag-remove", textContent: "×",
                    onClick: function (e) {
                        e.stopPropagation();
                        unapplyStyle(tabName, name);
                        state[tabName].selected.delete(name);
                        qsa('.sg-card[data-style-name="' + CSS.escape(name) + '"]', state[tabName].panel).forEach(function (c) { c.classList.remove("sg-selected"); c.classList.remove("sg-applied"); });
                        updateSelectedUI(tabName);
                        updateConflicts(tabName);
                    }
                }));
                tagsEl.appendChild(tag);
            });
        }

        var badge = qs("#sg_btn_badge_" + tabName);
        if (badge) { badge.textContent = count > 0 ? count : ""; badge.style.display = count > 0 ? "flex" : "none"; }
    }

    function updateConflicts(tabName) {
        var conflicts = checkConflictsLocal(tabName);
        var badge = qs("#sg_conflict_" + tabName);
        if (!badge) return;
        if (conflicts.length > 0) {
            badge.style.display = "inline-flex";
            badge.textContent = "⚠ " + conflicts.length + " conflict" + (conflicts.length > 1 ? "s" : "");
            badge.title = conflicts.join("\n");
        } else {
            badge.style.display = "none";
        }
    }

    // -----------------------------------------------------------------------
    // Toggle panel visibility
    // -----------------------------------------------------------------------
    function togglePanel(tabName, show) {
        var panel = state[tabName].panel;
        if (!panel) panel = buildPanel(tabName);
        if (typeof show === "undefined") show = !panel.classList.contains("sg-visible");
        if (show) {
            panel.classList.add("sg-visible");
            filterStyles(tabName);
            setTimeout(function () { var s = qs("#sg_search_" + tabName, panel); if (s) s.focus(); }, 100);
        } else {
            panel.classList.remove("sg-visible");
        }
    }

    // -----------------------------------------------------------------------
    // Trigger button
    // -----------------------------------------------------------------------
    function createTriggerButton(tabName) {
        var btn = el("button", {
            className: "sg-trigger-btn lg secondary gradio-button tool svelte-cmf5ev",
            id: "sg_trigger_" + tabName, title: "Open Style Grid",
            innerHTML: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
        });
        var badge = el("span", { className: "sg-btn-badge", id: "sg_btn_badge_" + tabName });
        badge.style.display = "none";
        btn.appendChild(badge);
        btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(tabName); });
        return btn;
    }

    function injectButton(tabName) {
        var selectors = [
            "#" + tabName + "_tools",
            "#" + tabName + "_styles_row",
            "#" + tabName + "_actions_column .style_create_row",
            "#" + tabName + "_actions_column",
        ];
        var target = null;
        for (var i = 0; i < selectors.length; i++) { target = qs(selectors[i]); if (target) break; }
        if (!target) {
            var dd = qs("#" + tabName + "_styles_row") || qs("#" + tabName + "_styles");
            if (dd) target = dd.parentElement;
        }
        if (!target) {
            var tab = qs("#tab_" + tabName);
            if (tab) { var btns = tab.querySelectorAll(".tool"); if (btns.length > 0) target = btns[btns.length - 1].parentElement; }
        }
        if (!target) return false;
        var btn = createTriggerButton(tabName);
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
    // Init
    // -----------------------------------------------------------------------
    function init() {
        var attempts = 0;
        var tryInject = function () {
            attempts++;
            var t1 = !!qs("#sg_trigger_txt2img") || injectButton("txt2img");
            var t2 = !!qs("#sg_trigger_img2img") || injectButton("img2img");
            if ((!t1 || !t2) && attempts < 50) setTimeout(tryInject, 500);
            else {
                if (t1) console.log("[Style Grid] txt2img injected");
                if (t2) console.log("[Style Grid] img2img injected");
                startPolling();
            }
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(tryInject, 1500); });
        else setTimeout(tryInject, 1500);
    }

    init();
})();
