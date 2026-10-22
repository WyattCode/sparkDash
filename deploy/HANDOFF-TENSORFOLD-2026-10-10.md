# TensorFold compatibility — 2026-10-10

## 2026-10-22 selected upstream core updates and follow-up review

Selectively adapted upstream 2.70 changes, not a full main merge. Added read-only, on-demand RoCE monitoring to node details; polling stops when collapsed. Missing counters remain unknown, failed cached samples are marked stale, long sampling gaps re-seed rate baselines, counter resets do not become false zero rates, and configuration changes invalidate in-flight reads. No network configuration commands or upstream alert thresholds are enabled.

Also fixed recovery throughput spikes and negative per-slot deltas, added controlled listener failure handling and skipped snapshot serialization without open clients. Shared overlay handling prevents text-selection drags from dismissing five dialogs. Credential writes/deletions now validate existing structure and decryptability before replacement, preserving unknown sections and refusing damaged files rather than silently losing credentials. This does not repair damaged credentials automatically.

Added Apache-2.0 license text and NOTICE for selected upstream modules; the existing MIT license and other-device branding remain unchanged. Production verification passed 466 backend and 263 frontend tests plus type checking; Chrome responsive RoCE/overlay checks and Firefox theme/page checks passed. The sanitized publication independently passed 469 backend tests, the frontend suite, type checking and build (existing bundle-size warning remains). Only the panel was reloaded; no production model inference tests, model restarts, GPU, network or control-center changes. Site configuration, credentials and private operations records are not published. Remaining upstream history/storage and test-configuration features are not included.

## 2026-10-22 streaming and snapshot bug fixes

This follow-up fixes shared client code, not model deployment parameters:

- HTTP 200 streams containing error payloads, named error events or error/abort finish reasons now fail explicitly; partial output remains available. Raw server error bodies are not exposed by the new SSE error path.
- EOF without either a finish reason or a completed SSE marker no longer counts as success.
- Receiving [DONE] completes the request immediately rather than waiting for HTTP EOF. Readers are cancelled and unlocked on completion or errors.
- Stale telemetry frames are rejected before changing model identity, chart history, registry membership or React state. Same-timestamp updates remain supported.

Regression coverage includes local mock HTTP streams (including a connection kept open after [DONE]), old-model history rollback and stale empty-registry frames. Production checks passed 436 backend tests, 254 frontend tests, type checking/build, 48 Chrome checks and 36 Firefox checks. The sanitized publication independently passed 439 backend tests, 254 frontend tests, type checking and build. These are UI and client correctness checks, not inference quality or performance measurements. Mock generation tests do not call production models.

Only the panel was redeployed. No model, network, GPU frequency, engine parameter or control-center changes were made. Private runtime configuration, credentials, local backup paths and operations documents are excluded. Local Grafana removal is a separate site decision; this patch does not reinstall it or change other devices' branding. Image-only rollback is insufficient when backend source is mounted; restore only these reviewed changes and the matching frontend after checking that panel jobs are idle.

## 2026-10-12 UI follow-up

Removed the concurrent-test capacity explanation and its paragraph element, together with display-only capacity state. Model identity fetching, client request-count options and model parameters are unchanged. Added a regression test for model identity, the retained 32-request option and absence of the removed note/paragraph. Production verification: 251 existing frontend tests, 22 updated Showcase tests, type checking, Chrome 49 checks and Firefox 36 checks passed. Firefox QA required waiting for React's initial theme effect before changing localStorage; this was a test setup race, not a product theme defect. No inference actions or model restarts were performed. The panel-only update was deployed; private operations documents and runtime configuration are excluded.

This update adds TensorFold native monitoring without replacing existing themes or deploying a model.

- Detect TensorFold from model ownership and native metrics; use live completion counters for output throughput and completed prompt counters for input accounting. Input accounting is not GPU prefill speed.
- Display native running/waiting requests, KV pool usage, TTFT/end-to-end P95, DFlash acceptance and concurrency capacity. Hide unsupported SGLang-only metrics and cross-model daily peaks.
- Isolate browser history by model/backend and remove stale node identity entries.
- Authentication checks use read-only model metadata. The legacy generation verification adapter rejects TensorFold; no historical evidence is treated as current without matching model and boot.
- Remove the TensorFold control-center footer entry and its empty reserved space.
- Preserve existing theme/branding assets. No production configuration, private documents, runtime history or credentials are included.

For read-only verification, configure SPARKDASH_VERIFICATION_NODE and SPARKDASH_TENSORFOLD_VERIFICATION_CONTAINER (or the existing SPARKDASH_VERIFICATION_CONTAINER fallback). Container names are validated. Missing configuration remains unsupported; do not infer local production settings.

Production verification: backend 434 tests, frontend 251 tests, type check/build, Chrome 49 checks and Firefox 36 checks passed. The sanitized publication also passed 437 backend tests, frontend tests, type checking and build. These are monitoring/UI checks, not a model performance or quality evaluation, nor Android hardware certification.

Control-center and Grafana production adaptations are maintained outside this repository and are not included in this commit. Rebuild the frontend and restart only the panel after confirming no panel jobs are active. Mounted backend sources require separate rollback; reverting an image alone is insufficient. Do not restart models or network services for this UI update.
