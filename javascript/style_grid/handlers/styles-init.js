/**
 * Style Grid host — one SG_INIT per iframe document load.
 *
 * Each iframe document announces itself with SG_READY (primary path) and also
 * fires the iframe `load` event, in either order. `load` is only a fallback:
 * if no SG_READY arrives from that document within FALLBACK_DELAY_MS (a stale
 * bundle that predates SG_READY, or a lost message), the host sends SG_INIT
 * anyway. A fetch already in flight for the frame is never started twice.
 *
 * Kept free of DOM and Gradio imports so the gating can be unit-tested.
 */
"use strict";

var FALLBACK_DELAY_MS = 500;

/**
 * Per-frame gate, stored on state[tab]. Counters, not booleans: SG_READY and
 * `load` for the same document can come in either order, and a reloaded
 * iframe starts a new document that needs its own SG_INIT.
 *
 * @param {{
 *   send: function(): Promise<void>,
 *   setTimeout?: function(function(): void, number): *,
 *   clearTimeout?: function(*): void,
 * }} deps send fetches /style_grid/styles and posts SG_INIT; it resolves or
 *   rejects when that is done
 */
function createStylesInitGate(deps) {
    var setTimer = deps.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimer = deps.clearTimeout || function (id) { clearTimeout(id); };
    var readyCount = 0;
    var loadCount = 0;
    var servedCount = 0;
    var inFlight = false;
    var fallbackTimer = null;

    function cancelFallback() {
        if (fallbackTimer !== null) {
            clearTimer(fallbackTimer);
            fallbackTimer = null;
        }
    }

    function serve(upTo) {
        if (inFlight || servedCount >= upTo) return;
        servedCount = upTo;
        inFlight = true;
        var done = function () { inFlight = false; };
        var p;
        try {
            p = deps.send();
        } catch (_err) {
            done();
            return;
        }
        if (p && typeof p.then === "function") {
            p.then(done, done);
        } else {
            done();
        }
    }

    return {
        /** SG_READY from the iframe: send now, drop any pending fallback. */
        onReady: function () {
            readyCount += 1;
            cancelFallback();
            serve(Math.max(readyCount, loadCount));
        },
        /** Iframe `load`: arm the fallback unless this document was served. */
        onLoad: function () {
            loadCount += 1;
            if (servedCount >= loadCount) return;
            cancelFallback();
            fallbackTimer = setTimer(function () {
                fallbackTimer = null;
                if (readyCount >= loadCount) return;
                serve(loadCount);
            }, FALLBACK_DELAY_MS);
        },
        /** True while a /style_grid/styles fetch for this frame is running. */
        isInFlight: function () {
            return inFlight;
        },
    };
}

export {
    FALLBACK_DELAY_MS,
    createStylesInitGate,
};
