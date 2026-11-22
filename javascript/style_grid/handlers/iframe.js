/** Style Grid host — iframe lifecycle (from events.js). */
"use strict";

import {
    state,
} from "../state.js";
import {
    closeSGPanel,
} from "../render.js";
import {
    installForgeMainTabSyncForV2,
} from "./forge-tabs.js";
import {
    installIframeMessageBridge,
    sendStylesInit,
} from "./iframe-messages.js";
import {
    createStylesInitGate,
} from "./styles-init.js";
import {
    buildThemeMessage,
    detectHostThemeMode,
    watchHostThemeMode,
} from "../theme.js";
import { postToFrame } from "../post-message.js";
import { installPanelResize } from "./panel-resize.js";

const THEME_DARK_FALLBACK = "dark";

function initSGFrame(tab) {
        var existing = document.getElementById("sg-frame-" + tab);
        if (existing) {
            return existing;
        }
        const frame = document.createElement("iframe");
        frame.id = "sg-frame-" + tab;
        frame.title = "Style Grid";
        // Query string busts stale index.html / iframe document cache after ui/dist updates (bump when shipping UI changes).
        var initialTheme = THEME_DARK_FALLBACK;
        try {
            initialTheme = detectHostThemeMode();
            watchHostThemeMode(function (mode) {
                if (frame.contentWindow) {
                    postToFrame(frame, buildThemeMessage(mode));
                }
            });
        } catch (err) {
            console.error("[Style Grid] theme init failed", err);
            initialTheme = THEME_DARK_FALLBACK;
        }
        frame.src = "/style_grid/ui?t=" + Date.now() + "&theme=" + initialTheme;
        var wrapper = document.createElement("div");
        wrapper.id = "sg-panel-wrapper-" + tab;
        // Position and size (left/top/width/height) come from installPanelResize:
        // stored geometry, fitted to the viewport. No native CSS resize, no right anchor.
        // overflow stays visible: the resize handles sit just outside the frame edge,
        // so they never cover the iframe's own scrollbars; the iframe clips itself
        // to the wrapper's radius instead.
        wrapper.style.cssText = [
            "position:fixed",
            "border:none",
            "z-index:10000",
            "display:none",
            "overflow:visible",
        ].join(";");
        frame.style.cssText = "width:100%;height:100%;border:none;display:block;border-radius:inherit;";
        if (!document.body) return frame;
        document.body.appendChild(wrapper);
        wrapper.appendChild(frame);
        state[tab].sgFrameWrapper = wrapper;
        state[tab].sgPanelResize = installPanelResize(wrapper, frame);
        document.addEventListener("mousedown", function (e) {
            if (wrapper.style.display !== "block") return;
            var target = e.target;
            if (!target) return;
            if (target.closest && target.closest(".sg-trigger-btn")) return;
            // The batch-preview window is a host overlay over the panel.
            if (target.closest && target.closest(".sg-editor-overlay")) return;
            if (!wrapper.contains(target)) {
                closeSGPanel(tab);
            }
        }, true);
        // Escape is handled centrally by installHostKeyboardA11y (render.js):
        // host overlays first, then panel close + trigger focus + aria-expanded.

        // SG_READY (iframe-messages.js) is the primary SG_INIT trigger; `load`
        // only arms a fallback for a document that never sends SG_READY.
        state[tab].sgStylesInitGate = createStylesInitGate({
            send: function () { return sendStylesInit(tab, frame); },
        });
        frame.addEventListener("load", function () {
            state[tab].sgStylesInitGate.onLoad();
        });

        installIframeMessageBridge(tab, frame);

        return frame;
    }

function ensureSGFramesOnce() {
        if (!state.txt2img.sgFrame) state.txt2img.sgFrame = initSGFrame("txt2img");
        if (!state.img2img.sgFrame) state.img2img.sgFrame = initSGFrame("img2img");
        installForgeMainTabSyncForV2();
    }

export {
    initSGFrame,
    ensureSGFramesOnce,
};
