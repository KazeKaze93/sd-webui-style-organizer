/**
 * Style Grid host — category batch preview generation, as a DOM-free loop.
 *
 * The panel (iframe) shows the progress: every state change is posted as
 * SG_BATCH_PROGRESS to the frame of the tab that started the batch, and the
 * panel sends SG_BATCH_CANCEL / SG_BATCH_SKIP back. One batch at a time, for
 * both tabs together.
 *
 * Kept free of DOM and Gradio imports (all I/O is injected) so the loop can be
 * unit-tested; thumbnails-batch.js wires the real dependencies.
 */
"use strict";

var BATCH_MAX_POLLS = 60;
var BATCH_POLL_MS = 2000;
var BATCH_NEXT_DELAY_MS = 300;
var BATCH_CANCEL_WAIT_MS = 2000;

/**
 * @param {{
 *   apiPost: function(string, Object<string, *>): Promise<Object<string, *>>,
 *   apiGet: function(string): Promise<Object<string, *>>,
 *   post: function(string, Object<string, *>): void,
 *   toast: function(string, string, string): void,
 *   hasThumbnail: function(string, string, string): boolean,
 *   onItemDone: function(string, string, string): void,
 *   onFinish: function(string): void,
 *   setTimeout: function(function(): void, number): *,
 * }} deps post(tab, msg) sends to that tab's frame; onItemDone(tab, name,
 *   source) records a new preview and posts SG_THUMB_DONE; onFinish(tab)
 *   reloads the host's thumbnail list.
 */
function createBatchRunner(deps) {
    /** The running batch, or null: {tab, cancelled, skipped, jobId}. */
    var current = null;

    function cancelJobThen(run, next) {
        var jobId = run.jobId;
        run.jobId = null;
        if (!jobId) {
            next();
            return;
        }
        var settled = false;
        var finish = function () {
            if (settled) return;
            settled = true;
            next();
        };
        deps.apiPost("/style_grid/thumbnail/cancel", { job_id: jobId })
            .then(finish, finish);
        deps.setTimeout(finish, BATCH_CANCEL_WAIT_MS);
    }

    /**
     * Start a batch for `styles` (one category, already filtered by source).
     * Styles that already have a preview are not queued (alreadyHad).
     * @returns {boolean} true when a batch started
     */
    function start(tab, category, source, styles) {
        if (current) {
            deps.toast(tab, "Batch generation already running", "error");
            return false;
        }
        var queue = styles.filter(function (s) {
            return !deps.hasThumbnail(tab, s.name, s.source_file || "");
        });
        if (queue.length === 0) {
            deps.toast(tab, "All styles already have previews", "info");
            return false;
        }

        var run = { tab: tab, cancelled: false, skipped: false, jobId: null };
        current = run;
        var counts = {
            total: queue.length,
            processed: 0,
            newCount: 0,
            alreadyHad: styles.length - queue.length,
            skipped: 0,
            failed: 0,
        };

        var report = function (status) {
            deps.post(tab, {
                type: "SG_BATCH_PROGRESS",
                category: category,
                source: source || "",
                status: status,
                total: counts.total,
                processed: counts.processed,
                newCount: counts.newCount,
                alreadyHad: counts.alreadyHad,
                skipped: counts.skipped,
                failed: counts.failed,
            });
        };

        var end = function (status) {
            if (current === run) current = null;
            run.jobId = null;
            report(status);
            deps.onFinish(tab);
        };

        /** One queued style is over: count it and report. */
        var settle = function (counter) {
            counts[counter] += 1;
            counts.processed += 1;
            report("running");
        };

        var processNext = function (index) {
            // Checked first: Cancel in the pause between two styles ends the
            // batch as cancelled, not finished.
            if (run.cancelled) {
                end("cancelled");
                return;
            }
            if (index >= queue.length) {
                end("finished");
                return;
            }
            var item = queue[index];
            var styleName = item.name;
            var styleSource = item.source_file || "";
            run.skipped = false;
            deps.apiPost("/style_grid/thumbnail/generate", { name: styleName, source: styleSource })
                .then(function (r) {
                    if (!r || r.error || !r.job_id) {
                        settle("failed");
                        processNext(index + 1);
                        return;
                    }
                    run.jobId = r.job_id;
                    poll(styleName, styleSource, index, 0, r.job_id);
                }, function () {
                    settle("failed");
                    processNext(index + 1);
                });
        };

        var poll = function (styleName, styleSource, index, attempts, jobId) {
            if (run.cancelled) {
                cancelJobThen(run, function () { end("cancelled"); });
                return;
            }
            if (run.skipped) {
                cancelJobThen(run, function () {
                    settle("skipped");
                    processNext(index + 1);
                });
                return;
            }
            if (attempts > BATCH_MAX_POLLS) {
                run.jobId = null;
                settle("failed");
                processNext(index + 1);
                return;
            }
            deps.apiGet("/style_grid/thumbnail/gen_status?job_id=" + encodeURIComponent(jobId))
                .then(function (r) {
                    if (!r || r.detail === "Not Found" || r.status === undefined) {
                        run.jobId = null;
                        settle("failed");
                        processNext(index + 1);
                        return;
                    }
                    if (r.status === "done") {
                        run.jobId = null;
                        deps.onItemDone(tab, styleName, styleSource);
                        settle("newCount");
                        deps.setTimeout(function () { processNext(index + 1); }, BATCH_NEXT_DELAY_MS);
                    } else if (r.status === "cancelled") {
                        run.jobId = null;
                        // The whole batch was cancelled: processNext ends it uncounted.
                        if (run.cancelled) {
                            processNext(index + 1);
                            return;
                        }
                        settle(run.skipped ? "skipped" : "failed");
                        processNext(index + 1);
                    } else if (r.status === "error") {
                        run.jobId = null;
                        settle("failed");
                        processNext(index + 1);
                    } else if (r.status === "queued" || r.status === "running") {
                        deps.setTimeout(function () {
                            poll(styleName, styleSource, index, attempts + 1, jobId);
                        }, BATCH_POLL_MS);
                    } else {
                        run.jobId = null;
                        settle("failed");
                        processNext(index + 1);
                    }
                }, function () {
                    run.jobId = null;
                    settle("failed");
                    processNext(index + 1);
                });
        };

        report("running");
        processNext(0);
        return true;
    }

    /** SG_BATCH_CANCEL: only the tab that owns the running batch may cancel it. */
    function cancel(tab) {
        if (!current || current.tab !== tab || current.cancelled) return false;
        current.cancelled = true;
        cancelJobThen(current, function () {});
        return true;
    }

    /** SG_BATCH_SKIP: drop the style being generated, continue with the next. */
    function skip(tab) {
        if (!current || current.tab !== tab || current.cancelled) return false;
        current.skipped = true;
        cancelJobThen(current, function () {});
        return true;
    }

    return {
        start: start,
        cancel: cancel,
        skip: skip,
        isRunning: function () { return current !== null; },
    };
}

export {
    BATCH_MAX_POLLS,
    BATCH_NEXT_DELAY_MS,
    BATCH_POLL_MS,
    createBatchRunner,
};
