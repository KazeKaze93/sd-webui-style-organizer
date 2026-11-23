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

/**
 * The Refresh button and SG_STYLE_RENAMED for one tab: check_update, then one
 * catalog request shared by refreshPanel (host state) and the iframe's
 * SG_STYLES_UPDATE. They used to make a request each. A failed check_update
 * does not stop the catalog request: GET /style_grid/styles re-checks the
 * files itself.
 *
 * @param {string} tab
 * @param {object|undefined} opts refreshPanel options (quietVanishedToast)
 * @param {{
 *   get: function(string): Promise<*>,
 *   refresh: function(string, object): void,
 *   update: function(string, *): void,
 *   onUpdateError?: function(*): void,
 * }} deps get: e.g. api.js apiGet; onUpdateError is for tests only, as in
 *   onCatalogChanged
 * @returns {Promise<*>} the catalog request
 */
function refreshTabCatalog(tab, opts, deps) {
    var getStyles = function () {
        return deps.get("/style_grid/styles");
    };
    var request = deps.get("/style_grid/check_update").then(getStyles, getStyles);
    var refreshOpts = {};
    Object.keys(opts || {}).forEach(function (key) {
        refreshOpts[key] = opts[key];
    });
    refreshOpts.stylesRequest = request;
    deps.refresh(tab, refreshOpts);
    request.then(function (data) {
        deps.update(tab, data);
    }, deps.onUpdateError);
    return request;
}

export {
    createSharedStylesFetch,
    onCatalogChanged,
    refreshTabCatalog,
};
