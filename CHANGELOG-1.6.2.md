# 1.6.2 — Candidate, validation pending

Signal translations are stored as local message attributes in the same encrypted message SQL JSON. React reads them during the first render. Existing 1.6.1 attachments migrate on first access. New Signal results bypass the separate attachment journal.

WhatsApp: independent local SQLCipher message store, keyed by account/conversation/message ID, with original and translation in the same message JSON. The local bilingual text view keeps its records when the official webpage removes DOM nodes. Images/voice/actions remain available through the official-view switch. This records only text messages actually loaded on this computer; it is not a server history mirror or multi-device backup.

Gated subaccount work: incorporates the bridge work through upstream 6f26ff8 without changing the legacy native follower; HAITUO_INPROCESS=1 enables WebContentsView. Fixes public handler dispatch, structured binary serialization, per-profile browser partitions, a SQL-ready/config handshake before view load, listener cleanup, view bounds/visibility and child cleanup.

Real account messaging, physical drag/resize/sleep and complete long-history scrolling are not certified by unit/DOM/CI bootstrap checks. This is a candidate, not a claim of completion or zero bugs.

The embedded backend now shuts down through the existing Signal renderer/SQL shutdown handshake before the view is destroyed; a bounded timeout remains as a fallback. Appearance CSS keys are scoped per webContents. Optional --haituo-inprocess enables the existing gate for one launch. Native CI phases share one disposable browser profile so Windows OS-crypt keys match the intentionally shared settings directory.
