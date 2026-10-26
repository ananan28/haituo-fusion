# WhatsApp short-message-ID diagnostic fix

Baseline: 1.6.5 a2d24d8473f111103e3ba5c764872c5926a2aa1d. No Signal source, schema or migration changes; old scrolling patch is not merged. No production release.

## Confirmed failure path

The old controller derived chatId exclusively from true_/false_ + JID data-id. Current WhatsApp also exposes short hexadecimal message IDs without data-pre-plain-text. Parsing returned null before source extraction, so those messages never received slots. The main-process translation attachment branch independently required the same long ID, so changing only DOM scanning would still break persistence.

## Fix

New shared identity module separates raw messageId from chatId. Long legacy IDs retain their embedded chat. Short hex IDs use current #main cid / explicit conversation data, explicit header conversation data, international phone header labels, or selected conversation data whose label matches the current header. Group and lid JIDs remain supported. Ordinary display names alone are not stable identities and never become database keys; unresolved nodes expose data-haituo-translation-status=chat-unresolved rather than borrowing the last chat. Resolved slots/messages expose data-haituo-translation-chat.

The isolated observer/light DOM/cache design is retained. Incoming English targets myLanguage (default zh -> zh-CN), composer target remains en. Short outgoing IDs derive direction from the message-out container rather than true_ prefix. The exact raw ID is passed with a captured chatId to IPC; the main process validates the pair and still derives account from the trusted webContents session. It never accepts a renderer-supplied account. Legacy IDs conflicting with chatId are rejected. Pending work captures the original chat before asynchronous lookup so switching conversations cannot write to the newly opened chat. SQLCipher tables and DAO are unchanged.

## Tests and limits

Regression reproduces 21 English messages with short hex IDs, zero pre-plain-text attributes and the international phone header. All receive Chinese translations; deleting slots and scrolling restores cached translations without another lookup or request. Covers cid/header/selected-chat context, identical short IDs across chats, missing/ambiguous context, legacy compatibility, outgoing direction and switching chat during lookup. A sliced actual main-process IPC attachment test confirms short IDs reach the account-owned SQLCipher route with the captured chat.

Native Chromium scan now includes four short-ID chats and one legacy-ID chat, with absent pre-plain-text metadata, at 0/25/50/75/100% plus rapid reversals, deletion and clone recovery. Normal and CPU6x results must pass unchanged time budgets. Real account test remains UNTESTED until the user installs and scans; synthetic coverage is not that evidence. Some WhatsApp layouts may expose no stable current-chat identity; such cases must be reported with the unresolved marker and not guessed from a display name.
