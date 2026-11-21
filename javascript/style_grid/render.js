/**
 * Style Grid host — DOM helpers, panel show/hide and host overlay a11y.
 * Style, import/export and backup dialogs live in the iframe (ui/src/components).
 */
"use strict";

import { state } from "./state.js";
import { postToFrame } from "./post-message.js";

/** Late-bound host actions (filled by events.js to avoid cycles). */
export const hooks = {
    ensureSGFramesOnce: null,
    syncWildcards: null,
    scheduleSyncForgeHostTabToV2Frames: null,
    forgeTab: {
        lastBroadcast: null,
    },
};

var _sgHostPrevBodyOverflow = "";
var _sgHostPrevDocOverflow = "";
var _sgHostScrollLocked = false;
var _sgHostKbdInstalled = false;
var SG_HOST_OVERLAY_SEL = ".sg-editor-overlay";
var SG_FOCUSABLE_SEL = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function restoreFocus(el) {
        if (!el || typeof el.focus !== "function") return;
        if (el.isConnected === false) return;
        try { el.focus(); } catch (_err) { /* ignore */ }
    }

function getFocusableElements(root) {
        if (!root || !root.querySelectorAll) return [];
        return Array.prototype.filter.call(root.querySelectorAll(SG_FOCUSABLE_SEL), function (node) {
            if (node.disabled) return false;
            if (node.getAttribute("aria-hidden") === "true") return false;
            var style = window.getComputedStyle(node);
            if (style.visibility === "hidden" || style.display === "none") return false;
            return true;
        });
    }

function getTopmostHostOverlay() {
        var list = document.querySelectorAll(SG_HOST_OVERLAY_SEL);
        return list.length ? list[list.length - 1] : null;
    }

function focusTriggerButton(tab) {
        restoreFocus(qs("#sg_trigger_" + tab));
    }

function getPanelTarget(tab) {
        var fr = state[tab] && state[tab].sgFrame;
        var wr = state[tab] && state[tab].sgFrameWrapper;
        if (!wr && fr && fr.parentElement && fr.parentElement.id === "sg-panel-wrapper-" + tab) {
            wr = fr.parentElement;
            state[tab].sgFrameWrapper = wr;
        }
        return wr || fr || null;
    }

function syncTriggerExpanded(tab) {
        var btn = qs("#sg_trigger_" + tab);
        if (!btn) return;
        var wr = getPanelTarget(tab);
        var expanded = !!(wr && wr.style.display === "block");
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

function closeSGPanel(tab) {
        var target = getPanelTarget(tab);
        if (!target) return false;
        if (target.style.display !== "block") {
            syncTriggerExpanded(tab);
            return false;
        }
        target.style.display = "none";
        setHostPageScrollLock(anySGFrameVisible());
        syncTriggerExpanded(tab);
        focusTriggerButton(tab);
        return true;
    }

function tryCloseTopmostHostOverlay() {
        var overlay = getTopmostHostOverlay();
        if (!overlay) return false;
        if (overlay.classList.contains("sg-batch-overlay")) {
            var cancelBtn = overlay.querySelector(".sg-btn-danger");
            if (cancelBtn && !cancelBtn.disabled) {
                cancelBtn.click();
                return true;
            }
        }
        if (typeof overlay._sgCloseOverlay === "function") {
            overlay._sgCloseOverlay();
        } else {
            overlay.remove();
        }
        return true;
    }

function trapTabKey(e, overlay) {
        var modal = overlay.querySelector(".sg-editor-modal") || overlay;
        var nodes = getFocusableElements(modal);
        if (!nodes.length) {
            e.preventDefault();
            return;
        }
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        var active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !modal.contains(active)) {
                e.preventDefault();
                last.focus();
            }
        } else if (active === last || !modal.contains(active)) {
            e.preventDefault();
            first.focus();
        }
    }

function enhanceHostOverlay(overlay, opts) {
        opts = opts || {};
        if (!overlay || overlay.dataset.sgA11y === "1") return;
        overlay.dataset.sgA11y = "1";
        var prevFocus = document.activeElement;
        var modal = overlay.querySelector(".sg-editor-modal") || overlay;

        function cleanupAndRestore() {
            if (overlay._sgA11yCleaned) return;
            overlay._sgA11yCleaned = true;
            restoreFocus(prevFocus);
        }

        var nativeRemove = overlay.remove;
        overlay.remove = function () {
            cleanupAndRestore();
            return nativeRemove.call(overlay);
        };
        overlay._sgCloseOverlay = function () {
            overlay.remove();
        };

        var initial = opts.initialFocus;
        if (!initial || !modal.contains(initial)) {
            initial = getFocusableElements(modal)[0] || modal;
        }
        if (initial === modal && !modal.hasAttribute("tabindex")) {
            modal.setAttribute("tabindex", "-1");
        }
        setTimeout(function () {
            if (overlay.isConnected) restoreFocus(initial);
        }, 0);
    }

function installHostKeyboardA11y() {
        if (_sgHostKbdInstalled) return;
        _sgHostKbdInstalled = true;

        document.addEventListener("keydown", function (e) {
            var overlay = getTopmostHostOverlay();
            if (overlay && e.key === "Tab") {
                trapTabKey(e, overlay);
                return;
            }
            if (e.key !== "Escape") return;
            if (tryCloseTopmostHostOverlay()) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
                return;
            }
            var closed = false;
            ["txt2img", "img2img"].forEach(function (t) {
                if (closeSGPanel(t)) closed = true;
            });
            if (closed) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
            }
        }, true);

        function watchOverlays() {
            if (!document.body || typeof MutationObserver !== "function") return;
            var obs = new MutationObserver(function (mutations) {
                mutations.forEach(function (m) {
                    Array.prototype.forEach.call(m.addedNodes || [], function (node) {
                        if (!node || node.nodeType !== 1) return;
                        if (node.classList && node.classList.contains("sg-editor-overlay")) {
                            enhanceHostOverlay(node);
                        }
                        if (node.querySelectorAll) {
                            Array.prototype.forEach.call(
                                node.querySelectorAll(SG_HOST_OVERLAY_SEL),
                                function (el) { enhanceHostOverlay(el); }
                            );
                        }
                    });
                });
            });
            obs.observe(document.body, { childList: true, subtree: true });
        }
        if (document.body) watchOverlays();
        else document.addEventListener("DOMContentLoaded", watchOverlays);
    }

function qs(sel, root) {
        if (root) return root.querySelector(sel);
        var ga = (typeof gradioApp === "function") ? gradioApp() : null;
        return (ga || document).querySelector(sel);
    }

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

function postSGInitToFrame(tabName) {
        var fr = state[tabName].sgFrame;
        if (!fr || !fr.contentWindow) return;
        fetch("/style_grid/styles")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var styles = Array.isArray(data)
                    ? data
                    : Object.values(data.categories || {}).flat();
                postToFrame(fr, {
                    type: "SG_INIT",
                    tab: tabName,
                    styles: styles,
                });
                state[tabName].sgV2HostInitSent = true;
            })
            .catch(function () {});
    }

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
        if (!state[tabName].sgFrame) hooks.ensureSGFramesOnce();
        var fr = state[tabName].sgFrame;
        if (!fr) {
            return;
        }
        var target = getPanelTarget(tabName);
        if (!target) return;
        if (typeof show === "undefined") show = target.style.display !== "block";
        if (!show) {
            closeSGPanel(tabName);
            return;
        }
        target.style.display = "block";
        // Shared geometry may have been changed from the other tab's panel.
        if (state[tabName].sgPanelResize) state[tabName].sgPanelResize.syncOnShow();
        setHostPageScrollLock(true);
        syncTriggerExpanded(tabName);
        hooks.syncWildcards(tabName);
        if (!state[tabName].sgV2HostInitSent) postSGInitToFrame(tabName);
        hooks.forgeTab.lastBroadcast = null;
        hooks.scheduleSyncForgeHostTabToV2Frames();
        try { fr.focus(); } catch (_err) { /* ignore */ }
    }

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
            id: "sg_trigger_" + tabName,
            title: "Open Style Grid",
            "aria-controls": "sg-panel-wrapper-" + tabName,
            "aria-expanded": "false",
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
        else if (target.parentNode) {
            target.parentNode.insertBefore(btn, target.nextSibling);
        } else {
            var toolbarHostFallback = getStyleGridToolbarHost();
            if (!toolbarHostFallback) return false;
            btn.classList.add("sg-trigger-btn--toolbar-host");
            toolbarHostFallback.appendChild(btn);
        }
        return true;
    }

export {
    qs,
    el,
    syncSelectionChrome,
    postSGInitToFrame,
    anySGFrameVisible,
    setHostPageScrollLock,
    syncTriggerExpanded,
    focusTriggerButton,
    getTopmostHostOverlay,
    getPanelTarget,
    closeSGPanel,
    tryCloseTopmostHostOverlay,
    enhanceHostOverlay,
    installHostKeyboardA11y,
    togglePanel,
    createTriggerButton,
    getStyleGridToolbarHost,
    injectButton,
};
