/**
 * Style Grid host — one GET /style_grid/styles per detected CSV change.
 *
 * The polling loop (handlers/panel.js startPolling) used to request the catalog
 * twice per tab: once for refreshPanel (host state, apply-restore) and once
 * for the iframe's SG_STYLES_UPDATE. Every request returned the same data, so a
 * change now makes one request whose result goes to every consumer of both
 * tabs. Kept free of DOM and module state so it can be unit-tested.
 */
"use strict";

/**
 * A fetcher that shares one in-flight request: callers that arrive while it
 * runs get the same promise; the next call after it settles (ok or failed)
 * starts a new request.
 *
 * @param {function(string): Promise<*>} get e.g. api.js apiGet
 * @returns {function(): Promise<*>}
 */
function createSharedStylesFetch(get) {
    var inFlight = null;
    return function fetchStyles() {
        if (inFlight) return inFlight;
        var request = get("/style_grid/styles");
        inFlight = request;
        var settle = function () {
            if (inFlight === request) inFlight = null;
        };
        request.then(settle, settle);
        return request;
    };
}

/**
 * One detected CSV change. A tab whose host handshake is done re-applies its
 * selection (refresh, which reads the shared request); every tab gets the
 * catalog update. Both read the same response.
 *
 * @param {string[]} tabs
 * @param {{
 *   fetchStyles: function(): Promise<*>,
 *   isInitSent: function(string): boolean,
 *   refresh: function(string, {stylesRequest: Promise<*>}): void,
 *   update: function(string, *): void,
 *   onUpdateError?: function(*): void,
 * }} deps onUpdateError is for tests only: in the page a failed update stays
 *   an unhandled rejection, as it was before.
 * @returns {Promise<*>} the shared request
 */
function onCatalogChanged(tabs, deps) {
    var request = deps.fetchStyles();
    tabs.forEach(function (tab) {
        if (deps.isInitSent(tab)) deps.refresh(tab, { stylesRequest: request });
        request.then(function (data) {
            deps.update(tab, data);
        }, deps.onUpdateError);
    });
    return request;
}

export {
    createSharedStylesFetch,
    onCatalogChanged,
};
