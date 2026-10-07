/** Style Grid host — iframe lifecycle (from events.js). */
"use strict";

import {
    state,
    pushStyleIntoCategories,
} from "../state.js";
import {
    anySGFrameVisible,
    setHostPageScrollLock,
} from "../render.js";
import {
    installForgeMainTabSyncForV2,
} from "./forge-tabs.js";
import {
    installIframeMessageBridge,
} from "./iframe-messages.js";

function initSGFrame(tab) {
        var existing = document.getElementById("sg-frame-" + tab);
        if (existing) {
            return existing;
        }
        const frame = document.createElement("iframe");
        frame.id = "sg-frame-" + tab;
        // Query string busts stale index.html / iframe document cache after ui/dist updates (bump when shipping UI changes).
        frame.src = `/style_grid/ui?t=${Date.now()}`;
        var wrapper = document.createElement("div");
        wrapper.id = "sg-panel-wrapper-" + tab;
        wrapper.style.cssText = [
            "position:fixed",
            "top:80px",
            "right:16px",
            "left:auto",
            "width:1000px",
            "height:650px",
            "min-width:600px",
            "min-height:400px",
            "max-width:95vw",
            "max-height:90vh",
            "border:none",
            "border-radius:12px",
            "box-shadow:0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
            "z-index:10000",
            "display:none",
            "overflow:hidden",
            "resize:both",
        ].join(";");
        frame.style.cssText = "width:100%;height:100%;border:none;display:block;";
        document.body.appendChild(wrapper);
        wrapper.appendChild(frame);
        state[tab].sgFrameWrapper = wrapper;
        document.addEventListener("mousedown", function (e) {
            if (wrapper.style.display !== "block") return;
            var target = e.target;
            if (!target) return;
            if (target.closest && target.closest(".sg-trigger-btn")) return;
            if (target.closest && target.closest(".sg-editor-overlay, .sg-source-picker")) return;
            if (!wrapper.contains(target)) {
                wrapper.style.display = "none";
                setHostPageScrollLock(anySGFrameVisible());
            }
        }, true);
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && wrapper.style.display !== "none") {
                e.stopPropagation();
                wrapper.style.display = "none";
                setHostPageScrollLock(anySGFrameVisible());
            }
        }, true);

        frame.addEventListener("load", function () {
            setTimeout(function () {
                fetch("/style_grid/styles")
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var allStyles = Array.isArray(data) ? data : Object.values(data.categories || {}).flat();
                        if (!state[tab]) state[tab] = {};
                        if (!state[tab].categories) state[tab].categories = {};
                        allStyles.forEach(function (s) {
                            pushStyleIntoCategories(state[tab].categories, s);
                        });
                        if (frame.contentWindow) {
                            frame.contentWindow.postMessage({
                                type: "SG_INIT",
                                tab: tab,
                                styles: allStyles,
                            }, "*");
                        }
                    });
            }, 500);
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
