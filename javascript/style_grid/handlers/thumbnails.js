/** Style Grid host — single thumbnail generate / upload (from events.js). */
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

function generateThumbnail(tabName, styleName, onDone, onProgress, sourceFile) {
        var resolvedSource = sourceFile || state[tabName].selectedSourceFile || "";
        if (typeof onProgress === "function") {
            onProgress("generating", 0);
        }

        apiPost("/style_grid/thumbnail/generate", { name: styleName, source: resolvedSource })
            .then(function (r) {
                if (r.error || !r.job_id) {
                    var failStartMsg = "Generation failed: " + (r.error || "missing job_id");
                    var frFailStart = state[tabName] && state[tabName].sgFrame;
                    if (frFailStart && frFailStart.contentWindow) {
                        frFailStart.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: failStartMsg,
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                pollGenerationStatus(tabName, styleName, 0, onDone, onProgress, resolvedSource, r.job_id);
            })
            .catch(function () {
                var frFailCatch = state[tabName] && state[tabName].sgFrame;
                if (frFailCatch && frFailCatch.contentWindow) {
                    frFailCatch.contentWindow.postMessage({
                        type: "SG_TOAST",
                        message: "Generation failed",
                        variant: "error"
                    }, "*");
                }
                if (typeof onProgress === "function") {
                    onProgress("error");
                }
            });
    }

function pollGenerationStatus(tabName, styleName, attempts, onDone, onProgress, sourceFile, jobId) {
        if (attempts > 60) {
            var frTimeout = state[tabName] && state[tabName].sgFrame;
            if (frTimeout && frTimeout.contentWindow) {
                frTimeout.contentWindow.postMessage({
                    type: "SG_TOAST",
                    message: "Generation timed out",
                    variant: "error"
                }, "*");
            }
            if (typeof onProgress === "function") {
                onProgress("error");
            }
            return;
        }
        apiGet("/style_grid/thumbnail/gen_status?job_id=" +
            encodeURIComponent(jobId))
            .then(function (r) {
                if (!r || r.detail === "Not Found" || r.status === undefined) {
                    var frNotFound = state[tabName] && state[tabName].sgFrame;
                    if (frNotFound && frNotFound.contentWindow) {
                        frNotFound.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: "Generation endpoint not found",
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                    return;
                }
                if (r.status === "done") {
                    var doneThumbKey = thumbIdentityKey(styleName, sourceFile);
                    state[tabName].hasThumbnail.add(doneThumbKey);
                    _thumbVersions[doneThumbKey] = Date.now();
                    localStorage.setItem("sg_thumb_v_" + doneThumbKey, _thumbVersions[doneThumbKey].toString());
                    _saveThumbVersions();
                    if (typeof onProgress === "function") {
                        onProgress("done", 100);
                    }
                    if (typeof onDone === "function") onDone(_thumbVersions[doneThumbKey]);
                } else if (r.status === "error" || r.status === "cancelled") {
                    var failPollMsg = r.status === "cancelled"
                        ? "Generation cancelled"
                        : ("Generation failed: " + (r.message || "unknown"));
                    var frFailPoll = state[tabName] && state[tabName].sgFrame;
                    if (frFailPoll && frFailPoll.contentWindow) {
                        frFailPoll.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: failPollMsg,
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                } else if (r.status === "queued" || r.status === "running") {
                    if (typeof onProgress === "function") {
                        onProgress("generating", Math.min(90, Math.round((attempts / 60) * 100)));
                    }
                    setTimeout(function () {
                        pollGenerationStatus(tabName, styleName, attempts + 1, onDone, onProgress, sourceFile, jobId);
                    }, 2000);
                } else {
                    var unknownMsg = "Unknown generation status: " + r.status;
                    var frUnknown = state[tabName] && state[tabName].sgFrame;
                    if (frUnknown && frUnknown.contentWindow) {
                        frUnknown.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: unknownMsg,
                            variant: "error"
                        }, "*");
                    }
                    if (typeof onProgress === "function") {
                        onProgress("error");
                    }
                }
            })
            .catch(function () {
                var frUnavailable = state[tabName] && state[tabName].sgFrame;
                if (frUnavailable && frUnavailable.contentWindow) {
                    frUnavailable.contentWindow.postMessage({
                        type: "SG_TOAST",
                        message: "Generation status unavailable",
                        variant: "error"
                    }, "*");
                }
                if (typeof onProgress === "function") {
                    onProgress("error");
                }
            });
    }

function uploadThumbnail(tabName, styleName, sourceFile) {
        var resolvedSource = sourceFile || state[tabName].selectedSourceFile || "";
        var input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", function () {
            var file = input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                apiPost("/style_grid/thumbnail/upload", {
                    name: styleName,
                    image: reader.result,
                    source: resolvedSource
                })
                    .then(function (r) {
                        if (r.ok) {
                            var uploadThumbKey = thumbIdentityKey(styleName, resolvedSource);
                            state[tabName].hasThumbnail.add(uploadThumbKey);
                            _thumbVersions[uploadThumbKey] = Date.now();
                            localStorage.setItem("sg_thumb_v_" + uploadThumbKey, _thumbVersions[uploadThumbKey].toString());
                            _saveThumbVersions();
                            var fr = state[tabName] && state[tabName].sgFrame;
                            if (fr && fr.contentWindow) {
                                fr.contentWindow.postMessage({
                                    type: "SG_THUMB_DONE",
                                    styleId: styleName,
                                    version: _thumbVersions[uploadThumbKey],
                                    source_file: resolvedSource,
                                }, "*");
                            }
                        } else {
                            var failMsg = "Upload failed: " + (r.error || "?");
                            var frFail = state[tabName] && state[tabName].sgFrame;
                            if (frFail && frFail.contentWindow) {
                                frFail.contentWindow.postMessage({
                                    type: "SG_TOAST",
                                    message: failMsg,
                                    variant: "error"
                                }, "*");
                            }
                        }
                    })
                    .catch(function () {
                        var frCatch = state[tabName] && state[tabName].sgFrame;
                        if (frCatch && frCatch.contentWindow) {
                            frCatch.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: "Upload failed",
                                variant: "error"
                            }, "*");
                        }
                    });
            };
            reader.readAsDataURL(file);
        });
        input.click();
    }

export {
    generateThumbnail,
    pollGenerationStatus,
    uploadThumbnail,
};
