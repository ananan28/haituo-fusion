"""Apply the reviewed 1.6.1 integration to the exact 1.6.0 baseline, idempotently."""
import pathlib,json
ROOT=pathlib.Path(__file__).resolve().parent.parent

def edit(rel, replacements):
    p=ROOT/rel
    original=p.read_text(encoding='utf-8')
    text=original
    for before,after in replacements:
        if text.count(before)!=1:raise RuntimeError(f'{rel}: integration anchor expected once: {before[:100]!r}, got {text.count(before)}')
        text=text.replace(before,after,1)
    p.write_text(text,encoding='utf-8')

if json.loads((ROOT/'project.json').read_text())['versions']['windows']=='1.6.1':
    import subprocess,sys
    subprocess.run([sys.executable,str(ROOT/'scripts/refine-message-attachments-161.py')],check=True)
    print('1.6.1 integration already applied');raise SystemExit(0)

helper='''let HaituoMessageAttachments;
function haituoTranslateAttached(event, request, work) {
    if (request.purpose !== `chat` || typeof request.messageId !== `string` || !request.messageId.trim()) return work();
    let platform = `signal`, account = $u;
    const url = new URL(event.senderFrame?.url || `file:///`);
    if (url.protocol === `https:`) {
        platform = url.hostname === `web.whatsapp.com` ? `whatsapp` : url.hostname === `web.telegram.org` ? `telegram` : ``;
        account = HaituoWorkspaceBySession.get(event.sender.session);
        if (!platform || !account) throw Error(`无法确认消息所属账号，已停止保存译文`);
    }
    HaituoMessageAttachments ||= require('../js/haituo-message-translations.js').createStore({
        directory: (0,s.join)(p.app.getPath(`appData`), `Haituo`, `message-translations-v1`),
        read: haituoProtectedRead, write: haituoProtectedWrite
    });
    // Do not allow an old text-only shared cache to choose a different message's attachment.
    request.messageScope = `${platform}:${account}:${request.messageId}`;
    return HaituoMessageAttachments.translate({platform,account,messageId:request.messageId},request,work);
}

'''
edit('src/app/bundles/main.js',[
 ('function haituoSharedChatCacheKey(e) {',helper+'function haituoSharedChatCacheKey(e) {'),
 ("...(e.__haituoPool ? [e.endpoint||'',e.model||''] : []) ]);","...(e.__haituoPool ? [e.endpoint||'',e.model||''] : []), ...(e.messageScope ? [e.messageScope] : []) ]);"),
 ('if (e.purpose !== `chat` || e.forceRefresh || !String(e.text || ``).trim()) return null;', 'if (e.messageScope || e.purpose !== `chat` || e.forceRefresh || !String(e.text || ``).trim()) return null;'),
 ('if (request.purpose !== `chat` || !result?.text?.trim() || result.cached || result.skipSharedCache) return;', 'if (request.messageScope || request.purpose !== `chat` || !result?.text?.trim() || result.cached || result.skipSharedCache) return;'),
 ('const result = a.translationPools?await haituoTranslateWithMode(a,r):await HaituoNetwork.retryTranslation(() => haituoTranslateWithMode(a, r));', 'const result = r.messageId ? await haituoTranslateAttached(e, r, () => a.translationPools?haituoTranslateWithMode(a,r):HaituoNetwork.retryTranslation(() => haituoTranslateWithMode(a, r))) : (a.translationPools?await haituoTranslateWithMode(a,r):await HaituoNetwork.retryTranslation(() => haituoTranslateWithMode(a, r)));'),
 ('const result = r.translationPools?await haituoTranslateWithMode(r,r):await HaituoNetwork.retryTranslation(() => haituoTranslateWithMode(r, r));', 'const result = r.messageId ? await haituoTranslateAttached(e, r, () => r.translationPools?haituoTranslateWithMode(r,r):HaituoNetwork.retryTranslation(() => haituoTranslateWithMode(r, r))) : (r.translationPools?await haituoTranslateWithMode(r,r):await HaituoNetwork.retryTranslation(() => haituoTranslateWithMode(r, r)));'),
 ('        haituoRememberChatTranslation(a, result);', '        a.messageScope = r.messageScope; haituoRememberChatTranslation(a, result);'),
 ('            purpose,\n            provider,\n            strictProvider:', '            purpose,\n            messageId: typeof i?.messageId === `string` ? i.messageId : undefined,\n            provider,\n            strictProvider:')
])

# Signal binds identity through the actual MessageBody id prop, not visible text.
pre=ROOT/'src/app/bundles/preload/main.js'
signal=(ROOT/'scripts/signal-message-component-161.txt').read_text()
text=pre.read_text();start=text.index('    function Ive({text:');end=text.index('    var w_, T_, Lve',start)
text=text[:start]+signal+'\n'+text[end:]
needle='function E_({author: e, bodyRanges: t, direction: n, disableJumbomoji:'
assert text.count(needle)==1
text=text.replace(needle,'function E_({haituoMessageId, author: e, bodyRanges: t, direction: n, disableJumbomoji:',1)
needle='                text: h,\n                quoted: p === __.Quote'
assert text.count(needle)==1
text=text.replace(needle,'                text: h,\n                messageId: haituoMessageId,\n                quoted: p === __.Quote',1)
needle='return (0, Gve.jsx)(E_, {\n            bodyRanges: e,'
assert text.count(needle)==1
text=text.replace(needle,'return (0, Gve.jsx)(E_, {\n            haituoMessageId: o,\n            bodyRanges: e,',1)
pre.write_text(text)

edit('src/app/js/caisheng-webview-preload.js',[
 ('async function translateMessage(e, t = !1) {','async function translateMessage(e, t = !1, messageId) {'),
 ('        forceRefresh: !!t\n    });','        forceRefresh: !!t,\n        messageId\n    });'),
 ('            translationTargets.push({ e, t: e, n, mount });','            const messageId = e.getAttribute("data-id") || e.closest("[data-id]")?.getAttribute("data-id") || (isTelegram() ? e.getAttribute("data-mid") : undefined);\n            translationTargets.push({ e, t: e, n, mount, messageId });'),
 ('item.r = await translateMessage(item.n),','item.r = await translateMessage(item.n, !1, item.messageId),'),
 ('translationText.textContent = formatMessageParagraphs(n, await translateMessage(n, !0)),','translationText.textContent = formatMessageParagraphs(n, await translateMessage(n, !0, item.messageId)),')
])
# Apply each finished translation immediately; a slow neighbor must not hold the batch.
p=ROOT/'src/app/js/caisheng-webview-preload.js';text=p.read_text()
a=text.index('        haituoKeepTranslationPosition(visibleMessages[0], () => {\n        for (const item of translated) {')
b=text.index('        } finally {\n            regionScanBusy = !1;',a)
render=text[a:b]
render=render.replace('haituoKeepTranslationPosition(visibleMessages[0], () => {\n        for (const item of translated) {','haituoKeepTranslationPosition(item.e, () => {',1)
# The old loop's continue statements become exits from this single-message callback.
render=render.replace('continue;', 'return;')
render=render.replace('        }\n        });','        });',1)
text=text[:a]+text[b:]
needle='        const translated = [], queue = translationTargets.slice(0, 24);'
assert text.count(needle)==1
text=text.replace(needle,'        const applyTranslation = item => {\n'+render+'\n        };\n'+needle,1)
text=text.replace('                translated.push(item);','                applyTranslation(item);',1)
# Schedule on actual message DOM changes promptly without observing our own attachments.
text=text.replace('    new MutationObserver(() => {\n        clearTimeout(e), e = setTimeout(() => {','    new MutationObserver(records => {\n        if (records.every(record => record.target instanceof Element && record.target.closest(".haituo-wa-message-translation,.haituo-wa-translation-error,.haituo-voice-result,#haituo-whatsapp-translator,#haituo-backtranslation-preview"))) return;\n        clearTimeout(e), e = setTimeout(() => {',1)
text=text.replace('        }, 500);\n    }).observe(document.documentElement, {','        }, 60);\n    }).observe(document.documentElement, {',1)
# Preserve restored history even when automatic new translations are disabled.
text=text.replace('async function translateMessage(e, t = !1, messageId) {','async function translateMessage(e, t = !1, messageId, attachmentOnly = !1) {',1)
text=text.replace('        messageId\n    });','        messageId, attachmentOnly\n    });\n    if (o?.notFound) return "";',1)
a=text.index('        // 关闭群组回译/接收回译后，已渲染的译文也要立即撤下')
b=text.index('        for (const e of visibleMessages) {',a+text[a:].index('        }\n')+10)
text=text[:a]+text[b:]
text=text.replace('            if (!incomingTranslationOn()) continue;','            if (!webTranslationActive()) continue;',1)
text=text.replace('            translationTargets.push({ e, t: e, n, mount, messageId });','            if (!incomingTranslationOn() && !messageId) { delete e.dataset.haituoTranslationPending; continue; }\n            translationTargets.push({ e, t: e, n, mount, messageId, attachmentOnly: !incomingTranslationOn() });',1)
text=text.replace('            if (!incomingTranslationOn()) return;','            if (!webTranslationActive()) return;',1)
text=text.replace('            const { e, t, n, r, mount } = item;','            const { e, t, n, r, mount } = item;\n            const liveId = e.getAttribute("data-id") || e.closest("[data-id]")?.getAttribute("data-id") || (isTelegram() ? e.getAttribute("data-mid") : undefined);\n            if (item.messageId !== liveId) return;',1)
text=text.replace('translateMessage(item.n, !1, item.messageId)','translateMessage(item.n, !1, item.messageId, item.attachmentOnly)',1)
text=text.replace('        await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));','        regionScanBusy = !1;\n        await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));',1)
p.write_text(text)

cfg=json.loads((ROOT/'project.json').read_text());cfg['versions']={'windows':'1.6.1','macos':'1.6.1'}
(ROOT/'project.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n')
for name in ['README.md','START-HERE.md']:
 p=ROOT/name
 s=p.read_text().replace('1.4.5','1.6.1')
 p.write_text(s)
import subprocess,sys
subprocess.run([sys.executable,str(ROOT/'scripts/refine-message-attachments-161.py')],check=True)
print('1.6.1 message attachment integration applied')
