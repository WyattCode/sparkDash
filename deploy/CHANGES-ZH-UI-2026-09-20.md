# Monitoring UI and reliability update

- Unify overview and concurrent-generation page headers, theme controls and icon navigation. The home icon is labelled “概览”; remove the duplicate topbar caption.
- Improve compact/foldable layouts, settings dialogs, node-card alignment and integer request counts. Keep the existing four-theme palette.
- Improve connection lifecycle diagnostics, settings persistence, benchmark recovery and SGLang telemetry compatibility, with regression tests.
- Include the web app manifest and icons. Browser installation support still depends on platform and secure-context requirements; HTTP does not guarantee PWA installation.

## Public deployment boundaries

This branch contains application code, not a production environment snapshot. Host configuration, runtime logs, screenshots, credentials and private handoff documents are excluded.

The verification adapter retains `SPARKDASH_VERIFICATION_CONTAINER`, `SPARKDASH_VERIFICATION_NODE` and `SPARKDASH_VERIFICATION_IMAGE`. Missing or ambiguous node configuration must not issue verification requests. The adapter matches the public `deepseek-v4.1-flash` model identifier or its model-path basename. Verification remains manually triggered and bounded; this update does not perform model lifecycle actions.

The Grafana entry uses the current browser hostname on port 3000 instead of a private deployment address/dashboard identifier. Worker telemetry uses the `role` label rather than a machine-specific hostname.
