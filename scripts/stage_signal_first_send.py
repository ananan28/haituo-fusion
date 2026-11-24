"""Reviewed edits to Signal's recovered renderer, applied only to the staged copy."""
from pathlib import Path

EDITS = [
    ("""async function e6n(e) {
        if (e.type === `username`) {
            let t = window.ConversationController.get(e.username);
            if (t && t.getServiceId()) return t.id;
        }
        let n =""", """async function e6n(e) {
        let n ="""),
    ("""a(n, !0);
        try {
            let n;
            if (e.type === `e164`)""", """a(n, !0);
        try {
            if (e.type === `username`) {
                const known = window.ConversationController.get(e.username);
                if (known?.getServiceId()) { await known.initialPromise; return known.id; }
            }
            let n;
            if (e.type === `e164`)"""),
    ("let {conversation: e} = window.ConversationController.maybeMergeContacts({\n                        aci: o.aci,",
     "let {conversation: e, mergePromises} = window.ConversationController.maybeMergeContacts({\n                        aci: o.aci,"),
    ("reason: `startNewConversationWithoutUuid(e164)`\n                    });\n                    n = e?.id;",
     "reason: `startNewConversationWithoutUuid(e164)`\n                    });\n                    await Promise.all([e?.initialPromise, ...mergePromises]);\n                    n = e?.id;"),
    ("n = e.id, await e.updateUsername(r.username);",
     "await e.initialPromise, await e.updateUsername(r.username), n = e.id;"),
    ("if (!n.length) {\n                s.warn(`trying to send message",
     """if (Kt(e.attributes) && !qt(e.attributes) && !a.length) {
                const states = QN({log:s,message:f.attributes,prop:`sendStateByConversationId`,targetTimestamp:h});
                if (states?.[e.id]?.status === Zh.Pending) {
                    const [allowed, refused] = _j(e);
                    s.warn(`Direct send has a pending recipient but no usable destination`);
                    await nP({message:f, errors:[allowed ? Error(`No valid recipients`) : refused.error], targetTimestamp:h});
                    return;
                }
            }
            if (!n.length) {
                s.warn(`trying to send message"""),
    ("nP({\n                        message: f,\n                        errors: [ Error(`No valid recipients`)",
     "await nP({\n                        message: f,\n                        errors: [ Error(`No valid recipients`)"),
    ("s.info(n.logLine), nP({\n                            message: f,", "s.info(n.logLine), await nP({\n                            message: f,"),
]

def apply(source):
    for old, new in EDITS:
        if new in source:
            if source.count(new) != 1:
                raise ValueError('Duplicate patched Signal anchor')
            continue
        if source.count(old) != 1:
            raise ValueError('Signal renderer anchor changed: ' + old[:70])
        source = source.replace(old, new, 1)
    return source

def stage(path):
    path = Path(path)
    path.write_text(apply(path.read_text(encoding='utf-8')), encoding='utf-8')

if __name__ == '__main__':
    import sys
    stage(sys.argv[1])
