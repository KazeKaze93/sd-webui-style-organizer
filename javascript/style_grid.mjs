/**
 * Style Grid - Visual grid/gallery style selector for Forge WebUI
 * v2.0 — Full-featured: dynamic apply, presets,
 * conflict detection, context menu, inline editor, etc.
 * v2.0.1 — thumb cache (localStorage), popup 253x184, no remove-preview in menu
 */
/**
 * Style Grid host entry (ES module). Forge loads javascript/*.mjs as type=module.
 */
import { state } from "./style_grid/state.js";
import {
    anySGFrameVisible,
    setHostPageScrollLock,
} from "./style_grid/render.js";
import {
    init,
    initSGFrame,
    ensureSGFramesOnce,
    installForgeMainTabSyncForV2,
    applyStyleImmediate,
    unapplyStyle,
} from "./style_grid/events.js";

"use strict";

// Keyboard (Escape closes open panel) — moved from style_grid.js body tail
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
        ["txt2img", "img2img"].forEach(function (t) {
            var frEsc = state[t].sgFrame;
            var wrEsc = state[t].sgFrameWrapper || (frEsc && frEsc.parentElement && frEsc.parentElement.id === "sg-panel-wrapper-" + t ? frEsc.parentElement : null);
            var targetEsc = wrEsc || frEsc;
            if (targetEsc && targetEsc.style.display === "block") {
                targetEsc.style.display = "none";
                setHostPageScrollLock(anySGFrameVisible());
                e.preventDefault();
                return;
            }
        });
    }
});

init();

if (typeof onUiLoaded === "function") {
    onUiLoaded(function () {
        state.txt2img.sgFrame = state.txt2img.sgFrame || initSGFrame("txt2img");
        state.img2img.sgFrame = state.img2img.sgFrame || initSGFrame("img2img");
        installForgeMainTabSyncForV2();
    });
} else if (document.body) {
    ensureSGFramesOnce();
} else {
    document.addEventListener("DOMContentLoaded", ensureSGFramesOnce);
}

// Host apply/unapply entry points used by the iframe message bridge
window._sgApplyStyle = applyStyleImmediate;
window._sgUnapplyStyle = unapplyStyle;
