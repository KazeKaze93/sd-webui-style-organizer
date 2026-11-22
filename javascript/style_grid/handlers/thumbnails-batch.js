/**
 * Style Grid host — batch thumbnail generation (from events.js).
 * The loop is handlers/batch-runner.js; this file wires it to the host: API,
 * per-tab frames, the host thumbnail cache and toasts. Progress, Skip and
 * Cancel live in the panel (SG_BATCH_PROGRESS / SG_BATCH_SKIP / SG_BATCH_CANCEL).
 */
"use strict";

import {
    apiGet,
    apiPost,
    thumbIdentityKey,
} from "../api.js";
import {
    state,
    _thumbVersions,
    _saveThumbVersions,
} from "../state.js";
import {
    loadThumbnailList,
} from "./panel.js";
import { postToFrame } from "../post-message.js";
import { createBatchRunner } from "./batch-runner.js";

function postToTab(tab, msg) {
        var fr = state[tab] && state[tab].sgFrame;
        if (fr && fr.contentWindow) postToFrame(fr, msg);
    }

var _batchRunner = createBatchRunner({
    apiPost: apiPost,
    apiGet: apiGet,
    post: function (tab, msg) {
        // Kept for a reloaded panel (SG_READY re-post, preview-progress.js).
        if (msg.type === "SG_BATCH_PROGRESS" && state[tab]) state[tab].sgBatchLast = msg;
        postToTab(tab, msg);
    },
    toast: function (tab, message, variant) {
        postToTab(tab, { type: "SG_TOAST", message: message, variant: variant });
    },
    hasThumbnail: function (tab, name, source) {
        return state[tab].hasThumbnail.has(thumbIdentityKey(name, source));
    },
    onItemDone: function (tab, name, source) {
        var key = thumbIdentityKey(name, source);
        state[tab].hasThumbnail.add(key);
        _thumbVersions[key] = Date.now();
        localStorage.setItem("sg_thumb_v_" + key, _thumbVersions[key].toString());
        _saveThumbVersions();
        // Same message as a single upload: the panel shows the new preview now.
        postToTab(tab, {
            type: "SG_THUMB_DONE",
            styleId: name,
            version: _thumbVersions[key],
            source_file: source,
        });
    },
    onFinish: function (tab) {
        loadThumbnailList(tab);
    },
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
});

/**
 * @param {string} tabName
 * @param {string} catName
 * @param {Array<Object>} styles the category's styles for the active source
 * @param {string} [source] source the panel asked for (echoed in SG_BATCH_PROGRESS)
 */
function startBatchThumbnails(tabName, catName, styles, source) {
        return _batchRunner.start(tabName, catName, source || "", styles);
    }

function cancelBatchThumbnails(tabName) {
        return _batchRunner.cancel(tabName);
    }

function skipBatchThumbnails(tabName) {
        return _batchRunner.skip(tabName);
    }

export {
    cancelBatchThumbnails,
    skipBatchThumbnails,
    startBatchThumbnails,
};
