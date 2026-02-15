/**
 * Style Grid - Visual grid/gallery style selector for Forge WebUI
 * Replaces the dropdown style selector with a categorized, multi-select grid.
 */

(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    const state = {
        txt2img: { selected: new Set(), categories: {}, panel: null },
        img2img: { selected: new Set(), categories: {}, panel: null },
    };

    /** Simple string hash for deterministic color generation. */
    function hashString(str) {
        if (str == null) str = "";
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h = h & h;
        }
        return Math.abs(h);
    }

    /** Generate a unique HSL color from category name (stable per name). */
    function getCategoryColor(categoryName) {
        var h = hashString(categoryName) % 360;
        var s = 55 + (hashString(categoryName + "s") % 25);
        var l = 48 + (hashString(categoryName + "l") % 12);
        return "hsl(" + h + ", " + s + "%, " + l + "%)";
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------
    function qs(sel, root) { return (root || document).querySelector(sel); }
    function qsa(sel, root) { return (root || document).querySelectorAll(sel); }
    function el(tag, attrs, children) {
        const e = document.createElement(tag);
        if (attrs) Object.entries(attrs).forEach(([k, v]) => {
            if (k === "className") e.className = v;
            else if (k === "textContent") e.textContent = v;
            else if (k === "innerHTML") e.innerHTML = v;
            else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
            else e.setAttribute(k, v);
        });
        if (children) {
            (Array.isArray(children) ? children : [children]).forEach(c => {
                if (typeof c === "string") e.appendChild(document.createTextNode(c));
                else if (c) e.appendChild(c);
            });
        }
        return e;
    }

    // -----------------------------------------------------------------------
    // Load styles from hidden Gradio component
    // -----------------------------------------------------------------------
    function loadStyles(tabName) {
        const dataEl = qs(`#style_grid_data_${tabName} textarea`);
        if (!dataEl || !dataEl.value) return {};
        try {
            const data = JSON.parse(dataEl.value);
            return data.categories || {};
        } catch (e) {
            console.error("[Style Grid] Failed to parse styles data:", e);
            return {};
        }
    }

    function getCategoryOrder(tabName) {
        const orderEl = qs(`#style_grid_cat_order_${tabName} textarea`);
        if (!orderEl || !orderEl.value) return [];
        try {
            return JSON.parse(orderEl.value);
        } catch { return []; }
    }

    /** Normalize string for search: collapse spaces, trim, lowerCase. */
    function normalizeSearchText(s) {
        if (s == null || typeof s !== "string") return "";
        return s.replace(/\s+/g, " ").trim().toLowerCase();
    }

    /** Build searchable text from style NAME only (strict name matching; no prompt/negative). */
    function buildSearchTextNameOnly(style) {
        const parts = [style.name, style.display_name].filter(Boolean);
        return normalizeSearchText(parts.join(" "));
    }

    /** Token-based match in name-only text: every token must appear (order doesn't matter). */
    function nameMatchesQuery(nameOnlyText, query) {
        const normalized = normalizeSearchText(query);
        if (!normalized) return true;
        const tokens = normalized.split(/\s+/).filter(Boolean);
        return tokens.every(function (token) {
            return nameOnlyText.includes(token);
        });
    }

    /** Get all known category names (from current data + Favorites). */
    function getCategoryNames(tabName) {
        const fromData = Object.keys(state[tabName].categories || {});
        var out = [...fromData];
        if (getFavorites(tabName).size > 0) out.push("FAVORITES");
        return out;
    }

    /** Find category that matches query (category.toLowerCase().startsWith(query)). */
    function findCategoryMatch(query, tabName) {
        if (!query) return null;
        const categoryNames = getCategoryNames(tabName);
        return categoryNames.find(function (cat) {
            return cat.toLowerCase().startsWith(query);
        }) || null;
    }

    // -----------------------------------------------------------------------
    // Favorites (localStorage, per-tab)
    // -----------------------------------------------------------------------
    const FAV_CAT = "FAVORITES";
    function getFavorites(tabName) {
        try {
            var raw = localStorage.getItem("sg_favorites");
            if (!raw) return new Set();
            var data = JSON.parse(raw);
            var arr = data[tabName];
            return Array.isArray(arr) ? new Set(arr) : new Set();
        } catch (_) { return new Set(); }
    }
    function setFavorites(tabName, set) {
        try {
            var raw = localStorage.getItem("sg_favorites");
            var data = raw ? JSON.parse(raw) : {};
            data[tabName] = [...set];
            localStorage.setItem("sg_favorites", JSON.stringify(data));
        } catch (_) {}
    }
    function toggleFavorite(tabName, styleName) {
        var fav = getFavorites(tabName);
        if (fav.has(styleName)) fav.delete(styleName);
        else fav.add(styleName);
        setFavorites(tabName, fav);
    }

    // -----------------------------------------------------------------------
    // Build the Grid Panel (modal overlay)
    // -----------------------------------------------------------------------
    function buildPanel(tabName) {
        const categories = loadStyles(tabName);
        state[tabName].categories = categories;
        const catOrder = getCategoryOrder(tabName);

        // Sort categories: ordered ones first, then rest alphabetically
        const catKeys = Object.keys(categories);
        const sortedCats = [];
        catOrder.forEach(c => { if (catKeys.includes(c)) sortedCats.push(c); });
        catKeys.forEach(c => { if (!sortedCats.includes(c)) sortedCats.push(c); });

        // --- Overlay backdrop ---
        const overlay = el("div", { className: "sg-overlay", id: `sg_overlay_${tabName}` });
        let overlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", (e) => {
            overlayMouseDownTarget = e.target;
        }, true);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay && overlayMouseDownTarget === overlay) togglePanel(tabName, false);
            overlayMouseDownTarget = null;
        });

        // --- Panel container ---
        const panel = el("div", { className: "sg-panel" });

        // --- Header ---
        const header = el("div", { className: "sg-header" });

        const titleRow = el("div", { className: "sg-title-row" });
        titleRow.appendChild(el("span", { className: "sg-title", textContent: "🎨 Style Grid" }));

        const selectedCount = el("span", {
            className: "sg-selected-count",
            id: `sg_count_${tabName}`,
            textContent: "0 selected",
        });
        titleRow.appendChild(selectedCount);
        header.appendChild(titleRow);

        // Search bar
        const searchRow = el("div", { className: "sg-search-row" });
        const searchInput = el("input", {
            className: "sg-search",
            type: "text",
            placeholder: "Search styles...",
            id: `sg_search_${tabName}`,
        });
        (function () {
            var debounceTimer = null;
            var debounceMs = 200;
            searchInput.addEventListener("input", function () {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function () {
                    debounceTimer = null;
                    filterStyles(tabName);
                }, debounceMs);
            });
        })();
        searchRow.appendChild(searchInput);

        // Action buttons in header
        const btnClearAll = el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Clear",
            title: "Clear all selections",
            onClick: () => clearAll(tabName),
        });
        const btnApply = el("button", {
            className: "sg-btn sg-btn-primary",
            textContent: "✔ Apply",
            title: "Apply selected styles to prompt",
            onClick: () => applyStyles(tabName),
        });
        const btnClose = el("button", {
            className: "sg-btn sg-btn-close",
            innerHTML: "✕",
            title: "Close",
            onClick: () => togglePanel(tabName, false),
        });
        var btnCollapseAll = el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Collapse all",
            title: "Collapse all category blocks",
            onClick: function () {
                qsa(".sg-category", panel).forEach(function (sec) {
                    sec.classList.add("sg-collapsed");
                    var arrow = sec.querySelector(".sg-cat-arrow");
                    if (arrow) arrow.textContent = "▸";
                });
            },
        });
        var btnExpandAll = el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Expand all",
            title: "Expand all category blocks",
            onClick: function () {
                qsa(".sg-category", panel).forEach(function (sec) {
                    sec.classList.remove("sg-collapsed");
                    var arrow = sec.querySelector(".sg-cat-arrow");
                    if (arrow) arrow.textContent = "▾";
                });
            },
        });
        var compactMode = localStorage.getItem("sg_compact") === "1";
        var btnCompact = el("button", {
            className: "sg-btn sg-btn-secondary" + (compactMode ? " sg-active" : ""),
            textContent: "Compact",
            title: "Dense list / smaller cards",
            onClick: function () {
                compactMode = !compactMode;
                localStorage.setItem("sg_compact", compactMode ? "1" : "0");
                panel.classList.toggle("sg-compact", compactMode);
                btnCompact.classList.toggle("sg-active", compactMode);
            },
        });
        if (compactMode) panel.classList.add("sg-compact");

        searchRow.appendChild(btnCollapseAll);
        searchRow.appendChild(btnExpandAll);
        searchRow.appendChild(btnCompact);
        searchRow.appendChild(btnClearAll);
        searchRow.appendChild(btnApply);
        searchRow.appendChild(btnClose);
        header.appendChild(searchRow);

        panel.appendChild(header);

        // --- Body: sidebar (anchor nav) + main content ---
        var body = el("div", { className: "sg-body" });
        var main = el("div", { className: "sg-main", id: "sg_main_" + tabName });
        var showSidebar = sortedCats.length > 5;
        var favSet = getFavorites(tabName);

        /** Show only one category section (or all if catId is null). */
        function showOnlyCategory(catId) {
            var sections = main.querySelectorAll(".sg-category");
            sections.forEach(function (sec) {
                if (catId === null) {
                    sec.style.display = "";
                } else {
                    var want = (sec.id === "sg-cat-FAVORITES" && catId === "FAVORITES") || (sec.id === "sg-cat-" + catId.replace(/\s/g, "_"));
                    sec.style.display = want ? "" : "none";
                }
            });
        }

        if (showSidebar) {
            var sidebar = el("div", { className: "sg-sidebar" });
            sidebar.appendChild(el("div", { className: "sg-sidebar-label", textContent: "Categories" }));
            var btnAll = el("button", {
                type: "button",
                className: "sg-sidebar-btn sg-sidebar-btn-all",
                textContent: "All",
                onClick: function () {
                    showOnlyCategory(null);
                    qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); });
                    btnAll.classList.add("sg-active");
                },
            });
            btnAll.classList.add("sg-active");
            sidebar.appendChild(btnAll);
            var btnFav = el("button", {
                type: "button",
                className: "sg-sidebar-btn",
                textContent: "★ Favorites",
                onClick: function () {
                    showOnlyCategory("FAVORITES");
                    qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); });
                    btnFav.classList.add("sg-active");
                },
            });
            sidebar.appendChild(btnFav);
            sortedCats.forEach(function (catName) {
                var btn = el("button", {
                    type: "button",
                    className: "sg-sidebar-btn",
                    textContent: catName,
                    onClick: function () {
                        showOnlyCategory(catName);
                        qsa(".sg-sidebar-btn", sidebar).forEach(function (b) { b.classList.remove("sg-active"); });
                        btn.classList.add("sg-active");
                    },
                });
                sidebar.appendChild(btn);
            });
            body.appendChild(sidebar);
        }

        /** Compact All / Favorites toggle above the grid (when sidebar is hidden). */
        if (!showSidebar) {
            var filterBar = el("div", { className: "sg-filter-bar" });
            var compactAll = el("button", {
                type: "button",
                className: "sg-filter-btn sg-active",
                textContent: "All",
                onClick: function () {
                    showOnlyCategory(null);
                    compactAll.classList.add("sg-active");
                    compactFav.classList.remove("sg-active");
                },
            });
            var compactFav = el("button", {
                type: "button",
                className: "sg-filter-btn",
                textContent: "★ Favorites",
                onClick: function () {
                    showOnlyCategory("FAVORITES");
                    compactFav.classList.add("sg-active");
                    compactAll.classList.remove("sg-active");
                },
            });
            filterBar.appendChild(compactAll);
            filterBar.appendChild(compactFav);
            body.appendChild(filterBar);
        }

        /** Update Favorites section when star is toggled: add or remove card, update count. */
        function updateFavoritesSection(tabName, styleName, style, added) {
            var panel = state[tabName].panel;
            if (!panel) return;
            var favSection = panel.querySelector("#sg-cat-FAVORITES");
            if (!favSection) return;
            var grid = favSection.querySelector(".sg-grid");
            if (!grid) return;
            if (added) {
                if (grid.querySelector(".sg-card[data-style-name=\"" + CSS.escape(styleName) + "\"]")) return;
                var color = "#eab308";
                var card = el("div", {
                    className: "sg-card",
                    "data-style-name": style.name,
                    "data-category": "FAVORITES",
                    "data-search-name": buildSearchTextNameOnly(style),
                });
                card.style.setProperty("--cat-color", color);
                if (state[tabName].selected.has(style.name)) card.classList.add("sg-selected");
                var star = el("span", {
                    className: "sg-card-star sg-fav",
                    title: "Toggle favorite",
                    innerHTML: "★",
                    onClick: function (e) {
                        e.stopPropagation();
                        toggleFavorite(tabName, style.name);
                        updateFavoritesSection(tabName, style.name, style, false);
                    },
                });
                card.appendChild(star);
                card.appendChild(el("div", { className: "sg-card-name", textContent: style.display_name || style.name }));
                if (style.prompt) card.title = style.prompt.length > 120 ? style.prompt.substring(0, 120) + "…" : style.prompt;
                card.addEventListener("click", function () { toggleStyle(tabName, style.name, card); });
                grid.appendChild(card);
            } else {
                var cardToRemove = grid.querySelector(".sg-card[data-style-name=\"" + CSS.escape(styleName) + "\"]");
                if (cardToRemove) cardToRemove.remove();
            }
            var count = grid.children.length;
            var catTitle = favSection.querySelector(".sg-cat-title");
            if (catTitle && catTitle.childNodes.length >= 2) catTitle.childNodes[1].textContent = " (" + count + ")";
        }

        /** Build one category section (collapsible header + grid of cards with star). */
        function appendCategorySection(container, catName, styles, color, isFav) {
            var section = el("div", {
                className: "sg-category",
                "data-category": isFav ? "FAVORITES" : catName,
            });
            section.id = isFav ? "sg-cat-FAVORITES" : ("sg-cat-" + (catName + "").replace(/\s/g, "_"));

            var catHeader = el("div", { className: "sg-cat-header" });
            catHeader.style.borderLeftColor = color;
            var catTitle = el("span", { className: "sg-cat-title" });
            var catBadge = el("span", { className: "sg-cat-badge" });
            catBadge.style.backgroundColor = color;
            catBadge.textContent = catName;
            catTitle.appendChild(catBadge);
            catTitle.appendChild(document.createTextNode(" (" + styles.length + ")"));
            var catArrow = el("span", { className: "sg-cat-arrow", textContent: "▾" });
            var catSelectAll = el("button", {
                className: "sg-cat-select-all",
                textContent: "Select All",
                onClick: function (e) {
                    e.stopPropagation();
                    toggleCategoryAll(tabName, catName);
                },
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
                    className: "sg-card",
                    "data-style-name": style.name,
                    "data-category": isFav ? (style.category || FAV_CAT) : catName,
                    "data-search-name": buildSearchTextNameOnly(style),
                });
                card.style.setProperty("--cat-color", color);
                if (state[tabName].selected.has(style.name)) card.classList.add("sg-selected");

                var star = el("span", {
                    className: "sg-card-star" + (getFavorites(tabName).has(style.name) ? " sg-fav" : ""),
                    title: "Toggle favorite",
                    innerHTML: "★",
                    onClick: function (e) {
                        e.stopPropagation();
                        var added = !getFavorites(tabName).has(style.name);
                        toggleFavorite(tabName, style.name);
                        star.classList.toggle("sg-fav", getFavorites(tabName).has(style.name));
                        updateFavoritesSection(tabName, style.name, style, added);
                    },
                });
                card.appendChild(star);
                var cardName = el("div", { className: "sg-card-name", textContent: style.display_name });
                card.appendChild(cardName);
                if (style.prompt) {
                    card.title = style.prompt.length > 120 ? style.prompt.substring(0, 120) + "…" : style.prompt;
                }
                card.addEventListener("click", function () { toggleStyle(tabName, style.name, card); });
                grid.appendChild(card);
            });
            section.appendChild(grid);
            container.appendChild(section);
        }

        // --- Favorites section (always present; empty when no favorites) ---
        var favStyles = [];
        sortedCats.forEach(function (catName) {
            (categories[catName] || []).forEach(function (s) {
                if (favSet.has(s.name)) favStyles.push(s);
            });
        });
        appendCategorySection(main, "★ " + FAV_CAT, favStyles, "#eab308", true);

        // --- Category sections ---
        sortedCats.forEach(function (catName) {
            var styles = categories[catName];
            if (!styles || styles.length === 0) return;
            var color = getCategoryColor(catName);
            appendCategorySection(main, catName, styles, color, false);
        });

        body.appendChild(main);
        panel.appendChild(body);

        // --- Footer with selected tags ---
        const footer = el("div", { className: "sg-footer", id: `sg_footer_${tabName}` });
        const footerLabel = el("span", { className: "sg-footer-label", textContent: "Selected: " });
        const footerTags = el("div", { className: "sg-footer-tags", id: `sg_tags_${tabName}` });
        footer.appendChild(footerLabel);
        footer.appendChild(footerTags);
        panel.appendChild(footer);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        state[tabName].panel = overlay;
        return overlay;
    }

    // -----------------------------------------------------------------------
    // Interaction handlers
    // -----------------------------------------------------------------------
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
        qsa(".sg-card.sg-selected", state[tabName].panel).forEach(c =>
            c.classList.remove("sg-selected")
        );
        updateSelectedUI(tabName);
    }

    function toggleCategoryAll(tabName, catName) {
        const cards = qsa(`.sg-category[data-category="${catName}"] .sg-card`, state[tabName].panel);
        const allSelected = [...cards].every(c => c.classList.contains("sg-selected"));
        
        cards.forEach(c => {
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
        const panel = state[tabName].panel;
        if (!panel) return;
        const searchEl = qs(`#sg_search_${tabName}`, panel);
        const query = searchEl ? normalizeSearchText(searchEl.value) : "";
        const cards = qsa(".sg-card", panel);
        const sections = qsa(".sg-category", panel);

        var matchedCategory = findCategoryMatch(query, tabName);

        if (matchedCategory !== null) {
            // Requirement 1: Query matches a category (startsWith) → show only that category
            sections.forEach(function (sec) {
                var cat = sec.getAttribute("data-category");
                sec.style.display = (cat === matchedCategory) ? "" : "none";
            });
            cards.forEach(function (card) {
                var cardCat = card.getAttribute("data-category");
                card.classList.toggle("sg-card-hidden", cardCat !== matchedCategory);
            });
        } else {
            // Requirement 2: Strict name matching — search only in style name (and display_name)
            sections.forEach(function (sec) {
                sec.style.display = "";
            });
            cards.forEach(function (card) {
                var nameOnlyText = card.getAttribute("data-search-name") || "";
                var match = !query || nameMatchesQuery(nameOnlyText, query);
                card.classList.toggle("sg-card-hidden", !match);
            });
            sections.forEach(function (sec) {
                var visibleCards = sec.querySelectorAll(".sg-card:not(.sg-card-hidden)");
                sec.style.display = visibleCards.length > 0 ? "" : "none";
            });
        }
    }

    function updateSelectedUI(tabName) {
        const count = state[tabName].selected.size;
        const countEl = qs(`#sg_count_${tabName}`);
        if (countEl) countEl.textContent = `${count} selected`;

        // Update footer tags
        const tagsEl = qs(`#sg_tags_${tabName}`);
        if (tagsEl) {
            tagsEl.innerHTML = "";
            state[tabName].selected.forEach(name => {
                const tag = el("span", { className: "sg-tag" });
                // Find display name
                let displayName = name;
                for (const styles of Object.values(state[tabName].categories)) {
                    const found = styles.find(s => s.name === name);
                    if (found) { displayName = found.display_name; break; }
                }
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

        // Update grid button badge
        const badge = qs(`#sg_btn_badge_${tabName}`);
        if (badge) {
            badge.textContent = count > 0 ? count : "";
            badge.style.display = count > 0 ? "flex" : "none";
        }
    }

    // -----------------------------------------------------------------------
    // Apply styles to prompt fields
    // -----------------------------------------------------------------------
    function applyStyles(tabName) {
        const selected = [...state[tabName].selected];
        if (selected.length === 0) {
            togglePanel(tabName, false);
            return;
        }

        const categories = state[tabName].categories;
        const allStyles = [];
        Object.values(categories).forEach(arr => arr.forEach(s => allStyles.push(s)));

        const promptEl = qs(`#${tabName}_prompt textarea`);
        const negEl = qs(`#${tabName}_neg_prompt textarea`);

        if (!promptEl || !negEl) {
            console.error("[Style Grid] Could not find prompt textareas for", tabName);
            togglePanel(tabName, false);
            return;
        }

        let prompt = promptEl.value;
        let neg = negEl.value;
        const posAdd = [];
        const negAdd = [];

        selected.forEach(name => {
            const style = allStyles.find(s => s.name === name);
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

        // Set values and trigger Gradio update
        promptEl.value = prompt;
        negEl.value = neg;
        promptEl.dispatchEvent(new Event("input", { bubbles: true }));
        negEl.dispatchEvent(new Event("input", { bubbles: true }));

        togglePanel(tabName, false);
    }

    // -----------------------------------------------------------------------
    // Toggle panel visibility
    // -----------------------------------------------------------------------
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
            filterStyles(tabName);
            setTimeout(function () {
                const search = qs(`#sg_search_${tabName}`, panel);
                if (search) search.focus();
            }, 100);
        } else {
            panel.classList.remove("sg-visible");
        }
    }

    // -----------------------------------------------------------------------
    // Create the trigger button next to the small buttons under Generate
    // -----------------------------------------------------------------------
    function createTriggerButton(tabName) {
        // The small tool buttons are in a div near the Generate button
        // In Forge, they're typically in: #txt2img_actions_column or #img2img_actions_column
        // Inside .style_create_row or near the style-related buttons

        const btn = el("button", {
            className: "sg-trigger-btn lg secondary gradio-button tool svelte-cmf5ev",
            id: `sg_trigger_${tabName}`,
            title: "Open Style Grid",
            innerHTML: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" width=\"16\" height=\"16\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\"/></svg>",
        });

        const badge = el("span", {
            className: "sg-btn-badge",
            id: `sg_btn_badge_${tabName}`,
        });
        badge.style.display = "none";
        btn.appendChild(badge);

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel(tabName);
        });

        return btn;
    }

    function injectButton(tabName) {
        // Strategy: find the row of small buttons under Generate
        // In Forge/A1111, these are in: #{tabName}_tools or #{tabName}_style_*
        
        // Try multiple possible locations
        const selectors = [
            `#${tabName}_tools`,                           // Standard tools row
            `#${tabName}_styles_row`,                      // Styles row  
            `#${tabName}_actions_column .style_create_row`, // Style create row
            `#${tabName}_actions_column`,                   // Fallback to actions column
        ];

        let target = null;
        for (const sel of selectors) {
            target = qs(sel);
            if (target) break;
        }

        // Alternative: find the small buttons (paste, clear, etc.) near prompt
        if (!target) {
            // Look for the row of icon buttons below the prompt area
            const styleDropdown = qs(`#${tabName}_styles_row`) || qs(`#${tabName}_styles`);
            if (styleDropdown) {
                target = styleDropdown.parentElement;
            }
        }

        if (!target) {
            // Last resort: find any tool button row in the tab
            const tabEl = qs(`#tab_${tabName}`);
            if (tabEl) {
                const toolBtns = tabEl.querySelectorAll(".tool");
                if (toolBtns.length > 0) {
                    target = toolBtns[toolBtns.length - 1].parentElement;
                }
            }
        }

        if (!target) {
            console.warn(`[Style Grid] Could not find injection point for ${tabName}. Will retry...`);
            return false;
        }

        const btn = createTriggerButton(tabName);
        
        // Try to insert in a reasonable position
        // If we found the tools row, append to it
        if (target.id && target.id.includes("tools")) {
            target.appendChild(btn);
        } else if (target.classList.contains("style_create_row")) {
            target.appendChild(btn);
        } else {
            // Insert after the target element
            target.parentNode.insertBefore(btn, target.nextSibling);
        }

        return true;
    }

    // -----------------------------------------------------------------------
    // Keyboard shortcut
    // -----------------------------------------------------------------------
    document.addEventListener("keydown", (e) => {
        // Escape to close panel
        if (e.key === "Escape") {
            ["txt2img", "img2img"].forEach(tab => {
                if (state[tab].panel && state[tab].panel.classList.contains("sg-visible")) {
                    togglePanel(tab, false);
                    e.preventDefault();
                }
            });
        }
    });

    // -----------------------------------------------------------------------
    // Initialize
    // -----------------------------------------------------------------------
    function init() {
        let attempts = 0;
        const maxAttempts = 50;

        const tryInject = () => {
            attempts++;
            let txt2imgDone = qs("#sg_trigger_txt2img") !== null;
            let img2imgDone = qs("#sg_trigger_img2img") !== null;

            if (!txt2imgDone) txt2imgDone = injectButton("txt2img");
            if (!img2imgDone) img2imgDone = injectButton("img2img");

            if ((!txt2imgDone || !img2imgDone) && attempts < maxAttempts) {
                setTimeout(tryInject, 500);
            } else {
                if (txt2imgDone) console.log("[Style Grid] txt2img button injected");
                if (img2imgDone) console.log("[Style Grid] img2img button injected");
            }
        };

        // Start trying after a short delay to let Gradio render
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(tryInject, 1500));
        } else {
            setTimeout(tryInject, 1500);
        }
    }

    init();
})();
