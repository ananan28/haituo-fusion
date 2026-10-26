# 1.6.5 diagnostic guest startup correction

Base: eae832129fd0cbc822491606ce9215ac87c6bdcb. No release, no merge.
Signal preload, workers, message record module and previous scroll module remain byte-identical to the 1.6.4 baseline.

## Trigger and change

The reported guest stays at about:blank and Electron's sandbox startupData is null. The previous bootstrap attaches CDP during web-contents-created and delays the first mainFrame request until Page.addScriptToEvaluateOnNewDocument completes. This can create a guest renderer before Electron has attached/initialized its sandbox. The missing DOM preload attribute alone is not proof that preload was unset: the previous main-process will-attach-webview handler already assigns webPreferences.preload.

This candidate removes the early debugger attachment and mainFrame gate entirely. The sandboxed preload installs the exact same main-world creation hooks synchronously using contextBridge.executeInMainWorld, after registering the isolated-world controller listeners and before returning to the first page script. It does not use asynchronous webFrame.executeJavaScript for this installation.

The main-process handler enforces an existing absolute preload path inside app.getAppPath(), including app.asar, plus sandbox/contextIsolation=true and all Node integration flags=false. params.preload is an absolute file URL; after attachment the same URL is mirrored into the host webview attribute for debugging. No session-global setPreloads fallback is installed, so other accounts/pages do not inherit this preload.

A guest startup watchdog requires both successful page load and the preload/hooks handshake. An empty URL/about:blank displays a workspace-specific error panel and retries the original account URL at most twice. The panel also has a manual retry. preload-error and renderer termination are logged and displayed. A timeout for a nonblank page reports the failure without automatically resetting a potentially usable session. Account partitions and cookies are never cleared.

## Verification

Local: 384 unit checks and 16 synthetic DOM/Signal-component regressions pass. New native CI step uses the packaged app and its actual sandboxed preload in a real Electron webview with an offline synthetic HTTPS page, asserting navigation, preload path, security preferences, handshake and main-world hooks before the first page script. It is not a logged-in WhatsApp test.

Real-account startup, first-frame translation trace, native copy/forward/quote/search and the six real-account acceptance groups remain UNTESTED until the user retests. Run with --remote-debugging-port=9444 to inspect the guest URL and host preload attribute. No claim that the reported Electron failure is fixed is made until target-OS native checks and user reproduction both succeed.

The 6x CPU synthetic fixture retains all 1000-record/80-frame assertions and zero-retry behavior, but uses a 30-second CDP evaluation deadline instead of the ordinary 7-second command deadline. Actual wall time and the deadline are recorded in its result. This changes only the test harness; product network/translation deadlines are unchanged.
