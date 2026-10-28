/**
 * Style Grid - Visual grid/gallery style selector for Forge WebUI
 * v2.0 — Full-featured: dynamic apply, presets,
 * conflict detection, context menu, inline editor, etc.
 * v2.0.1 — thumb cache (localStorage), popup 253x184, no remove-preview in menu
 */
/**
 * Style Grid host main module (loaded via /style_grid/host/ or relative fallback).
 */
import { state } from "./state.js";
import {
    setHostPageScrollLock,
    installHostKeyboardA11y,
    syncTriggerExpanded,
    focusTriggerButton,
    getTopmostHostOverlay,
    getPanelTarget,
} from "./render.js";
import {
    init,
    initSGFrame,
    ensureSGFramesOnce,
    installForgeMainTabSyncForV2,
    applyStyleImmediate,
    unapplyStyle,
} from "./events.js";
import {
    bridgeOrigin,
    parseFrameMessage,
} from "./post-message.js";
import "./prompt-utils-bridge.js";

"use strict";

// Host-document Escape: overlays first, then panel (see installHostKeyboardA11y).
// Escape inside the iframe is handled by App → SG_CLOSE_REQUEST (not this listener).
installHostKeyboardA11y();

// After App posts SG_CLOSE_REQUEST, iframe-messages hides the wrapper but does not
// sync aria-expanded or restore focus. Defer so that hide runs first, then fix up.
// If a host overlay is open, undo the panel hide (Escape must dismiss overlay first).
window.addEventListener("message", function (e) {
    if (e.origin !== bridgeOrigin()) return;
    var closeMsg = parseFrameMessage(e.data);
    if (!closeMsg || closeMsg.type !== "SG_CLOSE_REQUEST") return;
    var src = e.source;
    setTimeout(function () {
        ["txt2img", "img2img"].forEach(function (t) {
            var fr = state[t] && state[t].sgFrame;
            if (!fr || src !== fr.contentWindow) return;
            var target = getPanelTarget(t);
            if (getTopmostHostOverlay()) {
                if (target && target.style.display === "none") {
                    target.style.display = "block";
                    setHostPageScrollLock(true);
                }
                syncTriggerExpanded(t);
                return;
            }
            syncTriggerExpanded(t);
            focusTriggerButton(t);
        });
    }, 0);
});

init();

function bootFrames() {
    state.txt2img.sgFrame = state.txt2img.sgFrame || initSGFrame("txt2img");
    state.img2img.sgFrame = state.img2img.sgFrame || initSGFrame("img2img");
    installForgeMainTabSyncForV2();
}

if (typeof gradioApp === "function" && gradioApp().querySelector("#txt2img_prompt")) {
    bootFrames();
} else if (typeof onUiLoaded === "function") {
    onUiLoaded(bootFrames);
} else if (document.body) {
    ensureSGFramesOnce();
} else {
    document.addEventListener("DOMContentLoaded", ensureSGFramesOnce);
}

// Host apply/unapply entry points used by the iframe message bridge
window._sgApplyStyle = applyStyleImmediate;
window._sgUnapplyStyle = unapplyStyle;
