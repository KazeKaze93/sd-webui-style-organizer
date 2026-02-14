/**
 * Style Grid - Vanilla JS. Old interface from sd-webui-style-grid.
 * No Tailwind. All styles in style.css. Search: token-based (unchanged).
 */
(function () {
    "use strict";

    const CATEGORY_COLORS = {
        BASE: "#6366f1",
        BODY: "#ec4899",
        GENITALS: "#f43f5e",
        BREASTS: "#f97316",
        THEME: "#8b5cf6",
        RESTRAINTS: "#ef4444",
        POSE: "#14b8a6",
        SCENE: "#22c55e",
        STYLE: "#3b82f6",
        OTHER: "#6b7280",
    };
    const DEFAULT_CAT_ORDER = [
        "BASE", "BODY", "GENITALS", "BREASTS", "THEME",
        "RESTRAINTS", "POSE", "SCENE", "STYLE", "OTHER",
    ];

    const state = {
        txt2img: { selected: new Set(), categories: {}, panel: null },
        img2img: { selected: new Set(), categories: {}, panel: null },
    };

    function getRoot() {
        try {
            if (typeof gradioApp === "function") {
                const app = gradioApp();
                if (app && app.shadowRoot) return app.shadowRoot;
            }
        } catch (_) {}
        return document.body;
    }

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
    function qsa(sel, root) {
        return (root || document).querySelectorAll(sel);
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

    function buildPanel(tabName) {
        const data = loadStylesData(tabName);
        const rawStyles = data.styles || [];
        const dataCategories = data.categories;
        const categories = dataCategories || categorize(mergeByPriority(rawStyles));
        state[tabName].categories = categories;

        const catOrder = getCategoryOrder(tabName);
        const catKeys = Object.keys(categories);
        const sortedCats = [];
        catOrder.forEach((c) => { if (catKeys.includes(c)) sortedCats.push(c); });
        catKeys.forEach((c) => { if (!sortedCats.includes(c)) sortedCats.push(c); });

        const overlay = el("div", { className: "sg-overlay", id: `sg_overlay_${tabName}` });
        let mouseDownTarget = null;
        overlay.addEventListener("mousedown", (e) => { mouseDownTarget = e.target; });
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay && mouseDownTarget === overlay) togglePanel(tabName, false);
            mouseDownTarget = null;
        });

        const panel = el("div", { className: "sg-panel" });

        const header = el("div", { className: "sg-header" });
        const titleRow = el("div", { className: "sg-title-row" });
        titleRow.appendChild(el("span", { className: "sg-title", textContent: "🎨 Style Grid" }));
        titleRow.appendChild(el("span", {
            className: "sg-selected-count",
            id: `sg_count_${tabName}`,
            textContent: "0 selected",
        }));
        header.appendChild(titleRow);

        const searchRow = el("div", { className: "sg-search-row" });
        const searchInput = el("input", {
            className: "sg-search",
            type: "text",
            placeholder: "Search name and prompt…",
            id: `sg_search_${tabName}`,
        });
        searchInput.addEventListener("input", () => filterStyles(tabName));
        searchRow.appendChild(searchInput);
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Clear",
            title: "Clear all selections",
            onClick: () => clearAll(tabName),
        }));
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-primary",
            textContent: "✔ Apply",
            title: "Apply selected styles to prompt",
            onClick: () => applyStyles(tabName),
        }));
        searchRow.appendChild(el("button", {
            className: "sg-btn sg-btn-close",
            innerHTML: "✕",
            title: "Close",
            onClick: () => togglePanel(tabName, false),
        }));
        header.appendChild(searchRow);
        panel.appendChild(header);

        const content = el("div", { className: "sg-content" });

        sortedCats.forEach((catName) => {
            const styles = categories[catName];
            if (!styles || styles.length === 0) return;

            const color = CATEGORY_COLORS[catName] || CATEGORY_COLORS.OTHER;

            const section = el("div", { className: "sg-category", "data-category": catName });
            const catHeader = el("div", { className: "sg-cat-header" });
            catHeader.style.borderLeftColor = color;

            const catTitle = el("span", { className: "sg-cat-title" });
            const catBadge = el("span", { className: "sg-cat-badge" });
            catBadge.style.backgroundColor = color;
            catBadge.textContent = catName;
            catTitle.appendChild(catBadge);
            catTitle.appendChild(document.createTextNode(` (${styles.length})`));

            const catArrow = el("span", { className: "sg-cat-arrow", textContent: "▾" });
            const catSelectAll = el("button", {
                className: "sg-cat-select-all",
                textContent: "Select All",
                onClick: (e) => {
                    e.stopPropagation();
                    toggleCategoryAll(tabName, catName);
                },
            });

            catHeader.appendChild(catTitle);
            catHeader.appendChild(catSelectAll);
            catHeader.appendChild(catArrow);
            catHeader.addEventListener("click", () => {
                section.classList.toggle("sg-collapsed");
                catArrow.textContent = section.classList.contains("sg-collapsed") ? "▸" : "▾";
            });
            section.appendChild(catHeader);

            const grid = el("div", { className: "sg-grid" });
            styles.forEach((style) => {
                const card = el("div", {
                    className: "sg-card",
                    "data-style-name": style.name,
                    "data-search": buildSearchText(style),
                });
                card.style.setProperty("--cat-color", color);

                if (state[tabName].selected.has(style.name)) {
                    card.classList.add("sg-selected");
                }

                const cardName = el("div", { className: "sg-card-name", textContent: style.display_name || style.name });
                card.appendChild(cardName);

                if (style.prompt) {
                    const snippet = style.prompt.length > 120 ? style.prompt.substring(0, 120) + "…" : style.prompt;
                    card.title = snippet;
                }

                card.addEventListener("click", () => toggleStyle(tabName, style.name, card));
                grid.appendChild(card);
            });

            section.appendChild(grid);
            content.appendChild(section);
        });

        panel.appendChild(content);

        const footer = el("div", { className: "sg-footer", id: `sg_footer_${tabName}` });
        footer.appendChild(el("span", { className: "sg-footer-label", textContent: "Selected: " }));
        footer.appendChild(el("div", { className: "sg-footer-tags", id: `sg_tags_${tabName}` }));
        panel.appendChild(footer);

        overlay.appendChild(panel);
        getRoot().appendChild(overlay);

        state[tabName].panel = overlay;
        updateSelectedUI(tabName);
        return overlay;
    }

    function toggleStyle(tabName, styleName, cardEl) {
        if (state[tabName].selected.has(styleName)) {
            state[tabName].selected.delete(styleName);
            cardEl.classList.remove("sg-selected");
        } else {
            state[tabName].selected.add(styleName);
            cardEl.classList.add("sg-selected");
        }
        updateSelectedUI(tabName);
    }

    function clearAll(tabName) {
        state[tabName].selected.clear();
        qsa(".sg-card.sg-selected", state[tabName].panel).forEach((c) => c.classList.remove("sg-selected"));
        updateSelectedUI(tabName);
    }

    function toggleCategoryAll(tabName, catName) {
        const panel = state[tabName].panel;
        const cards = qsa(`.sg-category[data-category="${catName}"] .sg-card`, panel);
        const allSelected = [...cards].every((c) => c.classList.contains("sg-selected"));

        cards.forEach((c) => {
            const name = c.getAttribute("data-style-name");
            if (allSelected) {
                state[tabName].selected.delete(name);
                c.classList.remove("sg-selected");
            } else {
                state[tabName].selected.add(name);
                c.classList.add("sg-selected");
            }
        });
        updateSelectedUI(tabName);
    }

    function filterStyles(tabName) {
        const query = (qs(`#sg_search_${tabName}`).value || "").trim().toLowerCase();
        const panel = state[tabName].panel;
        if (!panel) return;
        const cards = qsa(".sg-card", panel);
        const sections = qsa(".sg-category", panel);

        const tokens = query ? query.split(/\s+/).filter(Boolean) : [];

        cards.forEach((card) => {
            const dataSearch = (card.getAttribute("data-search") || "").toLowerCase();
            const match = tokens.length === 0 || tokens.every((t) => dataSearch.includes(t));
            card.style.display = match ? "" : "none";
        });

        sections.forEach((sec) => {
            const visibleCards = sec.querySelectorAll(".sg-card:not([style*='display: none'])");
            sec.style.display = visibleCards.length > 0 ? "" : "none";
        });
    }

    function updateSelectedUI(tabName) {
        const count = state[tabName].selected.size;
        const countEl = qs(`#sg_count_${tabName}`);
        if (countEl) countEl.textContent = `${count} selected`;

        const tagsEl = qs(`#sg_tags_${tabName}`);
        if (tagsEl) {
            tagsEl.innerHTML = "";
            state[tabName].selected.forEach((name) => {
                let displayName = name;
                for (const styles of Object.values(state[tabName].categories)) {
                    const found = styles.find((s) => s.name === name);
                    if (found) { displayName = found.display_name || name; break; }
                }
                const tag = el("span", { className: "sg-tag" });
                tag.textContent = displayName;
                const removeBtn = el("span", {
                    className: "sg-tag-remove",
                    textContent: "×",
                    onClick: (e) => {
                        e.stopPropagation();
                        state[tabName].selected.delete(name);
                        const card = qs(`.sg-card[data-style-name="${CSS.escape(name)}"]`, state[tabName].panel);
                        if (card) card.classList.remove("sg-selected");
                        updateSelectedUI(tabName);
                    },
                });
                tag.appendChild(removeBtn);
                tagsEl.appendChild(tag);
            });
        }

        const badge = qs(`#sg_btn_badge_${tabName}`);
        if (badge) {
            badge.textContent = count > 0 ? count : "";
            badge.style.display = count > 0 ? "flex" : "none";
            badge.setAttribute("data-empty", count > 0 ? "0" : "1");
        }
    }

    function applyStyles(tabName) {
        const selected = [...state[tabName].selected];
        if (selected.length === 0) {
            togglePanel(tabName, false);
            return;
        }

        const categories = state[tabName].categories;
        const allStyles = [];
        Object.values(categories).forEach((arr) => arr.forEach((s) => allStyles.push(s)));

        const promptEl = qs(`#${tabName}_prompt textarea`);
        const negEl = qs(`#${tabName}_neg_prompt textarea`);

        if (!promptEl || !negEl) {
            togglePanel(tabName, false);
            return;
        }

        let prompt = promptEl.value;
        let neg = negEl.value;
        const posAdd = [];
        const negAdd = [];

        selected.forEach((name) => {
            const style = allStyles.find((s) => s.name === name);
            if (!style) return;

            if (style.prompt) {
                if (style.prompt.includes("{prompt}")) {
                    prompt = style.prompt.replace("{prompt}", prompt);
                } else {
                    posAdd.push(style.prompt);
                }
            }
            if (style.negative_prompt) {
                if (style.negative_prompt.includes("{prompt}")) {
                    neg = style.negative_prompt.replace("{prompt}", neg);
                } else {
                    negAdd.push(style.negative_prompt);
                }
            }
        });

        if (posAdd.length > 0) {
            const sep = prompt.trim() ? ", " : "";
            prompt = prompt.replace(/,\s*$/, "") + sep + posAdd.join(", ");
        }
        if (negAdd.length > 0) {
            const sep = neg.trim() ? ", " : "";
            neg = neg.replace(/,\s*$/, "") + sep + negAdd.join(", ");
        }

        promptEl.value = prompt;
        negEl.value = neg;
        promptEl.dispatchEvent(new Event("input", { bubbles: true }));
        negEl.dispatchEvent(new Event("input", { bubbles: true }));

        togglePanel(tabName, false);
    }

    function togglePanel(tabName, show) {
        let panel = state[tabName].panel;
        if (!panel) {
            panel = buildPanel(tabName);
        }

        if (typeof show === "undefined") {
            show = !panel.classList.contains("sg-visible");
        }

        if (show) {
            panel.classList.add("sg-visible");
            setTimeout(() => {
                const search = qs(`#sg_search_${tabName}`);
                if (search) search.focus();
            }, 100);
        } else {
            panel.classList.remove("sg-visible");
        }
    }

    function createTriggerButton(tabName) {
        const btn = el("button", {
            className: "sg-trigger-btn",
            id: `sg_trigger_${tabName}`,
            title: "Open Style Grid",
            innerHTML: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" width=\"16\" height=\"16\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\"/></svg>",
        });

        const badge = el("span", {
            className: "sg-btn-badge",
            id: `sg_btn_badge_${tabName}`,
        });
        badge.style.display = "none";
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
