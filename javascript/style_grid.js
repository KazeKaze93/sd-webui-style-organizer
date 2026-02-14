/**
 * Style Grid - Loader for Forge WebUI
 * Injects trigger button, overlay, and mounts the React UI (style_grid_ui.js).
 * Apply logic and Gradio integration live here; panel UI is in the React bundle.
 */
(function () {
    "use strict";

    const state = {
        txt2img: { categories: {}, panel: null },
        img2img: { categories: {}, panel: null },
    };

    let applyMode = localStorage.getItem("sg_apply_mode") || "prompt";

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
                else e.setAttribute(k, v);
            });
        if (children) {
            (Array.isArray(children) ? children : [children]).forEach((c) => {
                if (typeof c === "string") e.appendChild(document.createTextNode(c));
                else if (c) e.appendChild(c);
            });
        }
        return e;
    }

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
        } catch {
            return [];
        }
    }

    function injectStyles() {
        if (qs("#sg-injected-styles")) return;
        const style = el("style", { id: "sg-injected-styles" });
        style.textContent = [
            ".sg-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;opacity:0;transition:opacity .2s}",
            ".sg-overlay.sg-visible{display:flex;opacity:1}",
            ".sg-panel-wrapper{width:90vw;max-width:1200px;height:85vh;max-height:85vh;background:var(--background-fill-primary,#111827);border:1px solid var(--border-color-primary,#374151);border-radius:12px;display:flex;flex-direction:column;box-shadow:0 25px 60px rgba(0,0,0,.5)}",
            ".sg-trigger-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:var(--size-10,2.5rem);height:var(--size-10,2.5rem);min-width:var(--size-10,2.5rem);padding:0;margin:0;border:1px solid var(--border-color-primary,#374151);border-radius:6px;background:var(--button-secondary-background-fill,#1f2937);color:var(--body-text-color,#d1d5db);cursor:pointer;flex-shrink:0;box-sizing:border-box}",
            ".sg-trigger-btn:hover{background:var(--button-secondary-background-fill-hover,#374151);border-color:var(--color-accent,#6366f1);color:#fff}",
            ".sg-btn-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#6366f1;color:#fff;font-size:10px;font-weight:700;display:none;align-items:center;justify-content:center;line-height:1}",
            ".sg-btn-badge:not([data-empty]){display:flex}",
        ].join("\n");
        document.head.appendChild(style);
    }

    function applyStyles(tabName, selectedArray, mode) {
        if (!selectedArray || selectedArray.length === 0) return;

        const useSilent = mode === "silent";
        if (useSilent) {
            const dataEl = qs(`#style_grid_selected_${tabName} textarea`);
            if (dataEl) {
                dataEl.value = JSON.stringify(selectedArray);
                dataEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
            console.log("[Style Grid] Silent mode: %d styles stored for generation", selectedArray.length);
            return;
        }

        const categories = state[tabName].categories;
        const allStyles = [];
        Object.values(categories).forEach((arr) => arr.forEach((s) => allStyles.push(s)));

        const promptEl = qs(`#${tabName}_prompt textarea`);
        const negEl = qs(`#${tabName}_neg_prompt textarea`);
        if (!promptEl || !negEl) {
            console.error("[Style Grid] Could not find prompt textareas for", tabName);
            return;
        }

        let prompt = promptEl.value;
        let neg = negEl.value;
        const posAdd = [];
        const negAdd = [];

        selectedArray.forEach((name) => {
            const style = allStyles.find((s) => s.name === name);
            if (!style) return;
            if (style.prompt) {
                if (style.prompt.includes("{prompt}")) prompt = style.prompt.replace("{prompt}", prompt);
                else posAdd.push(style.prompt);
            }
            if (style.negative_prompt) {
                if (style.negative_prompt.includes("{prompt}"))
                    neg = style.negative_prompt.replace("{prompt}", neg);
                else negAdd.push(style.negative_prompt);
            }
        });

        if (posAdd.length) {
            const sep = prompt.trim() ? ", " : "";
            prompt = prompt.replace(/,\s*$/, "") + sep + posAdd.join(", ");
        }
        if (negAdd.length) {
            const sep = neg.trim() ? ", " : "";
            neg = neg.replace(/,\s*$/, "") + sep + negAdd.join(", ");
        }

        promptEl.value = prompt;
        negEl.value = neg;
        promptEl.dispatchEvent(new Event("input", { bubbles: true }));
        negEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function buildPanel(tabName) {
        injectStyles();
        const categories = loadStyles(tabName);
        state[tabName].categories = categories;

        const overlay = el("div", { className: "sg-overlay", id: `sg_overlay_${tabName}` });
        let mouseDownTarget = null;
        overlay.addEventListener("mousedown", (e) => { mouseDownTarget = e.target; });
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay && mouseDownTarget === overlay) togglePanel(tabName, false);
            mouseDownTarget = null;
        });

        const wrapper = el("div", { className: "sg-panel-wrapper dark" });
        const reactRoot = el("div", { id: "sg-react-root", className: "flex h-full flex-1 flex-col min-h-0" });
        wrapper.appendChild(reactRoot);
        overlay.appendChild(wrapper);
        document.body.appendChild(overlay);

        state[tabName].panel = overlay;

        function mount() {
            if (typeof window.StyleGridMount !== "function") {
                setTimeout(mount, 50);
                return;
            }
            const catOrder = getCategoryOrder(tabName);
            window.StyleGridMount(reactRoot, {
                tabName,
                categories,
                categoryOrder: catOrder,
                initialSelected: [],
                applyMode: localStorage.getItem("sg_apply_mode") || "prompt",
                onApply: (selectedArray, mode) => applyStyles(tabName, selectedArray, mode),
                onClose: () => togglePanel(tabName, false),
                onSelectedChange: (count) => {
                    const badge = qs(`#sg_btn_badge_${tabName}`);
                    if (badge) {
                        badge.textContent = count > 0 ? count : "";
                        if (count > 0) badge.removeAttribute("data-empty");
                        else badge.setAttribute("data-empty", "1");
                    }
                },
            });
        }
        mount();
        return overlay;
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
            className: "sg-trigger-btn",
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
        let attempts = 0;
        const tryInject = () => {
            attempts++;
            let a = qs("#sg_trigger_txt2img") !== null;
            let b = qs("#sg_trigger_img2img") !== null;
            if (!a) a = injectButton("txt2img");
            if (!b) b = injectButton("img2img");
            if ((!a || !b) && attempts < 50) setTimeout(tryInject, 500);
        };
        if (document.readyState === "loading")
            document.addEventListener("DOMContentLoaded", () => setTimeout(tryInject, 1500));
        else setTimeout(tryInject, 1500);
    }
    init();
})();
