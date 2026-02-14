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

    // Apply mode: "prompt" = inject text into prompt fields (visible),
    //             "silent" = store internally, apply at generation time (like Forge native styles)
    let applyMode = localStorage.getItem("sg_apply_mode") || "prompt";

    const CATEGORY_COLORS = {
        BASE: "#6366f1",     // indigo
        STYLE: "#3b82f6",    // blue
        SCENE: "#22c55e",    // green
        THEME: "#8b5cf6",    // violet
        POSE: "#14b8a6",     // teal
        LIGHTING: "#f59e0b", // amber
        COLOR: "#ec4899",    // pink
        CAMERA: "#f97316",   // orange
        OTHER: "#6b7280",    // gray
    };

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
        // Track where mousedown started to prevent closing when user drags
        // from inside the panel (e.g. selecting text in search) to the overlay
        let mouseDownTarget = null;
        overlay.addEventListener("mousedown", (e) => { mouseDownTarget = e.target; });
        overlay.addEventListener("click", (e) => {
            // Only close if BOTH mousedown and click happened on the overlay itself
            if (e.target === overlay && mouseDownTarget === overlay) {
                togglePanel(tabName, false);
            }
            mouseDownTarget = null;
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
            placeholder: "Search styles... (supports multiple words, e.g. 'water soft')",
            id: `sg_search_${tabName}`,
        });
        searchInput.addEventListener("input", () => filterStyles(tabName));
        // Prevent overlay close when interacting with search input
        searchInput.addEventListener("mousedown", (e) => e.stopPropagation());
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
        searchRow.appendChild(btnClearAll);
        searchRow.appendChild(btnApply);
        searchRow.appendChild(btnClose);
        header.appendChild(searchRow);

        // Apply mode toggle row
        const modeRow = el("div", { className: "sg-mode-row" });
        const modeLabel = el("span", {
            className: "sg-mode-label",
            textContent: "Apply mode:",
        });
        const modeToggle = el("div", {
            className: "sg-mode-toggle",
            id: `sg_mode_toggle_${tabName}`,
        });
        const modeOptPrompt = el("button", {
            className: "sg-mode-opt" + (applyMode === "prompt" ? " sg-mode-active" : ""),
            textContent: "Insert into prompt",
            title: "Style text will be inserted directly into prompt fields (visible)",
            "data-mode": "prompt",
        });
        const modeOptSilent = el("button", {
            className: "sg-mode-opt" + (applyMode === "silent" ? " sg-mode-active" : ""),
            textContent: "Apply at generation",
            title: "Styles are applied under the hood during generation (like Forge built-in styles)",
            "data-mode": "silent",
        });
        [modeOptPrompt, modeOptSilent].forEach(opt => {
            opt.addEventListener("click", (e) => {
                e.stopPropagation();
                applyMode = opt.getAttribute("data-mode");
                localStorage.setItem("sg_apply_mode", applyMode);
                // Update all toggle UIs
                qsa(".sg-mode-opt").forEach(o => o.classList.remove("sg-mode-active"));
                qsa(`.sg-mode-opt[data-mode="${applyMode}"]`).forEach(o => o.classList.add("sg-mode-active"));
            });
        });
        modeToggle.appendChild(modeOptPrompt);
        modeToggle.appendChild(modeOptSilent);
        modeRow.appendChild(modeLabel);
        modeRow.appendChild(modeToggle);
        header.appendChild(modeRow);

        panel.appendChild(header);

        // --- Categories & Grid ---
        const content = el("div", { className: "sg-content" });

        sortedCats.forEach(catName => {
            const styles = categories[catName];
            if (!styles || styles.length === 0) return;

            const color = CATEGORY_COLORS[catName] || CATEGORY_COLORS.OTHER;

            const section = el("div", {
                className: "sg-category",
                "data-category": catName,
            });

            // Category header (collapsible)
            const catHeader = el("div", { className: "sg-cat-header" });
            catHeader.style.borderLeftColor = color;

            const catTitle = el("span", { className: "sg-cat-title" });
            const catBadge = el("span", { className: "sg-cat-badge" });
            catBadge.style.backgroundColor = color;
            catBadge.textContent = catName;
            catTitle.appendChild(catBadge);
            catTitle.appendChild(document.createTextNode(` (${styles.length})`));

            const catArrow = el("span", { className: "sg-cat-arrow", textContent: "▾" });
            
            // Select all button for category
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

            // Grid of style cards
            const grid = el("div", { className: "sg-grid" });
            styles.forEach(style => {
                const card = el("div", {
                    className: "sg-card",
                    "data-style-name": style.name,
                    "data-search": (style.name + " " + style.display_name + " " + (style.prompt || "") + " " + (style.negative_prompt || "")).toLowerCase(),
                });
                card.style.setProperty("--cat-color", color);

                if (state[tabName].selected.has(style.name)) {
                    card.classList.add("sg-selected");
                }

                const cardName = el("div", { className: "sg-card-name", textContent: style.display_name });
                card.appendChild(cardName);

                // Tooltip on hover showing the prompt snippet
                if (style.prompt) {
                    const snippet = style.prompt.length > 120
                        ? style.prompt.substring(0, 120) + "…"
                        : style.prompt;
                    card.title = snippet;
                }

                card.addEventListener("click", () => toggleStyle(tabName, style.name, card));
                grid.appendChild(card);
            });

            section.appendChild(grid);
            content.appendChild(section);
        });

        panel.appendChild(content);

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

    /**
     * Advanced search/filter with support for:
     * - Multi-word queries (AND logic): "water soft" matches cards containing both words
     * - Quoted phrases for exact match: "soft edges" matches that exact phrase
     * - Prefix matching: "cyber" matches "cyberpunk"
     * - Category filter with @: "@STYLE water" filters category STYLE + word "water"
     * - Negative filter with -: "water -ocean" matches water but NOT ocean
     * - Search across name, display_name, prompt and negative_prompt
     */
    function filterStyles(tabName) {
        const raw = qs(`#sg_search_${tabName}`).value.trim();
        const cards = qsa(".sg-card", state[tabName].panel);
        const sections = qsa(".sg-category", state[tabName].panel);

        if (!raw) {
            cards.forEach(card => { card.style.display = ""; });
            sections.forEach(sec => { sec.style.display = ""; });
            return;
        }

        // Parse query into tokens
        const catFilter = [];    // @CATEGORY tokens
        const negTokens = [];    // -word exclusion tokens
        const phraseTokens = []; // "exact phrase" tokens
        const wordTokens = [];   // plain word tokens

        // Extract quoted phrases first
        let remaining = raw;
        const phraseRegex = /"([^"]+)"/g;
        let phraseMatch;
        while ((phraseMatch = phraseRegex.exec(raw)) !== null) {
            phraseTokens.push(phraseMatch[1].toLowerCase());
        }
        remaining = remaining.replace(phraseRegex, "").trim();

        // Parse remaining tokens
        remaining.split(/\s+/).forEach(token => {
            if (!token) return;
            if (token.startsWith("@")) {
                const cat = token.slice(1).toUpperCase();
                if (cat) catFilter.push(cat);
            } else if (token.startsWith("-") && token.length > 1) {
                negTokens.push(token.slice(1).toLowerCase());
            } else {
                wordTokens.push(token.toLowerCase());
            }
        });

        cards.forEach(card => {
            const searchData = card.getAttribute("data-search"); // already lowercase
            const styleName = card.getAttribute("data-style-name");
            const category = card.closest(".sg-category")?.getAttribute("data-category") || "";

            // Category filter: if any @CAT specified, card must be in one of those categories
            if (catFilter.length > 0 && !catFilter.includes(category)) {
                card.style.display = "none";
                return;
            }

            // Negative filter: if any -word matches, exclude the card
            for (const neg of negTokens) {
                if (searchData.includes(neg)) {
                    card.style.display = "none";
                    return;
                }
            }

            // Phrase filter: all quoted phrases must appear as exact substrings
            for (const phrase of phraseTokens) {
                if (!searchData.includes(phrase)) {
                    card.style.display = "none";
                    return;
                }
            }

            // Word filter (AND logic): every word must appear somewhere in the search data
            let allMatch = true;
            for (const word of wordTokens) {
                if (!searchData.includes(word)) {
                    allMatch = false;
                    break;
                }
            }

            card.style.display = allMatch ? "" : "none";
        });

        // Hide empty categories
        sections.forEach(sec => {
            const visibleCards = sec.querySelectorAll(".sg-card:not([style*='display: none'])");
            sec.style.display = visibleCards.length > 0 ? "" : "none";

            // Auto-expand categories that have matches when searching
            if (visibleCards.length > 0 && raw && sec.classList.contains("sg-collapsed")) {
                sec.classList.remove("sg-collapsed");
                const arrow = sec.querySelector(".sg-cat-arrow");
                if (arrow) arrow.textContent = "▾";
            }
        });
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

        if (applyMode === "silent") {
            // Silent mode: store selected styles in hidden Gradio component
            // and let the Python backend apply them during generation
            const dataEl = qs(`#style_grid_selected_${tabName} textarea`);
            if (dataEl) {
                dataEl.value = JSON.stringify(selected);
                dataEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
            console.log("[Style Grid] Silent mode: %d styles stored for generation", selected.length);
            togglePanel(tabName, false);
            return;
        }

        // Prompt mode: inject text directly into prompt fields (visible)
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
            // Focus search
            setTimeout(() => {
                const search = qs(`#sg_search_${tabName}`);
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
            className: "sg-trigger-btn",
            id: `sg_trigger_${tabName}`,
            title: "Open Style Grid",
            innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
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
