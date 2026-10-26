# 1.6.5 diagnostic: isolated observer / light DOM / independent languages

This candidate supersedes the creation-hook/closed-shadow rendering design for WhatsApp only. Signal code, tables and migrations remain frozen; old scrolling patch is not merged.

## Behavior

- The isolated preload observes childList, characterData and attributes. External changes immediately scan every visible [data-id]; own metadata/light-DOM writes are filtered to prevent loops. No main-world hooks or CustomEvent dependency is installed.
- Translation spans are light DOM below original text. Mutation delivery reconciles before ordinary next paint; scrolling also scans immediately and on rAF / 100ms trailing debounce. Cache hits synchronously create or recover a slot within reconciliation; missing records use the existing protected spinner and batched SQLCipher lookup. This is observer-based reconciliation, NOT an official WhatsApp render API. First-frame compliance requires measurement and is not assumed from using MutationObserver.
- The shared SQLCipher/account-enforced DAO and existing language-scoped cache are retained unchanged. Cache hits never invoke a translation provider. New language settings select a separate cache namespace.
- myLanguage defaults to zh for older configurations. WhatsApp incoming messages and outgoing backtranslations request this language (zh normalizes to zh-CN). Composer sending remains targetLanguage, normally en. There is no source-script guess for WhatsApp conversation direction.
- Settings show '我的语言（WhatsApp 入站 / 回译）' separately from '发送目标语言'. Incoming/outgoing enable switches remain independent. Other platforms retain their existing behavior.
- Light DOM inherently appears in raw textContent / cloneNode. The standard copy event strips our slots, and read() excludes them from translation sources. Native WhatsApp forward, quote, search, and app-controlled custom copy still require dedicated-account acceptance; do not claim closed-shadow isolation with this design.

## Acceptance

Local: unit tests, isolated-only DOM tests (no page hooks), six synthetic chats, 0/25/50/75/100 and rapid alternating scroll, deletion/reuse/clone recovery, independent account memory, copy filtering, language direction tests. Native CI: actual Chromium renderer, five chats / 1000 records, all five positions, rapid reversal, slot removal and clones, rAF per-message IDs/cache status/slot presence/request counts at normal and CPU6x. Cache-hit strict phase requires zero bare frames, zero additional lookup/provider requests.

Synthetic tests are not linked-account evidence. ALL real-account chats must be checked at 0/25/50/75/100 plus rapid wheel up/down by the tester; any missing cached translation fails acceptance. Real-account status UNTESTED; no merge or production release until that passes. Installable Windows diagnostic and matching source are delivered for that test.
