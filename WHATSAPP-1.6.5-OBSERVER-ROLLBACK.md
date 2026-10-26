# WhatsApp observer rollback diagnostic

User cancelled resident persistence / short-ID / rehydrate work. This candidate restores the 1.6.4 ordinary translation scanner/observer reattach path, with the already verified explicit absolute webview preload, sandbox compatibility, TDZ correction, startup handshake and visible about:blank recovery retained.

- No active resident controller, header fallback, short-ID parser or per-frame rehydrate in preload. The scanner reads message text directly and uses raw IDs only to guard against DOM reuse.
- The local bilingual/SQLite view is disabled; WhatsApp message attachment and resident-cache IPC routes are disabled. The old database/cache files are never deleted or migrated by this rollback.
- Successful WhatsApp translations are reused in RAM for this run, separately per trusted webContents workspace. Provider/long-chunk caches for WhatsApp do not read/write the disk translation cache. Cross-restart translation persistence is not a requirement. Signal keeps its existing native data/cache/renderer behavior unchanged.
- MutationObserver + 120ms scroll debounce + the original 2s scanner restore missing light-DOM translations. This explicitly allows reattachment; there is no resident/first-frame guarantee or custom chat view.
- Incomplete cache-reuse changes are saved under archive/abandoned-1.6.5-cache-reuse/unfinished.patch, not applied. Superseded resident tests are archived; build sync cannot reinject the discarded controller.

Validation: actual rollback scanner function is executed against 21 synthetic short/legacy-ID messages. Verify initial translation, removal then scroll reattach, recreated history reattach, no extra provider requests with session cache. Target-OS Chromium runs the same fixture, alongside retained sandboxed production guest startup and frozen Signal regression. Account real-history test remains UNTESTED until user verifies the installable diagnostic. No merge/release.
