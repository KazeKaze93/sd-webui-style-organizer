/** Style Grid host — Forge main-tab sync for V2 frames (from events.js). */
"use strict";

import {
    state,
} from "../state.js";
import {
    hooks,
} from "../render.js";

var _sgForgeTabSyncInstalled = false;
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
        if (hooks.forgeTab.lastBroadcast === tab) return;
        hooks.forgeTab.lastBroadcast = tab;
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

export {
    getForgeUiRoot,
    forgeTabPanelVisible,
    detectActiveForgeMainTab,
    postForgeHostTabToV2Frames,
    syncForgeHostTabToV2Frames,
    scheduleSyncForgeHostTabToV2Frames,
    installForgeMainTabSyncForV2,
};
