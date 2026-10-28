/**
 * Style Grid host entry. WebUI busts this file by mtime only; the module graph is
 * loaded from /style_grid/host/ (Cache-Control: no-cache) so an update never runs
 * cached or mixed submodules. Falls back to the relative graph if the route is missing.
 */
const SG_HOST_MAIN = "/style_grid/host/main.js";
import(SG_HOST_MAIN).catch(function (err) {
    console.warn("[Style Grid] host module route unavailable, using cached modules:", err);
    return import("./style_grid/main.js");
});
