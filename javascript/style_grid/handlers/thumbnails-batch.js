/** Style Grid host — batch thumbnail generation (from events.js). */
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
    el,
} from "../render.js";
import {
    loadThumbnailList,
} from "./panel.js";

var _batchState = { running: false, cancelled: false, skipped: false, jobId: null };

function startBatchThumbnails(tabName, catName, styles) {
       if (_batchState.running) {
           var frBusy = state[tabName] && state[tabName].sgFrame;
           if (frBusy && frBusy.contentWindow) {
               frBusy.contentWindow.postMessage({
                   type: "SG_TOAST",
                   message: "Batch generation already running",
                   variant: "error"
               }, "*");
           }
           return;
       }

       var queue = styles.filter(function (s) {
           return !state[tabName].hasThumbnail.has(thumbIdentityKey(s.name, s.source_file));
       });
       if (queue.length === 0) {
           var frEmpty = state[tabName] && state[tabName].sgFrame;
           if (frEmpty && frEmpty.contentWindow) {
               frEmpty.contentWindow.postMessage({
                   type: "SG_TOAST",
                   message: "All styles already have previews",
                   variant: "info"
               }, "*");
           }
           return;
       }

       _batchState = { running: true, cancelled: false, skipped: false, jobId: null };
       var total = queue.length;
       var done = 0;
       var failed = 0;
       var skipped = 0;

       // Build modal
       var overlay = el("div", { className: "sg-editor-overlay sg-batch-overlay" });
       var modal = el("div", { className: "sg-editor-modal" });
       var titleEl = el("h3", {
           className: "sg-editor-title",
           textContent: "🎨 Generating previews — " + catName
       });
       var progressText = el("div", {
           className: "sg-batch-progress-text",
           textContent: "Starting..."
       });
       var progressBar = el("div", { className: "sg-batch-bar-wrap" });
       var progressFill = el("div", { className: "sg-batch-bar-fill" });
       progressBar.appendChild(progressFill);

       function cancelCurrentJobThen(next) {
           var jobId = _batchState.jobId;
           _batchState.jobId = null;
           if (!jobId) {
               next();
               return;
           }
           var settled = false;
           function finish() {
               if (settled) return;
               settled = true;
               next();
           }
           apiPost("/style_grid/thumbnail/cancel", { job_id: jobId })
               .then(finish)
               .catch(finish);
           setTimeout(finish, 2000);
       }

       var btnRow = el("div", { className: "sg-editor-btns" });
       var skipBtn = el("button", {
           className: "sg-btn sg-btn-secondary",
           textContent: "⏭ Skip",
           onClick: function () {
               _batchState.skipped = true;
               cancelCurrentJobThen(function () {});
           }
       });
       var cancelBtn = el("button", {
           className: "sg-btn",
           style: "background:#dc2626; border-color:#dc2626; color:#fff;",
           textContent: "✕ Cancel",
           onClick: function () {
               _batchState.cancelled = true;
               cancelBtn.textContent = "Cancelling...";
               cancelBtn.disabled = true;
               cancelCurrentJobThen(function () {});
           }
       });
       btnRow.appendChild(skipBtn);
       btnRow.appendChild(cancelBtn);

       modal.appendChild(titleEl);
       modal.appendChild(progressText);
       modal.appendChild(progressBar);
       modal.appendChild(btnRow);
       overlay.appendChild(modal);
       // Do NOT close on overlay click — only Cancel
       document.body.appendChild(overlay);

       function updateProgress(current, styleName, status) {
           var pct = Math.round((current / total) * 100);
           progressFill.style.width = pct + "%";
           progressText.textContent = current + " / " + total +
               (styleName ? " — " + styleName.split("_").slice(1).join(" ") : "") +
               (status ? " (" + status + ")" : "");
       }

       function processNext(index) {
           if (_batchState.cancelled || index >= queue.length) {
               // Finished
               _batchState.running = false;
               _batchState.jobId = null;
               overlay.remove();
               var msg = "Done: " + done + "/" + total + " generated";
               if (failed > 0) msg += ", " + failed + " failed";
               if (skipped > 0) msg += ", " + skipped + " skipped";
               var frDone = state[tabName] && state[tabName].sgFrame;
               if (frDone && frDone.contentWindow) {
                   frDone.contentWindow.postMessage({
                       type: "SG_TOAST",
                       message: msg,
                       variant: "info"
                   }, "*");
               }
               loadThumbnailList(tabName);
               return;
           }

           var styleName = queue[index].name;
           var styleSourceFile = queue[index].source_file || "";
           _batchState.skipped = false;
           updateProgress(index + 1, styleName, "generating...");

           apiPost("/style_grid/thumbnail/generate", { name: styleName, source: styleSourceFile })
               .then(function (r) {
                   if (r.error || !r.job_id) {
                       failed++;
                       processNext(index + 1);
                       return;
                   }
                   _batchState.jobId = r.job_id;
                   pollBatchStatus(tabName, styleName, styleSourceFile, index, 0, r.job_id);
               })
               .catch(function () {
                   failed++;
                   processNext(index + 1);
               });
       }

       function pollBatchStatus(tabName2, styleName, styleSourceFile, index, attempts, jobId) {
           if (_batchState.cancelled) {
               cancelCurrentJobThen(function () {
                   _batchState.running = false;
                   overlay.remove();
                   var cancelMsg = "Cancelled. " + done + "/" + total + " completed.";
                   var frCancel = state[tabName2] && state[tabName2].sgFrame;
                   if (frCancel && frCancel.contentWindow) {
                       frCancel.contentWindow.postMessage({
                           type: "SG_TOAST",
                           message: cancelMsg,
                           variant: "info"
                       }, "*");
                   }
                   loadThumbnailList(tabName2);
               });
               return;
           }
           if (_batchState.skipped) {
               cancelCurrentJobThen(function () {
                   skipped++;
                   processNext(index + 1);
               });
               return;
           }
           if (attempts > 60) {
               _batchState.jobId = null;
               failed++;
               processNext(index + 1);
               return;
           }

           apiGet("/style_grid/thumbnail/gen_status?job_id=" +
               encodeURIComponent(jobId))
               .then(function (r) {
                   if (!r || r.detail === "Not Found" || r.status === undefined) {
                       _batchState.jobId = null;
                       failed++;
                       processNext(index + 1);
                       return;
                   }
                   if (r.status === "done") {
                       _batchState.jobId = null;
                       done++;
                       state[tabName2].hasThumbnail.add(thumbIdentityKey(styleName, styleSourceFile));
                       var batchThumbKey = thumbIdentityKey(styleName, styleSourceFile);
                       _thumbVersions[batchThumbKey] = Date.now();
                       localStorage.setItem("sg_thumb_v_" + batchThumbKey, _thumbVersions[batchThumbKey].toString());
                       _saveThumbVersions();
                       updateProgress(index + 1, styleName, "✓");
                       setTimeout(function () { processNext(index + 1); }, 300);
                   } else if (r.status === "error" || r.status === "cancelled") {
                       _batchState.jobId = null;
                       if (r.status === "cancelled") {
                           skipped++;
                       } else {
                           failed++;
                       }
                       processNext(index + 1);
                   } else if (r.status === "queued" || r.status === "running") {
                       setTimeout(function () {
                           pollBatchStatus(tabName2, styleName, styleSourceFile, index, attempts + 1, jobId);
                       }, 2000);
                   } else {
                       _batchState.jobId = null;
                       failed++;
                       processNext(index + 1);
                   }
               })
               .catch(function () {
                   _batchState.jobId = null;
                   failed++;
                   processNext(index + 1);
               });
       }

       processNext(0);
   }

export {
    startBatchThumbnails,
};
