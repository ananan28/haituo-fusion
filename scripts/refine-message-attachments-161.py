"""Keep concurrent WhatsApp DOM reuse independent of unfinished old jobs."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
p=ROOT/'src/app/js/caisheng-webview-preload.js';text=p.read_text()
if 'function haituoCurrentWebMessage' in text:raise SystemExit(0)
def change(before,after):
 global text
 if text.count(before)!=1:raise RuntimeError('Refinement anchor mismatch: '+before[:100])
 text=text.replace(before,after,1)
change('function haituoInstallMessageScanner() {', '''function haituoWebMessageId(node) {
    return node.getAttribute("data-id") || node.closest("[data-id]")?.getAttribute("data-id") || (isTelegram() ? node.getAttribute("data-mid") : undefined);
}
function haituoCurrentWebMessage(item) {
    return item.e.isConnected && item.e.dataset.haituoTranslationSource === item.n && haituoWebMessageId(item.e) === item.messageId;
}
function haituoInstallMessageScanner() {''')
change('            if (e.dataset.haituoTranslationSource !== n) {','            const messageId = haituoWebMessageId(e);\n            if (e.dataset.haituoTranslationSource !== n || e.dataset.haituoTranslationMessageId !== (messageId || "")) {')
change('                e.dataset.haituoTranslationSource = n;','                e.dataset.haituoTranslationSource = n;\n                e.dataset.haituoTranslationMessageId = messageId || "";\n                delete e.dataset.haituoTranslationPending;\n                delete e.dataset.haituoTranslationRetryAt;\n                delete e.dataset.haituoAttachmentMiss;')
change('            const messageId = e.getAttribute("data-id") || e.closest("[data-id]")?.getAttribute("data-id") || (isTelegram() ? e.getAttribute("data-mid") : undefined);\n','')
change('            if (e.dataset.haituoTranslationPending === "1" || Number(e.dataset.haituoTranslationRetryAt || 0) > Date.now()) continue;', '            if (!incomingTranslationOn() && e.dataset.haituoAttachmentMiss === "1") continue;\n            if (e.dataset.haituoTranslationPending === "1" || Number(e.dataset.haituoTranslationRetryAt || 0) > Date.now()) continue;')
change('                    item.r = await translateMessage(item.n, !1, item.messageId, item.attachmentOnly), item.t.dataset.haituoTranslationDone = "1", delete item.t.dataset.haituoTranslationRetryCount, delete item.t.dataset.haituoTranslationRetryAt;', '''                    item.r = await translateMessage(item.n, !1, item.messageId, item.attachmentOnly);
                    if (haituoCurrentWebMessage(item)) {
                        item.t.dataset.haituoTranslationDone = "1";
                        if (!item.r && item.attachmentOnly) item.t.dataset.haituoAttachmentMiss = "1";
                        delete item.t.dataset.haituoTranslationRetryCount;
                        delete item.t.dataset.haituoTranslationRetryAt;
                    }''')
change('                    item.t.dataset.haituoTranslationRetryCount = String(retry), item.t.dataset.haituoTranslationRetryAt = String(Date.now() + [ 0, 600, 1500, 3500 ][retry]);','                    if (haituoCurrentWebMessage(item)) item.t.dataset.haituoTranslationRetryCount = String(retry), item.t.dataset.haituoTranslationRetryAt = String(Date.now() + [ 0, 600, 1500, 3500 ][retry]);')
change('                    delete item.t.dataset.haituoTranslationPending;','                    if (haituoCurrentWebMessage(item)) delete item.t.dataset.haituoTranslationPending;')
# Observe message identity and edited text, never style mutations from our layout.
change('        }, 60);\n    }).observe(document.documentElement, {\n        childList: !0,\n        subtree: !0','        }, 60);\n    }).observe(document.documentElement, {\n        attributes: !0, attributeFilter: ["data-id", "data-mid"], characterData: !0,\n        childList: !0,\n        subtree: !0')
p.write_text(text)
