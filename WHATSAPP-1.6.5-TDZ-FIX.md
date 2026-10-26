# Windows 1.6.5 diagnostic TDZ correction

Base: 31d53df8a0e7226a260178f89dbe64f43c9c1a6d (previous EXE SHA256 119414f7c23769a1d052a056f94aa877453a26cf91f30cb30c51b19e2175b5f4).

The actual will-attach-webview handler had an inner `let e, t` in the WhatsApp block. Those declarations shadowed both outer event `e` and outer webPreferences `t` throughout the block. `prepare(t,r)` therefore threw before initializing the inner session. The catch then referenced the equally uninitialized inner `e`, so the error handler itself failed. No preload execution or vm evaluation caused this error: production path validation only checks the trusted file path.

Rename the inner bindings to whatsappUserAgent and whatsappSession; keep the outer event/preferences unambiguous. A regression runs the extracted, actual production attach handler with controlled dependencies. It failed on the old code and now verifies successful WhatsApp attachment, Telegram separation and proper cancellation when preload validation fails. It never executes preload contents.

The packaged native guest fixture now calls that same registered production attach handler, using a valid dedicated WhatsApp partition, rather than calling prepare directly. It still requires navigation, absolute preload URL, sandbox/context isolation, disabled Node integration, and hooks before the first page script. Signal core/storage/migrations and the old scroll module remain unchanged. Linked-account tests remain UNTESTED.

Windows installer plus corresponding source are uploaded immediately after the native guest startup gate. Subsequent settings/restart/transport checks continue and are reported separately; they do not hold the already validated diagnostic installer hostage. No merge, release or R2 publication.
