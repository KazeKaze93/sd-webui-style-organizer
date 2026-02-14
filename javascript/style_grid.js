/**
 * Style Grid - Vanilla JS loader and modal. No React/Tailwind.
 * All styles in style.css. Modal built with document.createElement.
 */
(function () {
    "use strict";

    const ALL_SOURCES = "All Sources";
    const CATEGORY_COLORS = {
        FAVORITES: "#eab308",
        BASE: "#6366f1",
        STYLE: "#3b82f6",
        SCENE: "#22c55e",
        THEME: "#8b5cf6",
        POSE: "#14b8a6",
        LIGHTING: "#f59e0b",
        COLOR: "#ec4899",
        CAMERA: "#f97316",
        OTHER: "#6b7280",
    };
    const DEFAULT_CAT_ORDER = [
        "BASE", "STYLE", "SCENE", "THEME", "POSE",
        "LIGHTING", "COLOR", "CAMERA", "OTHER",
    ];

    const state = {
        txt2img: { sources: [], styles: [], panel: null, selected: new Set(), selectedSource: ALL_SOURCES },
        img2img: { sources: [], styles: [], panel: null, selected: new Set(), selectedSource: ALL_SOURCES },
    };

    let applyMode = localStorage.getItem("sg_apply_mode") || "prompt";

    function getRoot() {
        try {
            if (typeof gradioApp === "function") {
                const app = gradioApp();
                if (app && app.shadowRoot) return app.shadowRoot;
            }
        } catch (_) {}
        return document.body;
    }

    /**
     * Wait for an element to exist and be visible before use.
     * selector: string or array of strings (tried in order).
     * Avoids "Attempted to select a non-interactive tab" and DOM timing issues.
     */
    function waitForElement(selector, options) {
        const root = (options && options.root) || document;
        const timeoutMs = (options && options.timeout) != null ? options.timeout : 30000;
        const checkVisible = !options || options.checkVisible !== false;
        const selectors = Array.isArray(selector) ? selector : [selector];

        return new Promise(function (resolve, reject) {
            const start = Date.now();
            function run() {
                let el = null;
                for (const sel of selectors) {
                    el = root.querySelector(sel);
                    if (el) break;
                }
                if (!el) {
                    if (Date.now() - start >= timeoutMs) return reject(new Error("waitForElement timeout: " + selectors.join(" | ")));
                    setTimeout(run, 250);
                    return;
                }
                if (checkVisible) {
                    const rect = el.getBoundingClientRect();
                    const visible = rect.width > 0 && rect.height > 0 && (el.offsetParent != null || el.getRootNode?.()?.host);
                    if (!visible) {
                        if (Date.now() - start >= timeoutMs) return reject(new Error("waitForElement visible timeout: " + selectors.join(" | ")));
                        setTimeout(run, 250);
                        return;
                    }
                }
                resolve(el);
            }
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", run);
            } else {
                run();
            }
        });
    }

    function qs(sel, root) {
        return (root || document).querySelector(sel);
    }
    function el(tag, attrs, children) {
        const e = document.createElement(tag);
        if (attrs)
            Object.entries(attrs).forEach(([k, v]) => {
                if (k === "className") e.className = v;
                else if (k === "textContent") e.textContent = v;
                else if (k === "innerHTML") e.innerHTML = v;
                else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
                else if (v != null) e.setAttribute(k, v);
            });
        if (children)
            (Array.isArray(children) ? children : [children]).forEach((c) => {
                if (typeof c === "string") e.appendChild(document.createTextNode(c));
                else if (c) e.appendChild(c);
            });
        return e;
    }

    function loadStylesData(tabName) {
        const dataEl = qs(`#style_grid_data_${tabName} textarea`);
        if (!dataEl || !dataEl.value) return { sources: [], styles: [], categories: null };
        try {
            const data = JSON.parse(dataEl.value);
            if (data.sources && Array.isArray(data.styles)) {
                return { sources: data.sources || [], styles: data.styles, categories: null };
            }
            if (data.categories && typeof data.categories === "object") {
                const styles = [];
                Object.values(data.categories).forEach((arr) => {
                    if (Array.isArray(arr)) arr.forEach((s) => styles.push(s));
                });
                return { sources: [], styles, categories: data.categories };
            }
        } catch (_) {}
        return { sources: [], styles: [], categories: null };
    }

    function getCategoryOrder(tabName) {
        const orderEl = qs(`#style_grid_cat_order_${tabName} textarea`);
        if (!orderEl || !orderEl.value) return DEFAULT_CAT_ORDER;
        try {
            const o = JSON.parse(orderEl.value);
            return Array.isArray(o) ? o : DEFAULT_CAT_ORDER;
        } catch (_) {
            return DEFAULT_CAT_ORDER;
        }
    }

    function categorize(styles) {
        const categories = {};
        (styles || []).forEach((s) => {
            const name = s.name || "";
            const idx = name.indexOf("_");
            let cat, displayName;
            if (idx > 0 && name.slice(0, idx) === name.slice(0, idx).toUpperCase() && idx >= 2) {
                cat = name.slice(0, idx);
                displayName = name.slice(idx + 1).replace(/_/g, " ");
            } else {
                cat = "OTHER";
                displayName = name.replace(/_/g, " ");
            }
            const styleWithMeta = Object.assign({}, s, { category: cat, display_name: displayName });
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(styleWithMeta);
        });
        return categories;
    }

    function mergeByPriority(styles) {
        const byName = {};
        (styles || []).forEach((s) => {
            const n = s.name;
            if (!n) return;
            const pri = s.source_priority != null ? s.source_priority : 0;
            if (!byName[n] || pri > (byName[n].source_priority != null ? byName[n].source_priority : 0))
                byName[n] = s;
        });
        return Object.values(byName);
    }

    function getStylesForSource(styles, selectedSource) {
        if (!selectedSource || selectedSource === ALL_SOURCES) return mergeByPriority(styles);
        return styles.filter((s) => s.source === selectedSource);
    }

    function buildSearchText(style) {
        return (style.name + " " + (style.display_name || "") + " " + (style.prompt || "") + " " + (style.negative_prompt || ""))
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function cardMatchesSearch(style, query) {
        if (!query || !query.trim()) return true;
        const text = buildSearchText(style);
        const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return tokens.every((t) => text.includes(t));
    }

    function getFavorites(tabName) {
        try {
            const raw = localStorage.getItem("sg_favorites");
            if (!raw) return new Set();
            const data = JSON.parse(raw);
            const arr = data[tabName];
            return Array.isArray(arr) ? new Set(arr) : new Set();
        } catch (_) {
            return new Set();
        }
    }
    function setFavorites(tabName, set) {
        try {
            const raw = localStorage.getItem("sg_favorites");
            const data = raw ? JSON.parse(raw) : {};
            data[tabName] = [...set];
            localStorage.setItem("sg_favorites", JSON.stringify(data));
        } catch (_) {}
    }
    function getSelectedSource(tabName) {
        try {
            const raw = localStorage.getItem("sg_selected_source");
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data[tabName] || null;
        } catch (_) {
            return null;
        }
    }
    function setSelectedSourceStorage(tabName, value) {
        try {
            const raw = localStorage.getItem("sg_selected_source");
            const data = raw ? JSON.parse(raw) : {};
            data[tabName] = value;
            localStorage.setItem("sg_selected_source", JSON.stringify(data));
        } catch (_) {}
    }

    function mergedStyleMap(styles) {
        const byName = {};
        (styles || []).forEach((s) => {
            const n = s.name;
            if (!n) return;
            const pri = s.source_priority != null ? s.source_priority : 0;
            if (!byName[n] || pri > (byName[n].source_priority != null ? byName[n].source_priority : 0))
                byName[n] = s;
        });
        return byName;
    }

    function applyStyles(tabName, selectedArray, mode) {
        if (!selectedArray || selectedArray.length === 0) return;
        if (mode === "silent") {
            const dataEl = qs(`#style_grid_selected_${tabName} textarea`);
            if (dataEl) {
                dataEl.value = JSON.stringify(selectedArray);
                dataEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
            return;
        }
        const styleMap = mergedStyleMap(state[tabName].styles);
        const promptEl = qs(`#${tabName}_prompt textarea`);
        const negEl = qs(`#${tabName}_neg_prompt textarea`);
        if (!promptEl || !negEl) return;
        let prompt = promptEl.value;
        let neg = negEl.value;
        const posAdd = [];
        const negAdd = [];
        selectedArray.forEach((name) => {
            const style = styleMap[name];
            if (!style) return;
            if (style.prompt) {
                if (style.prompt.includes("{prompt}")) prompt = style.prompt.replace("{prompt}", prompt);
                else posAdd.push(style.prompt);
            }
            if (style.negative_prompt) {
                if (style.negative_prompt.includes("{prompt}")) neg = style.negative_prompt.replace("{prompt}", neg);
                else negAdd.push(style.negative_prompt);
            }
        });
        if (posAdd.length) prompt = prompt.replace(/,\s*$/, "") + (prompt.trim() ? ", " : "") + posAdd.join(", ");
        if (negAdd.length) neg = neg.replace(/,\s*$/, "") + (neg.trim() ? ", " : "") + negAdd.join(", ");
        promptEl.value = prompt;
        negEl.value = neg;
        promptEl.dispatchEvent(new Event("input", { bubbles: true }));
        negEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function updateBadge(tabName) {
        const badge = qs(`#sg_btn_badge_${tabName}`);
        if (badge) {
            const count = state[tabName].selected.size;
            badge.textContent = count > 0 ? count : "";
            badge.setAttribute("data-empty", count > 0 ? "0" : "1");
        }
    }

    function renderModal(tabName) {
        const data = loadStylesData(tabName);
        const rawStyles = data.styles || [];
        const rawSources = data.sources || [];
        const hasData = rawStyles.length > 0;
        const catOrder = getCategoryOrder(tabName);

        const s = state[tabName];
        if (!s.selectedSource || (rawSources.length && !rawSources.includes(s.selectedSource) && s.selectedSource !== ALL_SOURCES))
            s.selectedSource = ALL_SOURCES;
        const effectiveStyles = getStylesForSource(rawStyles, s.selectedSource);
        const categories = categorize(effectiveStyles);
        const sortedCats = [];
        catOrder.forEach((c) => { if (categories[c]) sortedCats.push(c); });
        Object.keys(categories).forEach((c) => { if (!sortedCats.includes(c)) sortedCats.push(c); });

        const overlay = el("div", { className: "sg-overlay", id: `sg_overlay_${tabName}` });
        let mouseDownTarget = null;
        overlay.addEventListener("mousedown", (e) => { mouseDownTarget = e.target; });
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay && mouseDownTarget === overlay) togglePanel(tabName, false);
            mouseDownTarget = null;
        });

        const wrapper = el("div", { className: "sg-panel-wrapper" });

        const header = el("div", { className: "sg-header" });
        header.appendChild(el("div", { className: "sg-title-row" }, [
            el("span", { className: "sg-title", textContent: "Style Grid" }),
            el("span", { className: "sg-selected-count", id: `sg_count_${tabName}`, textContent: s.selected.size + " selected" }),
        ]));

        const searchRow = el("div", { className: "sg-search-row" });
        const searchInput = el("input", {
            type: "text",
            className: "sg-search",
            id: `sg_search_${tabName}`,
            placeholder: "Search name and prompt…",
        });
        const sourceSelect = el("select", { className: "sg-btn", id: `sg_source_${tabName}` });
        sourceSelect.appendChild(el("option", { value: ALL_SOURCES, textContent: ALL_SOURCES }));
        rawSources.forEach((src) => sourceSelect.appendChild(el("option", { value: src, textContent: src })));
        if (rawSources.length) sourceSelect.value = s.selectedSource;
        sourceSelect.addEventListener("change", () => {
            s.selectedSource = sourceSelect.value;
            setSelectedSourceStorage(tabName, s.selectedSource);
            rebuildModalContent(tabName);
        });
        searchInput.addEventListener("input", () => rebuildModalContent(tabName));
        searchRow.appendChild(searchInput);
        if (rawSources.length) searchRow.appendChild(sourceSelect);
        searchRow.appendChild(el("button", { className: "sg-btn", textContent: "Clear", onClick: () => { s.selected.clear(); rebuildModalContent(tabName); updateBadge(tabName); } }));
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-primary", textContent: "Apply", onClick: () => { applyStyles(tabName, [...s.selected], applyMode); togglePanel(tabName, false); } }));
        searchRow.appendChild(el("button", { className: "sg-btn sg-btn-close", innerHTML: "&times;", title: "Close", onClick: () => togglePanel(tabName, false) }));
        header.appendChild(searchRow);

        const modeRow = el("div", { className: "sg-mode-row" });
        modeRow.appendChild(el("span", { className: "sg-mode-label", textContent: "Apply:" }));
        const modeToggle = el("div", { className: "sg-mode-toggle" });
        const optPrompt = el("button", { className: "sg-mode-opt" + (applyMode === "prompt" ? " sg-mode-active" : ""), textContent: "Insert into prompt", "data-mode": "prompt" });
        const optSilent = el("button", { className: "sg-mode-opt" + (applyMode === "silent" ? " sg-mode-active" : ""), textContent: "At generation", "data-mode": "silent" });
        [optPrompt, optSilent].forEach((opt) => {
            opt.addEventListener("click", () => {
                applyMode = opt.getAttribute("data-mode");
                localStorage.setItem("sg_apply_mode", applyMode);
                modeToggle.querySelectorAll(".sg-mode-opt").forEach((o) => o.classList.remove("sg-mode-active"));
                modeToggle.querySelector(`[data-mode="${applyMode}"]`).classList.add("sg-mode-active");
            });
        });
        modeToggle.appendChild(optPrompt);
        modeToggle.appendChild(optSilent);
        modeRow.appendChild(modeToggle);
        header.appendChild(modeRow);

        wrapper.appendChild(header);

        const body = el("div", { className: "sg-body" });
        const sidebar = el("div", { className: "sg-sidebar" });
        sidebar.appendChild(el("div", { className: "sg-sidebar-label", textContent: "Categories" }));
        const main = el("div", { className: "sg-main", id: "sg-main-content" });

        function addCategorySection(catName, stylesInCat, color) {
            const section = el("div", { className: "sg-category", "data-category": catName });
            section.style.setProperty("--sg-cat-color", color || CATEGORY_COLORS.OTHER);
            const headerDiv = el("div", { className: "sg-cat-header" });
            headerDiv.style.borderLeftColor = color || CATEGORY_COLORS.OTHER;
            const badge = el("span", { className: "sg-cat-badge" });
            badge.style.backgroundColor = color || CATEGORY_COLORS.OTHER;
            badge.textContent = catName;
            headerDiv.appendChild(el("span", { className: "sg-cat-title" }, [badge, document.createTextNode(" (" + stylesInCat.length + ")")]));
            headerDiv.appendChild(el("span", { className: "sg-cat-arrow", textContent: "\u25BE" }));
            headerDiv.addEventListener("click", () => section.classList.toggle("sg-collapsed"));
            section.appendChild(headerDiv);
            const grid = el("div", { className: "sg-grid" });
            stylesInCat.forEach((style) => {
                const card = el("div", { className: "sg-card" + (s.selected.has(style.name) ? " sg-selected" : ""), "data-style-name": style.name });
                card.style.borderLeftColor = color || CATEGORY_COLORS.OTHER;
                card.title = (style.prompt || "") + (style.negative_prompt ? "\n---\n" + style.negative_prompt : "");
                card.appendChild(el("div", { className: "sg-card-name", textContent: style.display_name || style.name }));
                card.addEventListener("click", () => {
                    if (s.selected.has(style.name)) s.selected.delete(style.name);
                    else s.selected.add(style.name);
                    card.classList.toggle("sg-selected", s.selected.has(style.name));
                    qs(`#sg_count_${tabName}`).textContent = s.selected.size + " selected";
                    updateBadge(tabName);
                    const footerEl = wrapper.querySelector(".sg-footer");
                    if (footerEl) updateFooterTags(tabName, footerEl, effectiveStyles);
                });
                grid.appendChild(card);
            });
            section.appendChild(grid);
            main.appendChild(section);
        }

        if (hasData) {
            sortedCats.forEach((catName) => {
                const list = categories[catName] || [];
                const query = (searchInput.value || "").trim();
                const filtered = query ? list.filter((style) => cardMatchesSearch(style, query)) : list;
                if (filtered.length === 0) return;
                const color = CATEGORY_COLORS[catName] || CATEGORY_COLORS.OTHER;
                sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: catName, onClick: () => { const el = main.querySelector(`[data-category="${catName}"]`); if (el) el.scrollIntoView({ behavior: "smooth" }); } }));
                addCategorySection(catName, filtered, color);
            });
            sidebar.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: "Back to top", onClick: () => main.scrollTo({ top: 0, behavior: "smooth" }) }));
        } else {
            main.appendChild(el("p", { className: "sg-card-name", textContent: "No style data loaded. Check that styles exist and the extension is enabled." }));
        }

        body.appendChild(sidebar);
        body.appendChild(main);
        wrapper.appendChild(body);

        function updateFooterTags(tabName, footerEl, stylesList) {
            const tagsContainer = footerEl.querySelector(".sg-footer-tags");
            if (!tagsContainer) return;
            tagsContainer.innerHTML = "";
            const list = stylesList || effectiveStyles;
            s.selected.forEach((name) => {
                const style = list.find((st) => st.name === name);
                const label = style ? (style.display_name || name) : name;
                const tag = el("span", { className: "sg-tag" }, [document.createTextNode(label), el("span", { className: "sg-tag-remove", textContent: "\u00D7", onClick: (e) => { e.stopPropagation(); s.selected.delete(name); rebuildModalContent(tabName); updateBadge(tabName); } })]);
                tagsContainer.appendChild(tag);
            });
        }

        const footer = el("div", { className: "sg-footer", id: `sg_footer_${tabName}` });
        footer.appendChild(el("span", { className: "sg-footer-label", textContent: "Selected: " }));
        footer.appendChild(el("div", { className: "sg-footer-tags" }));
        wrapper.appendChild(footer);
        updateFooterTags(tabName, footer, effectiveStyles);

        overlay.appendChild(wrapper);
        getRoot().appendChild(overlay);

        function rebuildModalContent(tabName) {
            const panel = state[tabName].panel;
            if (!panel) return;
            const wrapperInner = panel.querySelector(".sg-panel-wrapper");
            if (!wrapperInner) return;
            const oldBody = wrapperInner.querySelector(".sg-body");
            const oldFooter = wrapperInner.querySelector(".sg-footer");
            if (oldBody) oldBody.remove();
            if (oldFooter) oldFooter.remove();
            const data2 = loadStylesData(tabName);
            const rawStyles2 = data2.styles || [];
            const effectiveStyles2 = getStylesForSource(rawStyles2, state[tabName].selectedSource);
            const categories2 = categorize(effectiveStyles2);
            const sortedCats2 = [];
            getCategoryOrder(tabName).forEach((c) => { if (categories2[c]) sortedCats2.push(c); });
            Object.keys(categories2).forEach((c) => { if (!sortedCats2.includes(c)) sortedCats2.push(c); });
            const searchInput2 = wrapperInner.querySelector(".sg-search");
            const query = searchInput2 ? searchInput2.value.trim() : "";
            const body2 = el("div", { className: "sg-body" });
            const sidebar2 = el("div", { className: "sg-sidebar" });
            sidebar2.appendChild(el("div", { className: "sg-sidebar-label", textContent: "Categories" }));
            const main2 = el("div", { className: "sg-main", id: "sg-main-content" });
            sortedCats2.forEach((catName) => {
                const list = categories2[catName] || [];
                const filtered = query ? list.filter((style) => cardMatchesSearch(style, query)) : list;
                if (filtered.length === 0) return;
                const color = CATEGORY_COLORS[catName] || CATEGORY_COLORS.OTHER;
                sidebar2.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: catName, onClick: () => { const el = main2.querySelector(`[data-category="${catName}"]`); if (el) el.scrollIntoView({ behavior: "smooth" }); } }));
                const section = el("div", { className: "sg-category", "data-category": catName });
                section.style.setProperty("--sg-cat-color", color);
                const headerDiv = el("div", { className: "sg-cat-header" });
                headerDiv.style.borderLeftColor = color;
                const badge = el("span", { className: "sg-cat-badge" });
                badge.style.backgroundColor = color;
                badge.textContent = catName;
                headerDiv.appendChild(el("span", { className: "sg-cat-title" }, [badge, document.createTextNode(" (" + filtered.length + ")")]));
                headerDiv.appendChild(el("span", { className: "sg-cat-arrow", textContent: "\u25BE" }));
                headerDiv.addEventListener("click", () => section.classList.toggle("sg-collapsed"));
                section.appendChild(headerDiv);
                const grid = el("div", { className: "sg-grid" });
                const s2 = state[tabName];
                filtered.forEach((style) => {
                    const card = el("div", { className: "sg-card" + (s2.selected.has(style.name) ? " sg-selected" : ""), "data-style-name": style.name });
                    card.style.borderLeftColor = color;
                    card.title = (style.prompt || "") + (style.negative_prompt ? "\n---\n" + style.negative_prompt : "");
                    card.appendChild(el("div", { className: "sg-card-name", textContent: style.display_name || style.name }));
                    card.addEventListener("click", () => {
                        if (s2.selected.has(style.name)) s2.selected.delete(style.name);
                        else s2.selected.add(style.name);
                        card.classList.toggle("sg-selected", s2.selected.has(style.name));
                        qs(`#sg_count_${tabName}`).textContent = s2.selected.size + " selected";
                        updateBadge(tabName);
                        const footerEl = wrapperInner.querySelector(".sg-footer");
                        if (footerEl) updateFooterTags(tabName, footerEl, effectiveStyles2);
                    });
                    grid.appendChild(card);
                });
                section.appendChild(grid);
                main2.appendChild(section);
            });
            sidebar2.appendChild(el("button", { type: "button", className: "sg-sidebar-btn", textContent: "Back to top", onClick: () => main2.scrollTo({ top: 0, behavior: "smooth" }) }));
            body2.appendChild(sidebar2);
            body2.appendChild(main2);
            wrapperInner.insertBefore(body2, null);
            const countEl = qs(`#sg_count_${tabName}`);
            if (countEl) countEl.textContent = state[tabName].selected.size + " selected";
            const footer2 = el("div", { className: "sg-footer", id: `sg_footer_${tabName}` });
            footer2.appendChild(el("span", { className: "sg-footer-label", textContent: "Selected: " }));
            footer2.appendChild(el("div", { className: "sg-footer-tags" }));
            wrapperInner.appendChild(footer2);
            updateFooterTags(tabName, footer2, effectiveStyles2);
        };

        return overlay;
    }

    function buildPanel(tabName) {
        state[tabName].sources = (loadStylesData(tabName).sources || []);
        state[tabName].styles = (loadStylesData(tabName).styles || []);
        const savedSource = getSelectedSource(tabName);
        if (savedSource && (state[tabName].sources.length === 0 || state[tabName].sources.includes(savedSource)))
            state[tabName].selectedSource = savedSource;
        const panel = renderModal(tabName);
        state[tabName].panel = panel;
        return panel;
    }

    function togglePanel(tabName, show) {
        let panel = state[tabName].panel;
        if (!panel) panel = buildPanel(tabName);
        if (typeof show === "undefined") show = !panel.classList.contains("sg-visible");
        if (show) panel.classList.add("sg-visible");
        else panel.classList.remove("sg-visible");
    }

    function createTriggerButton(tabName) {
        const btn = el("button", {
            className: "sg-trigger-btn lg secondary gradio-button",
            id: `sg_trigger_${tabName}`,
            title: "Open Style Grid",
            innerHTML: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" width=\"16\" height=\"16\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\"/></svg>",
        });
        const badge = el("span", { className: "sg-btn-badge", id: `sg_btn_badge_${tabName}` });
        badge.setAttribute("data-empty", "1");
        btn.appendChild(badge);
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel(tabName);
        });
        return btn;
    }

    function injectButton(tabName) {
        const selectors = [
            `#${tabName}_tools`,
            `#${tabName}_styles_row`,
            `#${tabName}_actions_column .style_create_row`,
            `#${tabName}_actions_column`,
        ];
        let target = null;
        for (const sel of selectors) {
            target = qs(sel);
            if (target) break;
        }
        if (!target) {
            const styleDropdown = qs(`#${tabName}_styles_row`) || qs(`#${tabName}_styles`);
            if (styleDropdown) target = styleDropdown.parentElement;
        }
        if (!target && qs(`#tab_${tabName}`)) {
            const toolBtns = qs(`#tab_${tabName}`).querySelectorAll(".tool");
            if (toolBtns.length) target = toolBtns[toolBtns.length - 1].parentElement;
        }
        if (!target) return false;
        const btn = createTriggerButton(tabName);
        if (target.id && target.id.includes("tools")) target.appendChild(btn);
        else if (target.classList && target.classList.contains("style_create_row")) target.appendChild(btn);
        else target.parentNode.insertBefore(btn, target.nextSibling);
        return true;
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            ["txt2img", "img2img"].forEach((tab) => {
                if (state[tab].panel && state[tab].panel.classList.contains("sg-visible")) {
                    togglePanel(tab, false);
                    e.preventDefault();
                }
            });
        }
    });

    function init() {
        const run = () => {
            waitForElement(
                ["#txt2img_tools", "#txt2img_styles_row", "#tab_txt2img"],
                { root: document, timeout: 20000 }
            )
                .then(() => injectButton("txt2img"))
                .catch(() => {});
            waitForElement(
                ["#img2img_tools", "#img2img_styles_row", "#tab_img2img"],
                { root: document, timeout: 20000 }
            )
                .then(() => injectButton("img2img"))
                .catch(() => {});
        };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(run, 800));
        } else {
            setTimeout(run, 800);
        }
    }
    init();
})();
