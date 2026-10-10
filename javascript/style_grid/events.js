/** Style Grid host — events wiring (imports + registration; handlers live under ./handlers/). */
"use strict";

import {
    injectButton,
    hooks,
    qs,
} from "./render.js";
import {
    syncSourceInput,
    applyStyleImmediate,
    stripLiveApplyFromTextareas,
    unapplyStyle,
    postClearSelectionToIframes,
    clearAll,
    rebuildPromptFromOrder,
} from "./handlers/apply.js";
import {
    normalizeWildcardKind,
    parseSgInner,
    buildSgToken,
    extractWildcardCategories,
    activeWildcardCategories,
    syncWildcards,
    removeWildcardCategory,
    reorderWildcardCategories,
} from "./handlers/wildcards.js";
import {
    loadStyles,
    loadThumbnailList,
    syncPanelHostState,
    refreshPanel,
    startPolling,
} from "./handlers/panel.js";
import {
    startBatchThumbnails,
} from "./handlers/thumbnails-batch.js";
import {
    generateThumbnail,
    pollGenerationStatus,
    uploadThumbnail,
} from "./handlers/thumbnails.js";
import {
    getForgeUiRoot,
    forgeTabPanelVisible,
    detectActiveForgeMainTab,
    postForgeHostTabToV2Frames,
    syncForgeHostTabToV2Frames,
    scheduleSyncForgeHostTabToV2Frames,
    installForgeMainTabSyncForV2,
} from "./handlers/forge-tabs.js";
import {
    initSGFrame,
    ensureSGFramesOnce,
} from "./handlers/iframe.js";

function init() {
        let observer = null;

        function stopObserver() {
            if (observer) { observer.disconnect(); observer = null; }
        }

        function tryInject() {
            const t1 = !!qs("#sg_trigger_txt2img") || injectButton("txt2img");
            const t2 = !!qs("#sg_trigger_img2img") || injectButton("img2img");
            if (t1 && t2) {
                stopObserver(); // ← kill observer once both buttons are alive
                startPolling();
                return true;
            }
            return false;
        }

        function startObserver() {
            if (observer) return; // already watching
            observer = new MutationObserver(function() {
                // Only act if our buttons actually vanished
                if (!qs("#sg_trigger_txt2img") || !qs("#sg_trigger_img2img")) {
                    clearTimeout(observer._timer);
                    observer._timer = setTimeout(tryInject, 400);
                }
            });
            const root = qs("#gradio-app") || qs(".gradio-container") || document.body;
            if (!root) return;
            observer.observe(root, { childList: true, subtree: true });
        }

        // Progressive delays for initial inject
        [800, 1500, 3000, 6000].forEach(function(d) {
            setTimeout(function() {
                if (!qs("#sg_trigger_txt2img") || !qs("#sg_trigger_img2img")) tryInject();
            }, d);
        });

        // Observer as safety net, not primary mechanism
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function() {
                setTimeout(startObserver, 500);
            });
        } else {
            setTimeout(startObserver, 500);
        }
    }

// Bind late hooks for render module
hooks.refreshPanel = refreshPanel;
hooks.ensureSGFramesOnce = ensureSGFramesOnce;
hooks.syncWildcards = syncWildcards;
hooks.scheduleSyncForgeHostTabToV2Frames = scheduleSyncForgeHostTabToV2Frames;

export {
    syncSourceInput,
    loadStyles,
    loadThumbnailList,
    normalizeWildcardKind,
    parseSgInner,
    buildSgToken,
    extractWildcardCategories,
    activeWildcardCategories,
    syncWildcards,
    removeWildcardCategory,
    reorderWildcardCategories,
    applyStyleImmediate,
    stripLiveApplyFromTextareas,
    unapplyStyle,
    postClearSelectionToIframes,
    startBatchThumbnails,
    generateThumbnail,
    pollGenerationStatus,
    uploadThumbnail,
    syncPanelHostState,
    refreshPanel,
    startPolling,
    clearAll,
    rebuildPromptFromOrder,
    getForgeUiRoot,
    forgeTabPanelVisible,
    detectActiveForgeMainTab,
    postForgeHostTabToV2Frames,
    syncForgeHostTabToV2Frames,
    scheduleSyncForgeHostTabToV2Frames,
    installForgeMainTabSyncForV2,
    initSGFrame,
    ensureSGFramesOnce,
    init,
};
