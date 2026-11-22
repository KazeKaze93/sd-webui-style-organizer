/**
 * Style Grid host — progress messages for single preview generation, and the
 * re-post of in-flight preview state to a reloaded panel.
 *
 * Kept free of DOM and Gradio imports (all I/O is injected) so it can be
 * unit-tested; iframe-messages.js wires the real dependencies.
 */
"use strict";

var SINGLE_DONE_DELAY_MS = 300;

/** Key for a tab's in-flight single jobs: style name + CSV source. */
function previewJobKey(styleId, sourceFile) {
    return String(styleId) + "::" + String(sourceFile || "");
}

/**
 * The onProgress callback for generateThumbnail (thumbnails.js). It posts
 * SG_THUMB_PROGRESS {status, styleId, source_file} once per status:
 * 'generating' (first poll only), then 'done' or 'error'. After 'done' it
 * posts SG_THUMB_DONE so the panel loads the new image.
 *
 * @param {Object<string, *>} jobs the tab's in-flight single jobs (state[tab].sgPreviewJobs)
 * @param {{
 *   post: function(Object<string, *>): void,
 *   setTimeout: function(function(): void, number): *,
 *   now: function(): number,
 * }} deps
 * @returns {function(string): void}
 */
function createSinglePreviewReporter(styleId, sourceFile, jobs, deps) {
    var source = sourceFile || "";
    var key = previewJobKey(styleId, source);
    var last = null;

    return function (status) {
        if (status !== "generating" && status !== "done" && status !== "error") return;
        if (status === last) return;
        if (last === "done" || last === "error") return;
        last = status;
        if (status === "generating") {
            jobs[key] = { styleId: styleId, source_file: source };
        } else {
            delete jobs[key];
        }
        deps.post({
            type: "SG_THUMB_PROGRESS",
            status: status,
            styleId: styleId,
            source_file: source,
        });
        if (status === "done") {
            deps.setTimeout(function () {
                deps.post({
                    type: "SG_THUMB_DONE",
                    styleId: styleId,
                    version: deps.now(),
                    source_file: source,
                });
            }, SINGLE_DONE_DELAY_MS);
        }
    };
}

/**
 * A (re)loaded panel announced SG_READY: post what is still in flight for its
 * tab, so it shows the running batch and the tiles still generating.
 * A finished or cancelled batch is not re-posted: its 3 s result would replay.
 *
 * @param {{sgBatchLast: Object<string, *>|null, sgPreviewJobs: Object<string, *>}} tabState
 * @param {function(Object<string, *>): void} post
 */
function repostPreviewState(tabState, post) {
    if (!tabState) return;
    var batch = tabState.sgBatchLast;
    if (batch && batch.status === "running") post(batch);
    var jobs = tabState.sgPreviewJobs || {};
    Object.keys(jobs).forEach(function (key) {
        post({
            type: "SG_THUMB_PROGRESS",
            status: "generating",
            styleId: jobs[key].styleId,
            source_file: jobs[key].source_file,
        });
    });
}

export {
    SINGLE_DONE_DELAY_MS,
    createSinglePreviewReporter,
    previewJobKey,
    repostPreviewState,
};
