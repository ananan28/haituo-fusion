"use strict";
// P0-01/P2-11: report real user gestures (record-button clicks) to the main
// process so the media permission gate can distinguish "user just clicked
// record" from silent probes. before-input-event alone is not reliably
// delivered inside webviews, so the page reports pointer/key activity too.
try {
    const haituoGestureIpc = require("electron").ipcRenderer;
    const haituoReportGesture = event => { if (!event?.isTrusted) return; try { haituoGestureIpc.send("haituo-user-gesture"); } catch {} };
    addEventListener("pointerdown", haituoReportGesture, { passive: !0, capture: !0 });
    addEventListener("keydown", haituoReportGesture, { passive: !0, capture: !0 });
} catch {}
// Translation-only layout transaction. Never observe or continuously write scrollTop.
function haituoTranslationScroller(node) {
    for(let parent=node?.parentElement;parent;parent=parent.parentElement) {
        const css=getComputedStyle(parent);
        if(/^(auto|scroll)$/.test(css.overflowY) && parent.clientHeight>0)return parent;
    }
    return null;
}
function haituoKeepTranslationPosition(node, update) {
    const root=haituoTranslationScroller(node);
    if(!root || !root.isConnected)return update();
    const bounds=root.getBoundingClientRect();
    const atBottom=root.scrollHeight-root.clientHeight-root.scrollTop<=24;
    const candidates=root.querySelectorAll('.module-message,[data-testid="message"],.message-in,.message-out,[data-id]');
    const anchor=[...candidates].find(item=>{const r=item.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom});
    const top=anchor?.getBoundingClientRect().top, oldTop=root.scrollTop;
    const identity=anchor?.getAttribute('data-id')||anchor?.id;
    const oldAnchor=root.style.getPropertyValue('overflow-anchor'),priority=root.style.getPropertyPriority('overflow-anchor');
    const oldBehavior=root.style.getPropertyValue('scroll-behavior'),behaviorPriority=root.style.getPropertyPriority('scroll-behavior');
    root.style.setProperty('overflow-anchor','none','important');
    root.style.setProperty('scroll-behavior','auto','important');
    try {
        const result=update();
        if(!root.isConnected)return result;
        if(atBottom)root.scrollTop=Math.max(0,root.scrollHeight-root.clientHeight);
        else if(anchor?.isConnected && (anchor.getAttribute('data-id')||anchor.id)===identity) {
            const delta=anchor.getBoundingClientRect().top-top;
            if(Math.abs(delta)>.5)root.scrollTop+=delta;
        } else root.scrollTop=oldTop;
        return result;
    } finally {
        oldAnchor?root.style.setProperty('overflow-anchor',oldAnchor,priority):root.style.removeProperty('overflow-anchor');
        oldBehavior?root.style.setProperty('scroll-behavior',oldBehavior,behaviorPriority):root.style.removeProperty('scroll-behavior');
    }
}

// Apply only to WhatsApp. The stable account seed never enters HTTP headers.
// This partitions Canvas text readback; it does not spoof OS/GPU or change audio.
const haituoProfileArg = process.argv.find(value => /^--haituo-canvas-profile=[a-f0-9]{64}$/.test(value));
if (haituoProfileArg && (location.hostname === 'web.whatsapp.com' || (process.argv.includes('--haituo-environment-fixture') && location.protocol === 'file:'))) {
    const profileSeed = haituoProfileArg.split('=')[1];
    require('electron').contextBridge.executeInMainWorld({
        func: function(seed) {
            const tagged = new WeakSet();
            const ctxProto = CanvasRenderingContext2D.prototype;
            const read = ctxProto.getImageData;
            const put = ctxProto.putImageData;
            const getContext = HTMLCanvasElement.prototype.getContext;
            const bytes = seed.match(/../g).map(value => parseInt(value,16));
            for (const name of ['fillText','strokeText']) {
                const original = ctxProto[name];
                ctxProto[name] = function(...args) { const result=Reflect.apply(original,this,args);tagged.add(this.canvas);return result; };
            }
            const protectedCanvas = canvas => tagged.has(canvas) && canvas.width>0 && canvas.height>0 && canvas.width<=1024 && canvas.height<=512;
            const noise = image => {
                // Touch RGB only, on opaque pixels: transparent pixels and alpha are preserved.
                let index=0;
                for(let offset=0;offset<image.data.length && index<bytes.length*8;offset+=4) {
                    if(image.data[offset+3]!==255)continue;
                    image.data[offset] ^= (bytes[Math.floor(index/8)] >>> (index%8)) & 1; index++;
                }
                return image;
            };
            ctxProto.getImageData = function(...args) {
                const result=Reflect.apply(read,this,args);
                return protectedCanvas(this.canvas) ? noise(result) : result;
            };
            const copy = canvas => {
                const source=Reflect.apply(getContext,canvas,['2d']);
                if(!source)return canvas;
                const image=noise(Reflect.apply(read,source,[0,0,canvas.width,canvas.height]));
                const clone=document.createElement('canvas');clone.width=canvas.width;clone.height=canvas.height;
                Reflect.apply(put,Reflect.apply(getContext,clone,['2d']),[image,0,0]);return clone;
            };
            for(const name of ['toDataURL','toBlob']) {
                const original=HTMLCanvasElement.prototype[name];
                HTMLCanvasElement.prototype[name]=function(...args) {
                    return Reflect.apply(original,protectedCanvas(this)?copy(this):this,args);
                };
            }
        }, args: [profileSeed]
    });
}


const {ipcRenderer: ipcRenderer, webFrame: webFrame, contextBridge: contextBridge} = require("electron"), HAN = /[\u3400-\u9fff]/u, busy = new WeakSet, recentSends = new WeakMap, voiceProcessed = new WeakSet;

let panel, settingsPanel, translatorFooter, backTranslationPreview, backTranslationTimer, backTranslationWatchdog, quickClearTimer, panelPreferencePendingUntil = 0, localPanelPreference = null, backTranslationGeneration = 0, backTranslationExpectedText = "", backTranslationOutgoingMatches = 0, backTranslationComposer = null, activeComposer, quickComposerSyncLock = 0, chineseConfirmBypassUntil = 0, recentAction = {
    key: "",
    at: 0
}, settings = {
    provider: "google-free",
    inputTranslationProvider: "google-free",
    chatTranslationProvider: "google-free",
    voiceTranscriptionProvider: "groq",
    apiKey: "",
    openaiApiKeys: [],
    openaiApiProfiles: [],
    groqApiKey: "",
    deepLApiKey: "",
    kepplApiKey: "",
    kepplEndpoint: "",
    kepplModel: "whisper-large-v3",
    endpoint: "",
    model: "gpt-4.1-mini",
    region: "",
    targetLanguage: "en",
    blockChineseOutgoing: !0,
    accountLabelColor: "#30343b",
    chatTextColor: "",
    outgoingBubbleColor: "",
    incomingBubbleColor: "",
    incomingBubbleLinked: !0,
    chatTextGradientIndex: 0,
    outgoingBubbleGradientIndex: 0,
    chatFontSize: 15,
    darkTheme: !1,
    hideTranslationBox: !1,
    translationMode: "normal",
    efficiencyMode: !1,
    translateShortcut: "triple-space",
    refreshShortcut: "ctrl-r",
    shortcut: "ctrl-r"
    ,backTranslationEnabled: !0
    ,autoTranslateIncoming: !0
    ,groupBackTranslationEnabled: !0
    ,telegramTranslationEnabled: !1
    ,translationProxyEnabled: !1
    ,translationProxyPool: ""
};

let whatsappDarkObserver, whatsappDarkTimer;

let haituoAppliedWhatsAppMode, haituoAppliedWhatsAppBody;
function forceWhatsAppDarkTheme() {
    if (!isWhatsApp() || !document.documentElement) return;
    const mode = settings.nativeTheme === "light" ? "light" : "dark";
    if (haituoAppliedWhatsAppMode === mode && haituoAppliedWhatsAppBody === document.body) return;
    haituoAppliedWhatsAppMode = mode;
    haituoAppliedWhatsAppBody = document.body;
    document.documentElement.classList.toggle("dark",mode === "dark");
    document.documentElement.classList.toggle("light",mode === "light");
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    if (document.body) {
        document.body.classList.toggle("dark",mode === "dark");
        document.body.classList.toggle("light",mode === "light");
        document.body.dataset.theme = mode;
    }
    try {if (localStorage.getItem("theme") !== JSON.stringify(mode)) localStorage.setItem("theme",JSON.stringify(mode));} catch {}
}
forceWhatsAppDarkTheme();

function applyWhatsAppMessageAppearance() {}

function applyWhatsAppWelcomeSurface() {}

function exposeWhatsAppLoginBackground() {}

function applyWhatsAppComposerSurface() {}

function applyChatColor() {
    if (!document.documentElement) return;
    forceWhatsAppDarkTheme();
    let style = document.getElementById("haituo-native-message-appearance");
    if (!style) {style=document.createElement("style");style.id="haituo-native-message-appearance";(document.head||document.documentElement).append(style);}
    const text = '#main .selectable-text,#main [data-testid="selectable-text"],#main [data-testid="msg-text"],#main [data-testid="conversation-text"],.haituo-wa-message-translation,.haituo-voice-result';
    const size=Math.max(12,Math.min(24,Number(settings.chatFontSize)||15));
    let css=`${text}{font-size:${size}px!important;line-height:1.4!important}`;
    if (/^#[0-9a-f]{6}$/i.test(settings.chatTextColor||"")) css+=`${text},#main .selectable-text *,#main [data-testid="selectable-text"] *{color:${settings.chatTextColor}!important;-webkit-text-fill-color:${settings.chatTextColor}!important}`;
    for (const [direction,color] of [["incoming",settings.incomingBubbleColor],["outgoing",settings.outgoingBubbleColor]]) {
        if (!/^#[0-9a-f]{6}$/i.test(color||"")) continue;
        // WhatsApp's current bubbles and tails use WDS variables. Keep the old
        // variables too for accounts still served the previous web interface.
        css+=`:root,html body #app{--WDS-systems-bubble-surface-${direction}:${color}!important;--${direction}-background:${color}!important;--${direction}-background-deeper:${color}!important}`;
        const oldDirection=direction==='incoming'?'in':'out';
        css+=`#app .message-${oldDirection} [data-testid="msg-container"],#app .message-${oldDirection} [data-testid="msg-container"]>div{background-color:${color}!important;background-image:none!important}`;
    }
    if (style.textContent!==css) style.textContent=css;
}


function applyTranslatorTheme() {
    if (!document.documentElement) return;
    const dark=settings.nativeTheme!=="light",bg=dark?"#202020":"#ffffff",fg=dark?"#eeeeee":"#202020",field=dark?"#303030":"#f3f3f3",edge=dark?"#555555":"#c6c6c6";
    let style=document.getElementById("haituo-native-translator-theme");
    if(!style){style=document.createElement("style");style.id="haituo-native-translator-theme";(document.head||document.documentElement).append(style);}
    const css=`#haituo-whatsapp-translator,#haituo-api-settings{color-scheme:${dark?"dark":"light"};background:${bg}!important;background-image:none!important;color:${fg}!important;-webkit-text-fill-color:${fg}!important;border:1px solid ${edge}!important;box-shadow:none!important}#haituo-whatsapp-translator :is(strong,label,span),#haituo-api-settings :is(strong,label,span){color:${fg}!important;-webkit-text-fill-color:${fg}!important}#haituo-whatsapp-translator :is(button,input,select,textarea),#haituo-api-settings :is(button,input,select,textarea){background:${field}!important;background-image:none!important;color:${fg}!important;-webkit-text-fill-color:${fg}!important;border-color:${edge}!important}#haituo-whatsapp-translator textarea::placeholder{color:${dark?"#bbbbbb":"#666666"}!important;-webkit-text-fill-color:${dark?"#bbbbbb":"#666666"}!important}#haituo-whatsapp-translator.haituo-collapsed{background:transparent!important;border:0!important;box-shadow:none!important}#haituo-whatsapp-translator.haituo-collapsed button{background:#306de1!important;color:#fff!important;-webkit-text-fill-color:#fff!important}body:has([data-testid=media-viewer],[data-testid=media-editor],[role=dialog][aria-modal=true]) :is(#haituo-whatsapp-translator,#haituo-backtranslation-preview,#haituo-whatsapp-quick-input){display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}`;
    if(style.textContent!==css) style.textContent=css;
}


ipcRenderer.on("caisheng:translation-config-changed", (event, next) => {
    if (next && "object" == typeof next) {
        const localHidden = settings.hideTranslationBox, localBlock = settings.blockChineseOutgoing;
        settings = { ...settings, ...next, ...haituoPendingValues() };
        if(isWhatsApp())haituoLocalBilingualView?.refreshTargets?.();
        settings.chatTextGradientIndex = 0;
        settings.outgoingBubbleGradientIndex = 0;
        settings.incomingBubbleLinked !== !1 && (settings.incomingBubbleColor = settings.outgoingBubbleColor);
        localPanelPreference = null;
        if(!!localHidden !== !!settings.hideTranslationBox){panel?.remove();panel=null;if(findComposer())showPanel(findComposer());}
        applyChatColor(), applyTranslatorTheme(), haituoSyncOutgoingControls(), haituoSyncChatPreview();
        if (isTelegram() && settings.telegramTranslationEnabled !== !0) { panel?.remove(), panel = null, hidePanels(), hideBackTranslation(); }
    }
});

let haituoSaveQueue = Promise.resolve(), haituoSaveRevision = 0;
const haituoPendingSettings = new Map();
function haituoPendingValues() { return Object.fromEntries([...haituoPendingSettings].map(([key, entry]) => [key, entry.value])); }
function haituoSyncOutgoingControls() {
    const quick = document.getElementById("haituo-whatsapp-quick-input");
    if (quick) quick.placeholder = settings.translateShortcut === "triple-space" ? "输入中文后按 Enter 翻译并填入，确认后回车发送；Shift+Enter 换行；连续三次空格仅翻译" : "输入中文后按 Enter 翻译并填入，确认后回车发送；Shift+Enter 换行";
    const send = panel?.querySelector('[data-haituo-translate-action="send"]');
    if (send) send.textContent = settings.blockChineseOutgoing ? "翻译并发送" : "直接发送";
    const block = panel?.querySelector('[data-haituo-block-chinese]');
    if (block) block.checked = !!settings.blockChineseOutgoing;
}

async function refreshSettings() {
    try {
        const wasHidden = !!settings.hideTranslationBox;
        const e = await ipcRenderer.invoke("caisheng:get-translation-config");
        e && "object" == typeof e && (settings = {
            ...settings,
            ...e, ...haituoPendingValues()
        }), settings.targetLanguage || (settings.targetLanguage = "en"), 
        localPanelPreference = null,
        applyChatColor(), applyTranslatorTheme(), haituoSyncOutgoingControls(), haituoSyncChatPreview(), wasHidden !== !!settings.hideTranslationBox && (panel?.remove(), panel = null, findComposer() && showPanel(findComposer()));
    } catch {}
}

async function saveSettings(e) {
    const revision = ++haituoSaveRevision;
    for (const [key, value] of Object.entries(e)) haituoPendingSettings.set(key, { revision, value });
    Object.prototype.hasOwnProperty.call(e, "hideTranslationBox") && (panelPreferencePendingUntil = Date.now() + 3000);
    settings = { ...settings, ...e };
    applyChatColor(); applyTranslatorTheme(); haituoSyncOutgoingControls();
    const operation = haituoSaveQueue.then(() => ipcRenderer.invoke("caisheng:set-translation-config", e));
    haituoSaveQueue = operation.catch(() => {});
    try { await operation; }
    catch (error) {
        for (const key of Object.keys(e)) if (haituoPendingSettings.get(key)?.revision === revision) haituoPendingSettings.delete(key);
        await refreshSettings();
        toast(`设置保存失败：${error instanceof Error ? error.message : String(error)}`, !0);
        return !1;
    }
    for (const key of Object.keys(e)) if (haituoPendingSettings.get(key)?.revision === revision) haituoPendingSettings.delete(key);
    haituoSyncOutgoingControls();
    return !0;
}

function isWhatsApp() {
    return /(^|\.)web\.whatsapp\.com$/i.test(location.hostname);
}

function isTelegram() {
    return /(^|\.)web\.telegram\.org$/i.test(location.hostname);
}

// Telegram translation ships OFF: every translation surface stays dormant until
// the user turns on "Telegram 翻译" in HaiTuo settings.
function webTranslationActive() {
    return isWhatsApp() || (isTelegram() && settings.telegramTranslationEnabled === !0);
}

function composerHost(e) {
    if (!(e instanceof Element)) return null;
    if (e.closest("footer")) return e.closest("footer");
    return isTelegram() ? e.closest(".input-container,.input-message-container,.input-field,.chat-input-container,.chat") : null;
}

function isTelegramGroupChat() {
    if (!isTelegram()) return !1;
    if (document.querySelector(".bubbles .peer-title")) return !0;
    const status = document.querySelector(".topbar .person .status,.topbar .status,.person .status");
    return /(?:成员|members?|订阅者|subscribers?)/iu.test(String(status?.textContent || ""));
}

function isWhatsAppGroupConversation() {
    const metas = document.querySelectorAll('#main [data-pre-plain-text]');
    for (let i = metas.length - 1; i >= 0 && i >= metas.length - 40; i -= 1) {
        const meta = metas[i];
        if (meta.closest('.message-out')) continue;
        const body = meta.querySelector('.selectable-text,[data-testid="selectable-text"],[data-testid="msg-text"]');
        if (!body) continue;
        const author = [ ...meta.querySelectorAll('span[dir="auto"]') ].find(span => {
            if (span.closest('.selectable-text,[data-testid="selectable-text"],[data-testid="msg-text"],[data-testid="quoted-message"]')) return !1;
            if (span.closest('[data-testid*="forward" i],[data-icon*="forward" i]')) return !1;
            return !!String(span.textContent || "").trim();
        });
        if (author) return !0;
    }
    return !1;
}

function isGroupConversation() {
    if (isTelegram()) return isTelegramGroupChat();
    if (isWhatsApp()) return isWhatsAppGroupConversation();
    return !1;
}

// 群组回译 governs group chats; 接收回译 governs one-to-one chats.
function incomingTranslationOn() {
    return ((isGroupConversation() ? settings.groupBackTranslationEnabled : settings.autoTranslateIncoming) !== !1) && webTranslationActive();
}

function recentMessageNodes() {
    const selector = isTelegram() ? '.bubbles [data-mid],.bubbles .bubble' : '[data-testid="msg-container"],.message-in,.message-out';
    return [ ...document.querySelectorAll(selector) ];
}

function editable(e) {
    return e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLElement && e.isContentEditable;
}

function usableComposer(e) {
    if (!editable(e) || !e.isConnected || !composerHost(e)) return !1;
    const t = e.getBoundingClientRect(), n = getComputedStyle(e);
    return t.width > 80 && t.height > 10 && n.display !== "none" && n.visibility !== "hidden";
}

function composerFrom(e) {
    if (!(webTranslationActive() && e instanceof Element)) return null;
    const t = e.closest('[contenteditable="true"],[contenteditable="plaintext-only"],textarea,input');
    return t && usableComposer(t) ? t : null;
}

function findComposer() {
    const e = composerFrom(document.activeElement);
    if (e) return e;
    const selector = isTelegram()
        ? 'footer textarea,footer input,footer [contenteditable="true"],.input-message-input[contenteditable="true"],.input-field [contenteditable="true"],.chat-input-container [contenteditable="true"]'
        : 'footer textarea,footer input,footer [contenteditable="true"][role="textbox"],footer [contenteditable="plaintext-only"][role="textbox"],footer [data-lexical-editor="true"][contenteditable="true"],footer [contenteditable="true"]';
    const t = [ ...document.querySelectorAll(selector) ].filter(usableComposer);
    return t.sort((e, t) => t.getBoundingClientRect().bottom - e.getBoundingClientRect().bottom)[0] || null;
}

let clipboardImagePasteBusy = !1;

async function readClipboardImageFile() {
    const payload = await ipcRenderer.invoke("caisheng:read-clipboard-image");
    if (!payload?.base64) return null;
    const bytes = Uint8Array.from(atob(payload.base64), e => e.charCodeAt(0));
    return new File([ bytes ], payload.name || "haituo-clipboard.png", {
        type: payload.type || "image/png",
        lastModified: Date.now()
    });
}

document.addEventListener("paste", event => {
    if (!webTranslationActive() || clipboardImagePasteBusy) return;
    const composer = composerFrom(event.target) || findComposer();
    if (!composer || event.clipboardData?.files?.length || [ ...event.clipboardData?.items || [] ].some(e => "file" === e.kind)) return;
    const hasText = !!String(event.clipboardData?.getData("text/plain") || event.clipboardData?.getData("text/html") || "").trim();
    hasText || (event.preventDefault(), event.stopPropagation());
    setTimeout(async () => {
        try {
            const file = await readClipboardImageFile();
            if (!file) return;
            const transfer = new DataTransfer();
            transfer.items.add(file), clipboardImagePasteBusy = !0;
            composer.focus(), composer.dispatchEvent(new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: !0,
                cancelable: !0,
                composed: !0
            }));
        } catch {} finally {
            clipboardImagePasteBusy = !1;
        }
    }, 0);
}, !0);

let telegramChineseApplied = !1;

function localizeTelegramLogin() {
    if (!isTelegram()) return;
    document.documentElement.lang = "zh-CN";
    const chineseLink = [ ...document.querySelectorAll("button,a,[role=button]") ].find(e => /使用简体中文继续/.test(String(e.textContent || "")));
    if (chineseLink && !telegramChineseApplied) {
        telegramChineseApplied = !0, chineseLink.click();
        return;
    }
    const exact = new Map([ [ "Sign in to Telegram", "登录 Telegram" ], [ "Please confirm your country code and enter your phone number.", "请确认国家/地区代码并输入手机号码。" ], [ "Country", "国家/地区" ], [ "Phone Number", "手机号码" ], [ "NEXT", "下一步" ], [ "LOG IN BY QR CODE", "使用二维码登录" ], [ "LOG IN BY PASSKEY", "使用通行密钥登录" ] ]);
    for (const node of document.querySelectorAll("h1,h2,h3,p,label,button,a,span")) {
        const source = String(node.textContent || "").replace(/\s+/g, " ").trim(), replacement = exact.get(source);
        replacement && node.children.length === 0 && (node.textContent = replacement);
    }
}

localizeTelegramLogin(), document.addEventListener("DOMContentLoaded", localizeTelegramLogin, {
    once: !0
}), setInterval(localizeTelegramLogin, 1e3);

function read(e) {
    return (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : e.innerText).replace(/\u00a0/g, " ").replace(/[\u200b-\u200d\ufeff]/g, "");
}

function normalized(e) {
    return e.replace(/\s+/gu, " ").trim();
}

function clearComposer(e) {
    if (e.focus(), e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
        const t = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, n = Object.getOwnPropertyDescriptor(t, "value")?.set;
        if (!n) throw new Error("无法清空输入框");
        n.call(e, "");
        e.dispatchEvent(new InputEvent("input", {
            bubbles: !0,
            composed: !0,
            inputType: "deleteContentBackward",
            data: null
        }));
        return;
    }
    const t = getSelection(), n = document.createRange();
    n.selectNodeContents(e), t.removeAllRanges(), t.addRange(n), e.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: !0,
        composed: !0,
        cancelable: !0,
        inputType: "deleteContentBackward",
        data: null
    })), document.execCommand("delete", !1), read(e).trim() && (e.replaceChildren(), 
    e.dispatchEvent(new InputEvent("input", {
        bubbles: !0,
        composed: !0,
        inputType: "deleteContentBackward",
        data: null
    })));
}

function write(e, t) {
    if (e.focus(), e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
        const n = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, o = Object.getOwnPropertyDescriptor(n, "value")?.set;
        if (!o) throw new Error("无法同步输入框状态");
        return o.call(e, t), e.dispatchEvent(new InputEvent("input", {
            bubbles: !0,
            composed: !0,
            inputType: "insertText",
            data: t
        })), void e.dispatchEvent(new Event("change", {
            bubbles: !0,
            composed: !0
        }));
    }
    const n = getSelection(), o = document.createRange();
    o.selectNodeContents(e), n.removeAllRanges(), n.addRange(o);
    if (document.execCommand("insertText", !1, t) && read(e).trim() === t.trim() || (e.textContent = t, 
    e.dispatchEvent(new InputEvent("input", {
        bubbles: !0,
        composed: !0,
        inputType: "insertReplacementText",
        data: null
    }))), read(e).trim() === `${t}${t}`.trim()) {
        const o = document.createRange();
        o.selectNodeContents(e), n.removeAllRanges(), n.addRange(o), document.execCommand("insertText", !1, t);
    }
}

function toast(e, t = !1) {
    document.getElementById("haituo-translation-toast")?.remove();
    const n = document.createElement("div");
    n.id = "haituo-translation-toast", n.textContent = e, Object.assign(n.style, {
        position: "fixed",
        right: "20px",
        bottom: "82px",
        zIndex: 2147483647,
        padding: "10px 16px",
        borderRadius: "8px",
        color: "#fff",
        background: t ? "#c63d3d" : "#202a3b"
    }), document.body.append(n), setTimeout(() => n.remove(), 2600);
}

async function copyTranslationText(e, label = "译文") {
    const t = String(e || "").trim();
    if (!t) return;
    try {
        await navigator.clipboard.writeText(t);
    } catch {
        const e = document.createElement("textarea");
        e.value = t, e.style.position = "fixed", e.style.opacity = "0", document.body.append(e), e.select(), document.execCommand("copy"), e.remove();
    }
    toast(`${label}已复制`);
}

function selectedPageText() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount < 1) return "";
    return String(selection.toString() || "");
}

document.addEventListener("keydown", e => {
    if (!("c" === String(e.key || "").toLowerCase() && (e.ctrlKey || e.metaKey) && !e.altKey)) return;
    if (isWhatsApp() && haituoLocalBilingualView?.isActive()) return;
    const text = selectedPageText();
    if (!text) return;
    e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation(), copyTranslationText(text, "所选文字");
}, !0);

function translationAction(e, t, n, icon = "📋") {
    const o = document.createElement("button");
    return o.type = "button", o.textContent = icon, o.title = t, o.setAttribute("aria-label", t), Object.assign(o.style, {
        margin: "0",
        padding: "0",
        width: "30px",
        minWidth: "30px",
        height: "28px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "0",
        borderRadius: "6px",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        userSelect: "none",
        fontSize: "16px",
        lineHeight: "1"
    }), [ "pointerdown", "mousedown", "mouseup", "dblclick" ].forEach(e => o.addEventListener(e, e => {
        e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation();
    }, !0)), o.addEventListener("click", e => {
        e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation(), n(e);
    }, !0), o;
}

async function translate(e) {
    const t = e.trim();
    if (!HAN.test(t)) return t;
    const n = await ipcRenderer.invoke("caisheng:translate", {
        text: t,
        targetLanguage: settings.targetLanguage || "en",
        provider: settings.inputTranslationProvider || "google-free",
        purpose: "input"
    });
    if (!n || "string" != typeof n.text || !n.text.trim()) throw new Error("翻译服务未返回结果");
    return polishOutgoingEnglish(t, n.text.trim());
}

function polishOutgoingEnglish(source, text) {
    if (!HAN.test(source) || !/^[\x00-\x7f\s\p{P}]+$/u.test(text)) return text;
    let value = text.replace(/^It is\b/u, "It's").replace(/^I am\b/u, "I'm").replace(/^I will\b/u, "I'll").replace(/^You are\b/u, "You're").replace(/^We are\b/u, "We're").replace(/\bdo not\b/giu, "don't").replace(/\bcannot\b/giu, "can't").replace(/\bwill not\b/giu, "won't");
    /^又是(?:一个|个)?/u.test(source) && (value = value.replace(/^It's\s+another\s+/iu, "Another ").replace(/^It is\s+another\s+/iu, "Another "));
    return value;
}

async function translateMessage(e, t = !1, messageId, attachmentOnly = !1) {
    const content = String(e || "").replace(/https?:\/\/\S+|www\.\S+/giu, " ");
    const han = (content.match(/\p{Script=Han}/gu) || []).length;
    const latin = (content.match(/[a-z]+(?:['’][a-z]+)?/giu) || []).length;
    const n = han > latin ? settings.targetLanguage || "en" : "zh-CN", context = recentMessageNodes().slice(-10).map(node => String(node.innerText || node.textContent || "").trim()).filter(Boolean).join("\n").slice(-6000), o = await ipcRenderer.invoke("caisheng:translate", {
        text: e,
        targetLanguage: n,
        provider: t ? "smart-retranslate" : settings.chatTranslationProvider || "google-free",
        purpose: "chat",
        localMessageRecord: isWhatsApp() && !!haituoLocalChatConversation(messageId),
        apiKey: settings.apiKey,
        groqApiKey: settings.groqApiKey,
        deepLApiKey: settings.deepLApiKey,
        context,
        forceRefresh: !!t,
        messageId, attachmentOnly
    });
    if (o?.notFound) return "";
    if (!o || "string" != typeof o.text || !o.text.trim()) throw new Error("消息回译失败");
    return o.text.trim();
}

function formatMessageParagraphs(source, translation) {
    const paragraphs = String(source || "").replace(/\r\n/g, "\n").split(/\n\s*\n+/u).map(part => part.trim()).filter(Boolean);
    const output = String(translation || "").trim();
    if (paragraphs.length < 2 || !output) return output;
    const existing = output.split(/\n\s*\n+/u).map(part => part.trim()).filter(Boolean);
    if (existing.length === paragraphs.length) return existing.join("\n\n");
    const lines = output.split(/\n+/u).map(part => part.trim()).filter(Boolean);
    if (lines.length === paragraphs.length) return lines.join("\n\n");
    const flat = output.replace(/\s*\n\s*/gu, " ").trim();
    const candidates = [ ...flat.matchAll(/[。！？；;!?]|\.(?=\s|$)/gu) ].map(match => match.index + match[0].length);
    if (candidates.length < paragraphs.length - 1)
        candidates.push(...[ ...flat.matchAll(/\s+/gu) ].map(match => match.index));
    const sorted = [ ...new Set(candidates) ].sort((a, b) => a - b);
    const total = paragraphs.reduce((sum, part) => sum + part.length, 0);
    let sourceLength = 0, previous = 0;
    const parts = [];
    for (let index = 0; index < paragraphs.length - 1; index += 1) {
        sourceLength += paragraphs[index].length;
        const target = Math.round(flat.length * sourceLength / total);
        const remainingCuts = paragraphs.length - index - 2;
        const remaining = sorted.filter(position => position > previous + 1 && position < flat.length);
        const available = remaining.filter((position, candidateIndex) => remaining.length - candidateIndex - 1 >= remainingCuts);
        if (!available.length) return output;
        const boundary = available.reduce((best, position) => Math.abs(position - target) < Math.abs(best - target) ? position : best);
        parts.push(flat.slice(previous, boundary).trim());
        previous = boundary;
    }
    parts.push(flat.slice(previous).trim());
    return parts.every(Boolean) ? parts.join("\n\n") : output;
}

async function translateVoiceText(e) {
    const targetLanguage = HAN.test(e) ? settings.targetLanguage || "en" : "zh-CN";
    const result = await ipcRenderer.invoke("caisheng:translate", { text: e, targetLanguage, provider: settings.chatTranslationProvider || "google-free", purpose: "chat" });
    if (!result || "string" != typeof result.text || !result.text.trim()) throw new Error("语音文字翻译未返回结果");
    return result.text.trim();
}

function showBackTranslationText(e, t = !1) {
    const n = activeComposer?.isConnected ? activeComposer : findComposer(), o = n?.getBoundingClientRect();
    backTranslationPreview || (backTranslationPreview = document.createElement("div"), backTranslationPreview.id = "haituo-backtranslation-preview", Object.assign(backTranslationPreview.style, {
        position: "fixed",
        zIndex: 2147483647,
        padding: "7px 10px",
        border: "1px solid #f59e0b",
        borderRadius: "9px",
        color: "#fff",
        background: "#232124",
        boxShadow: "0 6px 18px #0005",
        fontSize: "12px",
        lineHeight: "1.35",
        whiteSpace: "pre-wrap",
        maxHeight: "62px",
        overflow: "auto",
        boxSizing: "border-box"
    }), document.body.append(backTranslationPreview));
    const r = Math.max(12, o?.left ?? 22), a = Math.max(12, innerWidth - (o?.right ?? innerWidth - 22));
    backTranslationPreview.style.left = `${r}px`, backTranslationPreview.style.right = `${a}px`, backTranslationPreview.style.width = "auto", backTranslationPreview.style.minHeight = "40px", backTranslationPreview.style.bottom = `${Math.max(68, innerHeight - (o?.top ?? innerHeight - 72) + 7)}px`, backTranslationPreview.style.display = "block", backTranslationPreview.style.borderColor = t ? "#ef4444" : "#f59e0b", backTranslationPreview.textContent = e, backTranslationPreview.classList.add("is-visible"), clearTimeout(backTranslationTimer), backTranslationTimer = t ? setTimeout(hideBackTranslation, 3500) : null;
}

function hideBackTranslation() {
    backTranslationGeneration += 1, backTranslationExpectedText = "", backTranslationOutgoingMatches = 0, backTranslationComposer = null, clearTimeout(backTranslationTimer), clearInterval(backTranslationWatchdog), backTranslationTimer = null, backTranslationWatchdog = null, backTranslationPreview?.remove(), backTranslationPreview = null;
}

function haituoPairQuickComposer(quick, composer, translation) {
    quick && (quick.__haituoPairedComposer = composer ? {
        composer,
        translation: normalized(translation || "")
    } : null);
}

function haituoQuickEmptied(quick) {
    const pair = quick?.__haituoPairedComposer;
    if (quickComposerSyncLock || !pair || String(quick.value || "").trim()) return !1;
    quick.__haituoPairedComposer = null, hideBackTranslation();
    const composer = pair.composer;
    if (!composer?.isConnected) return !1;
    const current = normalized(read(composer));
    if (!current) return !0;
    if (current !== pair.translation) return !1;
    const refocusQuick = document.activeElement === quick;
    haituoWithoutQuickComposerSync(() => clearComposer(composer));
    refocusQuick && quick.isConnected && quick.focus({
        preventScroll: !0
    });
    return !0;
}

function haituoComposerEmptied(composer) {
    if (quickComposerSyncLock || !composer?.isConnected || normalized(read(composer))) return !1;
    const quick = document.getElementById("haituo-whatsapp-quick-input");
    if (!quick || quick.__haituoPairedComposer?.composer !== composer || !String(quick.value || "").trim()) return !1;
    quick.__haituoPairedComposer = null, hideBackTranslation(), quick.value = "";
    return !0;
}

function haituoWithoutQuickComposerSync(action) {
    quickComposerSyncLock += 1;
    try {
        return action();
    } finally {
        quickComposerSyncLock -= 1;
    }
}

let haituoComposerEmptyCheckTimer = 0;
function scheduleComposerEmptyCheck(composer) {
    const deadline = Date.now() + 280;
    clearTimeout(haituoComposerEmptyCheckTimer);
    const tick = () => {
        const current = composer?.isConnected ? composer : findComposer() || activeComposer;
        if (!current || haituoComposerEmptied(current)) return;
        Date.now() < deadline && (haituoComposerEmptyCheckTimer = setTimeout(tick, 40));
    };
    tick();
}

function countMatchingOutgoingMessages(expected) {
    expected = normalized(expected || "");
    if (!expected) return 0;
    const selector = isTelegram() ? ".bubbles .is-out,.bubbles .bubble.is-out" : '[data-testid="msg-container"].message-out,.message-out[data-id],.message-out';
    const messages = [ ...document.querySelectorAll(selector) ].slice(-8);
    return messages.filter(message => normalized(String(message.innerText || message.textContent || "")).includes(expected)).length;
}

function backTranslationWasSent() {
    return !!backTranslationExpectedText && countMatchingOutgoingMessages(backTranslationExpectedText) > backTranslationOutgoingMatches;
}

function hideBackTranslationForSendControl(event) {
    if (!backTranslationPreview || !(event.target instanceof Element)) return;
    const composer = backTranslationComposer?.isConnected ? backTranslationComposer : findComposer() || activeComposer, control = event.target.closest('button,[role="button"],[data-testid="compose-btn-send"],.btn-send');
    if (!control) return;
    const exact = !!control.matches('button[aria-label*="Send" i],button[aria-label*="发送"],button[data-testid="compose-btn-send"],[data-testid="compose-btn-send"],button.btn-send,.btn-send') || !!control.querySelector('span[data-icon="send"],[data-icon="send"],svg[class*="send" i],.icon-send');
    const candidate = composer && sendButtonFor(composer), composerRect = composer?.getBoundingClientRect(), controlRect = control.getBoundingClientRect(), besideComposer = !!composerRect && controlRect.left >= composerRect.right - 24 && controlRect.top < composerRect.bottom + 30 && controlRect.bottom > composerRect.top - 30;
    if (!exact && candidate !== control && !besideComposer) return;
    hideBackTranslation(), setTimeout(hideBackTranslation, 0), setTimeout(hideBackTranslation, 250), setTimeout(hideBackTranslation, 800);
}

function watchBackTranslationComposer() {
    clearInterval(backTranslationWatchdog), backTranslationWatchdog = setInterval(() => {
        if (!backTranslationPreview || !backTranslationExpectedText) return void (clearInterval(backTranslationWatchdog), backTranslationWatchdog = null);
        const composer = backTranslationComposer;
        (!composer?.isConnected || normalized(read(composer)) !== normalized(backTranslationExpectedText) || backTranslationWasSent()) && hideBackTranslation();
    }, 120);
}

async function updateBackTranslation(e, composerHint = null) {
    if (!e?.trim()) return;
    const expected = e.trim(), composer = composerHint?.isConnected ? composerHint : activeComposer?.isConnected ? activeComposer : findComposer();
    if (!composer?.isConnected || normalized(read(composer)) !== normalized(expected)) return hideBackTranslation();
    const generation = ++backTranslationGeneration;
    backTranslationExpectedText = expected, backTranslationOutgoingMatches = countMatchingOutgoingMessages(expected), backTranslationComposer = composer;
    showBackTranslationText("正在回译确认…"), watchBackTranslationComposer();
    try {
        let t;
        try {
            t = await Promise.race([ ipcRenderer.invoke("caisheng:translate", {
                text: e,
                targetLanguage: "zh-CN",
                provider: settings.chatTranslationProvider || "google-free",
                purpose: "chat"
            }), new Promise((e, t) => setTimeout(() => t(new Error("回译线路响应超时")), 1800)) ]);
        } catch {
            t = await ipcRenderer.invoke("caisheng:translate", {
                text: e,
                targetLanguage: "zh-CN",
                provider: "google-free"
            });
        }
        if (generation !== backTranslationGeneration || !backTranslationComposer?.isConnected || normalized(read(backTranslationComposer)) !== normalized(expected)) return hideBackTranslation();
        if (!t?.text?.trim()) throw new Error("回译服务未返回结果");
        showBackTranslationText(`回译：${t.text.trim()}`);
    } catch (e) {
        if (generation !== backTranslationGeneration || !backTranslationComposer?.isConnected || normalized(read(backTranslationComposer)) !== normalized(expected)) return hideBackTranslation();
        showBackTranslationText(`回译失败：${e instanceof Error ? e.message : "请稍后重试"}`, !0);
    }
}

function mediaSendButton() {
    for (const e of [ '[data-testid="media-editor"] button[aria-label*="Send" i]', '[data-testid="media-editor"] [data-icon="send"]', '[role="dialog"] button[aria-label*="Send" i]', '[role="dialog"] [data-icon="send"]' ]) {
        const t = document.querySelector(e), n = t?.closest('button,[role="button"]') || (t instanceof HTMLElement ? t : null);
        if (n) {
            const e = n.getBoundingClientRect(), t = getComputedStyle(n);
            if (e.width > 0 && e.height > 0 && t.display !== "none" && t.visibility !== "hidden") return n;
        }
    }
    return null;
}

function sendButtonFor(e) {
    const m = mediaSendButton();
    if (m) return m;
    const t = composerHost(e) || document;
    const selectors = isTelegram()
        ? [ 'button.btn-send', '.btn-send', 'button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button svg[class*="send" i]', 'button .icon-send' ]
        : [ 'button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[data-testid="compose-btn-send"]', '[data-testid="compose-btn-send"]', 'button span[data-icon="send"]', 'span[data-icon="send"]', '[role="button"] [data-icon="send"]' ];
    for (const selector of selectors) {
        const n = t.querySelector(selector), o = n?.closest('button,[role="button"]') || (n instanceof HTMLElement ? n : null);
        if (o) return o;
    }
    return null;
}

async function settleComposer(e, t, allowChinese = !1) {
    for (let n = 0; n < 40; n += 1) {
        await new Promise(e => setTimeout(e, 25));
        const o = findComposer() || e, a = read(o).trim();
        if ((allowChinese || !HAN.test(a)) && normalized(a) === normalized(t)) return o;
        8 !== n && 20 !== n || haituoWithoutQuickComposerSync(() => {
            clearComposer(o), write(o, t);
        });
    }
    throw new Error("输入状态同步失败，未发送");
}

async function haituoRememberSentSource(original,sentText){if(!isWhatsApp()||normalized(original)===normalized(sentText))return;const room=[...document.querySelectorAll('#main [data-id]')].map(node=>haituoLocalChatConversation(node.getAttribute('data-id'))).find(Boolean);if(!room)return;await ipcRenderer.invoke('haituo:wa-sent-source',{chat:room,original,sentText});}

async function sendOnce(e, t, expectedMode = !!settings.blockChineseOutgoing) {
    const n = recentSends.get(e), o = Date.now();
    if (n && n.text === t && o - n.at < 1500) return !1;
    if (expectedMode !== !!settings.blockChineseOutgoing) throw new Error("发送模式已变化，未发送；请重试");
    if (!e.isConnected || normalized(read(e).trim()) !== normalized(t.trim())) throw new Error("输入内容已变化，未发送");
    recentSends.set(e, { text: t, at: o });
    const button = sendButtonFor(e);
    if (button) button.click();
    else {
        e.focus();
        if (!await ipcRenderer.invoke("caisheng:web-native-send")) throw new Error("无法发送，请使用发送按钮");
    }
    return !0;
}

async function run(e, t = null) {
    t = t || findComposer() || activeComposer;
    if (!t) return;
    if (busy.has(t)) return void toast("正在翻译，请稍候…");
    const n = read(t).trim(), outgoingMode = !!settings.blockChineseOutgoing, direct = e && !outgoingMode;
    if (!n) return;
    const o = `${location.hostname}\0${e ? "send" : "replace"}\0${n}`;
    if (!(recentAction.key === o && Date.now() - recentAction.at < 1800)) {
        recentAction = {
            key: o,
            at: Date.now()
        }, busy.add(t), panel?.querySelectorAll('[data-haituo-translate-action]').forEach(e => e.disabled = !0), toast("正在翻译，请稍候…");
        try {
            const o = direct ? n : await translate(n);
            if (!direct && HAN.test(o)) throw new Error("译文仍含中文，已禁止发送");
            if (!t.isConnected || findComposer() !== t || read(t).trim() !== n || e && outgoingMode !== !!settings.blockChineseOutgoing) throw new Error("消息框已变化，未覆盖或发送；请重试");
            haituoWithoutQuickComposerSync(() => {
                clearComposer(t), write(t, o);
            }), await new Promise(e => setTimeout(e, 40)), t = await settleComposer(t, o, direct);
            if (e && !direct && HAN.test(read(t))) throw new Error("原中文未清除，已停止发送");
            e || void (settings.backTranslationEnabled !== !1 && updateBackTranslation(o, t));
            if(e)await haituoRememberSentSource(n,o);
            if (e && !await sendOnce(t, o, outgoingMode)) return;
            if (e && (await new Promise(e => setTimeout(e, 350)), read(t).trim() === o.trim())) throw new Error("未确认发送，请点击发送按钮");
            toast(e ? direct ? "已发送原文" : "已翻译并发送" : "已翻译并替换"), e && (hidePanels(), hideBackTranslation());
        } catch (e) {
            recentAction = {
                key: "",
                at: 0
            }, toast(e instanceof Error ? e.message : "翻译失败", !0);
        } finally {
            setTimeout(() => busy.delete(t), 350), panel?.querySelectorAll('[data-haituo-translate-action]').forEach(e => e.disabled = !1);
        }
    }
}

function makeInput(e, t, n = "text") {
    const o = document.createElement("label");
    o.style.display = "flex", o.style.gap = "6px", o.append(document.createTextNode(e));
    const a = document.createElement("input");
    return a.type = n, a.value = settings[t] || "", a.onchange = () => {
        saveSettings({
            [t]: a.value
        });
    }, o.append(a), o;
}

function toggleApiSettings() {
    if (settingsPanel) return settingsPanel.remove(), void (settingsPanel = null);
    settingsPanel = document.createElement("div"), settingsPanel.id = "haituo-api-settings", Object.assign(settingsPanel.style, {
        position: "fixed",
        right: "22px",
        bottom: "130px",
        zIndex: 2147483647,
        display: "grid",
        gap: "7px",
        background: "#fff",
        color: "#111",
        border: "1px solid #ccd3da",
        borderRadius: "10px",
        padding: "10px",
        boxShadow: "0 8px 28px #0004",
        minWidth: "360px",
        maxHeight: "min(72vh, 650px)",
        overflowY: "auto"
    });
    const providerOptions = [ [ "google-free", "Google 免费翻译（默认）" ], [ "openai", "OpenAI" ], [ "deepl", "DeepL" ], [ "groq", "Groq AI" ], [ "deepseek", "DeepSeek AI" ], [ "google-cloud", "Google Cloud" ], [ "mymemory", "MyMemory" ], [ "libre", "LibreTranslate" ], [ "microsoft", "微软翻译" ], [ "qwen", "Qwen" ], [ "glm", "GLM" ] ];
    const makeProviderSelect = (label, key, options = providerOptions) => {
        const wrap = document.createElement("label"), select = document.createElement("select");
        wrap.style.display = "grid", wrap.style.gap = "4px", wrap.append(document.createTextNode(label));
        for (const [value, text] of options) { const option = document.createElement("option"); option.value = value, option.textContent = text, select.append(option); }
        select.value = settings[key] || (key === "voiceTranscriptionProvider" ? "groq" : "google-free");
        select.onchange = () => saveSettings({ [key]: select.value });
        return wrap.append(select), wrap;
    };
    const version = document.createElement("div");
    version.innerHTML = "<strong>海拓 1.5.0 翻译设置</strong>", Object.assign(version.style, { padding: "8px 10px", borderRadius: "7px", fontSize: "13px", lineHeight: "1.45" }), settingsPanel.append(version);
    settingsPanel.append(makeProviderSelect("输入翻译服务", "inputTranslationProvider"), makeProviderSelect("聊天翻译服务", "chatTranslationProvider"), makeProviderSelect("语音转文字服务", "voiceTranscriptionProvider", [ [ "groq", "Groq Whisper（默认）" ], [ "openai", "OpenAI Whisper" ], [ "keppl", "Keppl Whisper" ] ]), makeInput("OpenAI API Key", "apiKey", "password"), makeInput("DeepL API Key", "deepLApiKey", "password"), makeInput("Groq API Key", "groqApiKey", "password"), makeInput("Keppl 音转文 API Key", "kepplApiKey", "password"), makeInput("Keppl 音转文地址", "kepplEndpoint"), makeInput("Keppl 音转文模型", "kepplModel"), makeInput("API 地址", "endpoint"), makeInput("模型", "model"), makeInput("区域", "region")), 
    document.body.append(settingsPanel), applyTranslatorTheme();
    const drawerButton = document.createElement("button"), drawer = document.createElement("div"), rows = document.createElement("div"), add = document.createElement("button");
    drawerButton.type = add.type = "button";
    drawerButton.textContent = "▾ 多 API 调度 · 逐条填写";
    drawerButton.setAttribute("aria-expanded", "false");
    Object.assign(drawer.style, { display: "grid", gap: "7px", maxHeight: "0", overflow: "hidden", transition: "max-height 220ms ease" });
    Object.assign(rows.style, { display: "grid", gap: "6px" });
    add.textContent = "＋ 添加 OpenAI 接口";
    const draftProfiles = [ ...(Array.isArray(settings.openaiApiProfiles) ? settings.openaiApiProfiles : []) ];
    const render = () => {
        rows.replaceChildren();
        draftProfiles.forEach((profile, index) => {
            const row = document.createElement("div"), remove = document.createElement("button");
            Object.assign(row.style, { display: "grid", gap: "5px", border: "1px solid #777777", padding: "7px", borderRadius: "8px" });
            for (const [ field, label, type ] of [ [ "apiKey", "API Key", "password" ], [ "endpoint", "API 地址", "text" ], [ "model", "模型", "text" ] ]) {
                const input = document.createElement("input");
                input.type = type;
                input.placeholder = `接口 ${index + 2} · ${label}`;
                input.value = profile[field] || "";
                input.onchange = () => {
                    draftProfiles[index] = { ...draftProfiles[index], [field]: input.value.trim() };
                    if (draftProfiles[index].apiKey) saveSettings({ openaiApiProfiles: draftProfiles.filter(item => item.apiKey) });
                };
                row.append(input);
            }
            remove.type = "button";
            remove.textContent = "删除";
            remove.onclick = () => {
                draftProfiles.splice(index, 1);
                saveSettings({ openaiApiProfiles: draftProfiles.filter(item => item.apiKey) });
                render();
            };
            row.append(remove);
            rows.append(row);
        });
    };
    add.onclick = () => {
        if (draftProfiles.length >= 11) return toast("最多支持 12 个 OpenAI 接口", !0);
        draftProfiles.push({ apiKey: "", endpoint: "", model: "" });
        render();
        rows.lastElementChild?.querySelector("input")?.focus();
    };
    drawerButton.onclick = () => {
        const expanded = drawerButton.getAttribute("aria-expanded") !== "true";
        drawerButton.setAttribute("aria-expanded", String(expanded));
        drawer.style.maxHeight = expanded ? "480px" : "0";
        drawerButton.textContent = `${expanded ? "▴" : "▾"} 多 API 调度 · 逐条填写`;
    };
    render();
    drawer.append(rows, add);
    settingsPanel.insertBefore(drawerButton, settingsPanel.children[5]);
    drawerButton.after(drawer);
}

function hidePanels() {
    if (translatorFooter?.isConnected) translatorFooter.style.removeProperty("margin-bottom");
    translatorFooter = null;
    panel && (panel.style.display = "none"), settingsPanel && (settingsPanel.remove(), 
    settingsPanel = null);
}

function positionTranslator(composer) {
    if (!panel?.isConnected) return;
    composer = composer?.isConnected ? composer : findComposer();
    if (!composer?.isConnected || !usableComposer(composer) || document.querySelector('[data-testid="media-viewer"],[data-testid="media-editor"],[role="dialog"][aria-modal="true"]')) {
        if (panel.style.display !== "none") panel.style.display = "none";
        if (translatorFooter?.style.getPropertyValue("margin-bottom")) translatorFooter.style.removeProperty("margin-bottom");
        return;
    }
    const footer = composer.closest("footer") || composer;
    if (translatorFooter && translatorFooter !== footer && translatorFooter.isConnected)
        translatorFooter.style.removeProperty("margin-bottom");
    translatorFooter = footer;
    // The actual composer footer shrinks when the media/contact sidebar opens.
    const bounds = footer.getBoundingClientRect();
    const left = Math.max(8, bounds.left + 8);
    const right = Math.min(innerWidth - 8, bounds.right - 8);
    if (settings.hideTranslationBox) {
        footer.style.removeProperty("margin-bottom");
        const input = composer.getBoundingClientRect();
        panel.style.setProperty("left", `${Math.min(innerWidth - 46, Math.max(8, right - 43))}px`, "important");
        panel.style.setProperty("right", "auto", "important");
        panel.style.setProperty("bottom", "auto", "important");
        panel.style.setProperty("top", `${Math.max(4, input.top - 43)}px`, "important");
        panel.style.bottom = "auto";
        return;
    }
    panel.style.top = "auto";
    panel.style.left = `${left}px`;
    panel.style.right = "auto";
    panel.style.width = `${Math.max(0, right - left)}px`;
    panel.style.maxWidth = `${Math.max(0, right - left)}px`;
    panel.style.minWidth = "0";
    panel.style.overflow = "auto";
    const expanded = panel.style.display !== "none";
    if (expanded) {
        const height = Math.ceil(panel.getBoundingClientRect().height);
        const margin = `${height + 3}px`;
        if (footer.style.getPropertyValue("margin-bottom") !== margin)
            footer.style.setProperty("margin-bottom", margin, "important");
        panel.style.bottom = `${Math.max(3, innerHeight - footer.getBoundingClientRect().bottom - height)}px`;
    } else {
        footer.style.removeProperty("margin-bottom");
        const rect = footer.getBoundingClientRect();
        panel.style.width = "38px";
        panel.style.left = `${Math.min(innerWidth - 46, Math.max(left, rect.right - 48))}px`;
        panel.style.bottom = `${Math.max(0, innerHeight - rect.top + 2)}px`;
    }
}

function toggleTranslatorPanel(hidden, composer, event) {
    event?.preventDefault();
    event?.stopPropagation();
    settings.hideTranslationBox = hidden;
    localPanelPreference = hidden;
    panelPreferencePendingUntil = Date.now() + 3000;
    panel?.remove();
    panel = null;
    showPanel(findComposer() || composer);
    saveSettings({ hideTranslationBox: hidden }).catch(error => toast(`翻译框收纳保存失败：${error instanceof Error ? error.message : String(error)}`, !0));
}

function showPanel(e) {
    if (!webTranslationActive()) return;
    if (activeComposer = e, panel) return positionTranslator(e);
    panel = document.createElement("div"), panel.id = "haituo-whatsapp-translator", 
    Object.assign(panel.style, {
        position: "fixed",
        right: "22px",
        bottom: "8px",
        zIndex: 2147483647,
        display: "flex",
        flexDirection: "column",
        flexWrap: "nowrap",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: "7px",
        background: (settings.nativeTheme === "light" ? "#ffffff" : "#202020"),
        color: (settings.nativeTheme === "light" ? "#202020" : "#eeeeee"),
        border: "1px solid #777777",
        borderRadius: "10px",
        padding: "8px",
        boxSizing: "border-box",
        width: "min(1100px, calc(100vw - 44px))",
        maxWidth: "calc(100vw - 44px)",
        height: "auto",
        minHeight: "52px",
        boxShadow: "0 8px 28px #0008",
        overflow: "visible"
    });
    if (settings.hideTranslationBox) {
        const restore = document.createElement("button");
        restore.type = "button";
        restore.id = "haituo-wa-translator-toggle";
        restore.textContent = "⌃";
        restore.title = "展开翻译工具栏";
        restore.setAttribute("aria-label", "展开翻译工具栏");
        restore.style.setProperty("all", "initial", "important");
        Object.assign(restore.style, {
            position: "fixed", zIndex: "2147483647", width: "38px", height: "34px",
            borderRadius: "50%", border: "1px solid #306de1", background: "#306de1",
            color: "#ffffff", boxShadow: "0 3px 10px #0006", fontSize: "20px",
            fontWeight: "700", cursor: "pointer", padding: "0", lineHeight: "1"
        });
        for (const [name, value] of Object.entries({ position: "fixed", display: "flex", width: "38px", "min-width": "38px", "max-width": "38px", height: "38px", "min-height": "38px", "max-height": "38px", padding: "0", margin: "0", "border-radius": "50%", "box-sizing": "border-box", "z-index": "2147483647", "background-color": "#306de1", "background-image": "#306de1", color: "#ffffff", "border-color": "#306de1", "align-items": "center", "justify-content": "center" })) restore.style.setProperty(name, value, "important");
        restore.onclick = event => toggleTranslatorPanel(!1, e, event);
        panel = restore;
        document.body.append(panel);
        positionTranslator(e);
        return;
    }
    const t = document.createElement("strong");
    t.textContent = "海拓翻译", Object.assign(t.style, {
        display: "inline-block",
        width: "auto",
        minWidth: "64px",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        margin: "0"
    });
    const n = document.createElement("select");
    n.setAttribute("aria-label", "目标语言"), Object.assign(n.style, {
        display: "inline-block",
        width: "92px",
        minWidth: "92px",
        height: "34px",
        flex: "0 0 92px",
        margin: "0"
    });
    for (const [e, t] of [["zh-CN", "中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["es", "Español"], ["fr", "法语 · Français"], ["de", "德语 · Deutsch"], ["it", "意大利语 · Italiano"], ["pt", "葡萄牙语 · Português"], ["ru", "俄语 · Русский"], ["ar", "阿拉伯语 · العربية"], ["th", "泰语 · ไทย"], ["vi", "越南语 · Tiếng Việt"], ["id", "印尼语 · Indonesia"], ["ms", "马来语 · Melayu"], ["hi", "印地语 · हिन्दी"], ["tr", "土耳其语 · Türkçe"], ["nl", "荷兰语 · Nederlands"], ["pl", "波兰语 · Polski"], ["uk", "乌克兰语 · Українська"]]) {
        const o = document.createElement("option");
        o.value = e, o.textContent = t, n.append(o);
    }
    n.value = settings.targetLanguage || "en", n.onchange = () => {
        saveSettings({
            targetLanguage: n.value
        });
    };
    const o = document.createElement("button");
    o.type = "button", o.textContent = "API 设置", o.onclick = toggleApiSettings;
    const a = document.createElement("button");
    a.type = "button", a.dataset.haituoTranslateAction = "replace", a.textContent = "翻译并替换", a.onclick = () => {
        quick?.value.trim() ? runQuick(!1, !1) : run(!1);
    };
    const s = document.createElement("button");
    s.type = "button", s.dataset.haituoTranslateAction = "send", s.textContent = "翻译并发送", s.onclick = () => {
        quick?.value.trim() ? runQuick(!1, !0) : run(!0);
    };
    for (const e of [ o, a, s ]) Object.assign(e.style, {
        display: "inline-block",
        width: "auto",
        minWidth: "0",
        height: "34px",
        padding: "0 10px",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        margin: "0"
    });
    const i = document.createElement("label"), r = document.createElement("input");
    r.type = "checkbox", r.setAttribute("data-haituo-block-chinese", ""), r.checked = !!settings.blockChineseOutgoing, r.onchange = () => {
        saveSettings({
            blockChineseOutgoing: r.checked
        });
    }, i.append(r, document.createTextNode("禁止直接发送中文")), 
    Object.assign(i.style, {
        display: "inline-flex",
        width: "auto",
        alignItems: "center",
        gap: "4px",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        margin: "0"
    });
    const collapse = document.createElement("button");
    collapse.type = "button", collapse.textContent = "⌄", collapse.title = "收起翻译工具栏", collapse.setAttribute("aria-label", "收起翻译工具栏"), Object.assign(collapse.style, {
        width: "38px",
        height: "38px",
        border: "1px solid #306de1",
        borderRadius: "50%",
        background: "#306de1",
        color: "#ffffff",
        boxShadow: "0 3px 10px #0006",
        fontSize: "18px",
        cursor: "pointer",
        padding: "0"
    }), collapse.onclick = event => {
        toggleTranslatorPanel(!0, e, event);
    };
    const controls = document.createElement("div");
    Object.assign(controls.style, { display: "flex", alignItems: "center", gap: "7px", width: "100%", minWidth: "0" }), controls.append(t, n, o, a, s, i, collapse);
    const quickRow = document.createElement("div"), quick = document.createElement("textarea"), quickTranslate = document.createElement("button"), quickRetranslate = document.createElement("button");
    quick.id = "haituo-whatsapp-quick-input";
    Object.assign(quickRow.style, { display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto auto", gap: "7px", width: "100%" }), Object.assign(quick.style, { minHeight: "42px", maxHeight: "92px", resize: "vertical", borderRadius: "8px", padding: "8px 10px", boxSizing: "border-box" }), quick.placeholder = settings.translateShortcut === "triple-space" ? "输入中文后按 Enter 翻译并填入，确认后回车发送；Shift+Enter 换行；连续三次空格仅翻译" : "输入中文后按 Enter 翻译并填入，确认后回车发送；Shift+Enter 换行";
    quick.addEventListener("input", () => haituoQuickEmptied(quick), !0);
    let quickSpaceCount = 0, quickSpaceAt = 0;
    let quickActionPending = !1;
    const runQuick = async (forceAi, sendAfter = !1) => {
        const source = quick.value.trim(), composer = findComposer() || activeComposer, direct = sendAfter && !forceAi && !settings.blockChineseOutgoing;
        if (!source || !composer || quickActionPending || busy.has(composer)) return;
        const nativeBefore = read(composer), outgoingMode = !!settings.blockChineseOutgoing;
        quickActionPending = !0; busy.add(composer);
        quickTranslate.disabled = quickRetranslate.disabled = a.disabled = s.disabled = !0, toast(direct ? "正在发送原文…" : forceAi ? "正在结合上下文重新翻译…" : "正在翻译…");
        try {
            const context = recentMessageNodes().slice(-10).map(node => String(node.innerText || node.textContent || "").trim()).filter(Boolean).join("\n").slice(-6000), result = direct ? { text: source } : forceAi ? await ipcRenderer.invoke("caisheng:translate", { text: source, targetLanguage: settings.targetLanguage || "en", provider: "smart-retranslate", purpose: "input", apiKey: settings.apiKey, groqApiKey: settings.groqApiKey, deepLApiKey: settings.deepLApiKey, context, forceRefresh: !0 }) : { text: await translate(source) }, translated = String(result?.text || "").trim();
            if (!translated || !direct && HAN.test(translated)) throw new Error("译文仍含中文，未填入消息框");
            if (!composer.isConnected || findComposer() !== composer || read(composer) !== nativeBefore || sendAfter && outgoingMode !== !!settings.blockChineseOutgoing) throw new Error("消息框已变化，未覆盖或发送；请重试");
            haituoWithoutQuickComposerSync(() => {
                clearComposer(composer), write(composer, translated);
            }), await settleComposer(composer, translated, direct), haituoPairQuickComposer(quick, composer, translated);
            if (sendAfter) {
                await haituoRememberSentSource(source,translated);
                if (!await sendOnce(composer, translated, outgoingMode)) throw new Error("发送操作过快，请稍候再试");
                let sent = !1;
                for (let attempt = 0; attempt < 14; attempt += 1) {
                    await new Promise(resolve => setTimeout(resolve, 90));
                    const currentComposer = findComposer() || composer;
                    if (!read(currentComposer).trim()) {
                        sent = !0;
                        break;
                    }
                }
                if (!sent) throw new Error("未确认发送，请点击发送按钮重试");
                const currentQuick = document.getElementById("haituo-whatsapp-quick-input");
                currentQuick && (currentQuick.__haituoPairedComposer = null, currentQuick.value = "", currentQuick.dispatchEvent(new Event("input", {
                    bubbles: !0,
                    composed: !0
                }))), hideBackTranslation(), toast(direct ? "已发送原文" : "已翻译并发送");
            } else (settings.backTranslationEnabled !== !1 ? updateBackTranslation(translated, composer) : void 0), toast("已翻译并自动填入上方输入框");
        } catch (error) {
            toast(error instanceof Error ? error.message : "翻译失败", !0);
        } finally {
            quickActionPending = !1; busy.delete(composer);
            quickTranslate.disabled = quickRetranslate.disabled = a.disabled = s.disabled = !1, sendAfter && setTimeout(() => {
                quick.focus({
                    preventScroll: !0
                }), quick.setSelectionRange(quick.value.length, quick.value.length);
            }, 0);
        }
    };
    quick.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) {
            return event.preventDefault(), event.stopPropagation(), quickSpaceCount = 0, void runQuick(!1, !1);
        }
        const shortcut = settings.translateShortcut || "triple-space", key = String(event.key || "").toLowerCase(), shortcutPressed = shortcut === "alt-t" && event.altKey && !event.ctrlKey && !event.shiftKey && key === "t" || shortcut === "ctrl-shift-t" && event.ctrlKey && event.shiftKey && !event.altKey && key === "t" || shortcut === "ctrl-alt-t" && event.ctrlKey && event.altKey && !event.shiftKey && key === "t";
        if (shortcutPressed && !event.isComposing) return event.preventDefault(), event.stopPropagation(), quickSpaceCount = 0, void runQuick(!1);
        if (shortcut === "triple-space" && (event.key === " " || event.code === "Space") && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            const now = Date.now();
            quickSpaceCount = now - quickSpaceAt < 1200 ? quickSpaceCount + 1 : 1, quickSpaceAt = now;
            if (quickSpaceCount >= 3) return quickSpaceCount = 0, event.preventDefault(), event.stopPropagation(), void runQuick(!1);
            return;
        }
        event.isComposing || event.key === "Process" || (quickSpaceCount = 0);
    }, !0), quickTranslate.type = quickRetranslate.type = "button", quickTranslate.textContent = "翻译", quickRetranslate.textContent = "AI重译", quickRetranslate.title = "AI 重译：结合最近聊天上下文，生成自然口语化译文", quickRetranslate.setAttribute("aria-label", "AI 重译"), quickTranslate.onclick = () => runQuick(!1), quickRetranslate.onclick = () => runQuick(!0);
    for (const button of [ quickTranslate, quickRetranslate ]) Object.assign(button.style, { height: "42px", alignSelf: "stretch", padding: "0 14px", whiteSpace: "nowrap" });
    Object.assign(quickRetranslate.style, { width: "auto", minWidth: "68px", padding: "0 12px", borderRadius: "10px", fontSize: "14px", fontWeight: "700", lineHeight: "1" });
    quickRow.append(quick, quickTranslate, quickRetranslate), panel.append(controls, quickRow), document.body.append(panel), haituoSyncOutgoingControls(), positionTranslator(e);
}

function syncPanel(e) {
    activeComposer = e;
    showPanel(e);
    if (panel) panel.style.display = "flex";
    positionTranslator(e);
}

window.addEventListener("resize", () => positionTranslator(findComposer()));

function clearQuickTranslatorAfterSend() {
    const quick = document.getElementById("haituo-whatsapp-quick-input");
    if (!(quick instanceof HTMLTextAreaElement)) return;
    quick.__haituoPairedComposer = null;
    if (!quick.value) return;
    quick.value = "", quick.dispatchEvent(new InputEvent("input", {
        bubbles: !0,
        composed: !0,
        inputType: "deleteContentBackward",
        data: null
    })), quick.dispatchEvent(new Event("change", {
        bubbles: !0
    })), requestAnimationFrame(() => {
        quick.isConnected && (quick.focus({
            preventScroll: !0
        }), quick.setSelectionRange(0, 0));
    });
}

function watchNativeSendAndClearQuick(composerHint) {
    const composer = composerHint?.isConnected ? composerHint : findComposer() || activeComposer;
    if (!composer || !read(composer).trim()) return;
    clearInterval(quickClearTimer);
    let attempts = 0;
    quickClearTimer = setInterval(() => {
        attempts += 1;
        const current = findComposer() || (composer.isConnected ? composer : null);
        if (!current || !read(current).trim()) {
            clearInterval(quickClearTimer), quickClearTimer = void 0, clearQuickTranslatorAfterSend();
            return;
        }
        attempts >= 25 && (clearInterval(quickClearTimer), quickClearTimer = void 0);
    }, 100);
}

function blockChinese(e, t) {
    if (!t || !HAN.test(read(t))) return !1;
    if (!settings.blockChineseOutgoing) {
        if (Date.now() < chineseConfirmBypassUntil) return !1;
        if (window.confirm("检测到消息中包含中文，确定直接发送吗？")) return chineseConfirmBypassUntil = Date.now() + 1800, !1;
        return e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation(), !0;
    }
    return e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation(), toast("已禁止发送中文，请先翻译。", !0), !0;
}

document.addEventListener("beforeinput", e => {
    const t = composerFrom(e.target);
    if (t && "insertParagraph" === e.inputType && HAN.test(read(t))) blockChinese(e, t);
    t && /^delete/u.test(String(e.inputType || "")) && scheduleComposerEmptyCheck(t);
}, !0), document.addEventListener("focusin", e => {
    const t = composerFrom(e.target);
    t && syncPanel(t);
}, !0), document.addEventListener("input", e => {
    const t = composerFrom(e.target);
    t && (syncPanel(t), haituoComposerEmptied(t), scheduleComposerEmptyCheck(t), backTranslationExpectedText && normalized(read(t)) !== normalized(backTranslationExpectedText) ? hideBackTranslation() : read(t).trim() || hideBackTranslation());
}, !0), document.addEventListener("keyup", e => {
    if ("Backspace" === e.key || "Delete" === e.key) {
        const t = composerFrom(e.target);
        t && scheduleComposerEmptyCheck(t);
    }
}, !0), document.addEventListener("cut", e => {
    const t = composerFrom(e.target);
    t && scheduleComposerEmptyCheck(t);
}, !0), document.addEventListener("click", e => {
    if (!(webTranslationActive() && e.target instanceof Element)) return;
    if (e.target.closest('[data-testid="media-editor"],[role="dialog"]')) return;
    settings.hideTranslationBox || composerFrom(e.target) || panel?.contains(e.target) || settingsPanel?.contains(e.target) || hidePanels();
    if (e.target.closest('button[aria-label*="Send" i],button[aria-label*="发送"],button[data-testid="compose-btn-send"],[data-testid="compose-btn-send"],span[data-icon="send"],button.btn-send,.btn-send')) {
        const composer = findComposer() || activeComposer;
        hideBackTranslation();
        if (blockChinese(e, composer)) return;
        watchNativeSendAndClearQuick(composer), setTimeout(() => {
            const current = findComposer() || activeComposer;
            (!current || !read(current).trim()) && hideBackTranslation();
        }, 250);
    }
}, !0), document.addEventListener("keydown", e => {
    const t = composerFrom(e.target);
    ("Backspace" === e.key || "Delete" === e.key) && t && scheduleComposerEmptyCheck(t);
    if ("Enter" === e.key && !e.shiftKey) {
        const n = mediaSendButton();
        if (n) return;
        hideBackTranslation();
        if (t && HAN.test(read(t))) {
            if (settings.blockChineseOutgoing) {
                e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation();
                return void run(!1);
            }
            return void blockChinese(e, t);
        }
        t && read(t).trim() && watchNativeSendAndClearQuick(t);
    }
    const n = e.key.toLowerCase(), o = settings.translateShortcut || "triple-space", a = "alt-t" === o && e.altKey && !e.ctrlKey && !e.shiftKey && "t" === n || "ctrl-shift-t" === o && e.ctrlKey && e.shiftKey && !e.altKey && "t" === n || "ctrl-alt-t" === o && e.ctrlKey && e.altKey && !e.shiftKey && "t" === n;
    if (t && a) return e.preventDefault(), e.stopImmediatePropagation(), void run(!1);
    const s = settings.refreshShortcut || settings.shortcut || "ctrl-r";
    ("ctrl-r" === s && e.ctrlKey && !e.shiftKey && "r" === n || "ctrl-shift-r" === s && e.ctrlKey && e.shiftKey && "r" === n || "f5" === s && "F5" === e.key) && (e.preventDefault(), 
    e.stopImmediatePropagation(), location.reload());
}, !0), document.addEventListener("pointerdown", hideBackTranslationForSendControl, !0), document.addEventListener("submit", () => hideBackTranslation(), !0);

let spaces = 0, spaceAt = 0, lastUnreadCount = null, lastIncomingKey = "", lastUnreadKey = "", incomingReady = !1, lastNativeNotificationAt = 0, zeroUnreadScans = 0, unreadObserverTimer = 0;

window.addEventListener("haituo-wa-native-notification", () => {
    lastNativeNotificationAt = Date.now();
    const count = isTelegram() ? getTelegramUnreadCount() : getWhatsAppUnreadCount(), workspaceId = process.argv.find(e => e.startsWith("--caisheng-web-workspace="))?.slice("--caisheng-web-workspace=".length);
    ipcRenderer.sendToHost("caisheng:unread-count", { count, increased: !0, incomingChanged: !0, authoritative: count > 0, stableZero: !1, archivedExcluded: !1 });
    workspaceId && ipcRenderer.send("caisheng:web-unread-direct", { id: workspaceId, count, increased: !0, incomingChanged: !0, authoritative: count > 0, stableZero: !1, archivedExcluded: !1 });
    reportWhatsAppUnreadRealtime();
});

function installWhatsAppNotificationBridge() {
    webFrame.executeJavaScript(`(()=>{try{if(window.__haituoNotificationBridge)return;window.__haituoNotificationBridge=true;const notify=()=>window.dispatchEvent(new Event("haituo-wa-native-notification"));if(typeof Notification==="function"){const NativeNotification=Notification;window.Notification=new Proxy(NativeNotification,{construct(target,args,newTarget){notify();return Reflect.construct(target,args,newTarget)},apply(target,thisArg,args){notify();return Reflect.apply(target,thisArg,args)}})}const proto=window.ServiceWorkerRegistration&&ServiceWorkerRegistration.prototype;if(proto&&typeof proto.showNotification==="function"&&!proto.__haituoWrapped){const nativeShow=proto.showNotification;Object.defineProperty(proto,"__haituoWrapped",{value:true});proto.showNotification=function(...args){notify();return nativeShow.apply(this,args)}}}catch(e){}})()`).catch(() => {});
}

function getWhatsAppIncomingKey() {
    if (!isWhatsApp() || isWhatsAppArchivedSurface()) return "";
    const items = [ ...document.querySelectorAll('[data-id^="false_"],[data-testid="msg-container"].message-in,.message-in[data-id],.message-in') ];
    const last = items.at(-1);
    if (!last) return "";
    const id = last.getAttribute("data-id") || last.closest("[data-id]")?.getAttribute("data-id") || last.querySelector("[data-id]")?.getAttribute("data-id") || "";
    const text = String(last.innerText || last.textContent || "").trim().slice(-500);
    return `${id}\u0000${text}`;
}

function isWhatsAppArchivedSurface() {
    if (!isWhatsApp()) return !1;
    if (/(?:^|[\/#?])(archive|archived)(?:[\/#?]|$)/iu.test(`${location.pathname}${location.search}${location.hash}`)) return !0;
    for (const node of document.querySelectorAll('h1,h2,h3,[role="heading"]')) {
        if (!(node instanceof HTMLElement)) continue;
        const text = String(node.innerText || node.textContent || "").replace(/\s+/gu, " ").trim();
        if (!/^(?:已归档(?:的)?(?:聊天)?|归档(?:的)?(?:聊天)?|Archived(?: chats?)?)$/iu.test(text)) continue;
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 110 && style.display !== "none" && style.visibility !== "hidden") return !0;
    }
    return !1;
}

function getWhatsAppUnreadCount() {
    if (!isWhatsApp() || isWhatsAppArchivedSurface()) return 0;
    let directCount = 0;
    for (const e of document.querySelectorAll('button,[role="button"],[aria-label],[data-testid],[data-icon]')) {
        if (!(e instanceof HTMLElement)) continue;
        const text = String(e.innerText || e.textContent || "").replace(/\s+/gu, " ").trim(), rect = e.getBoundingClientRect();
        if (!text || rect.width <= 0 || rect.height <= 0 || rect.width > 180 || rect.height > 70) continue;
        const labelMatch = text.match(/^(?:未读|Unread)\s*(\d{1,4})$/iu) || String(e.getAttribute("aria-label") || "").match(/(?:未读|unread)[^\d]*(\d{1,4})/iu);
        if (labelMatch) directCount = Math.max(directCount, Number(labelMatch[1]));
    }
    const rows = new Map;
    for (const e of document.querySelectorAll('[data-testid="icon-unread-count"],[data-icon="unread-count"],[aria-label*="unread" i],[aria-label*="未读"],[class*="unread" i]')) {
        const marker = `${e.getAttribute?.("aria-label") || ""} ${e.getAttribute?.("data-testid") || ""} ${e.getAttribute?.("data-icon") || ""} ${e.className || ""}`;
        const text = String(e.textContent || "").trim();
        if (!/unread|未读/iu.test(marker) && !/^\d{1,4}$/u.test(text)) continue;
        const t = e.closest('[role="listitem"],[data-testid="cell-frame-container"],div[tabindex="-1"]') || e;
        if (/(?:已归档|Archived)/iu.test(String(t.innerText || t.textContent || ""))) continue;
        const current = rows.get(t), explicit = /unread|未读/iu.test(marker);
        (!current || explicit) && rows.set(t, e);
    }
    let rowCount = 0;
    for (const [e, fallback] of rows) {
        const t = e.querySelector('[data-testid="icon-unread-count"],[data-icon="unread-count"],[aria-label*="unread message" i],[aria-label*="未读消息"]') || fallback;
        const n = `${t.getAttribute?.("aria-label") || ""} ${t.textContent || ""}`.match(/\d+/u);
        rowCount += n ? Math.max(1, Number(n[0])) : 1;
    }
    let visualBadgeCount = 0;
    const pane = document.querySelector("#pane-side");
    if (pane) for (const marker of pane.querySelectorAll("span")) {
        const value = String(marker.textContent || "").trim();
        if (!/^\d{1,4}$/u.test(value)) continue;
        const row = marker.closest('[role="listitem"],[data-testid="cell-frame-container"],[role="row"],div[tabindex="-1"]');
        if (!row || /(?:已归档|Archived)/iu.test(String(row.innerText || row.textContent || ""))) continue;
        const rect = marker.getBoundingClientRect(), style = getComputedStyle(marker), color = style.backgroundColor;
        if (rect.width >= 12 && rect.width <= 42 && rect.height >= 12 && rect.height <= 42 && style.display !== "none" && style.visibility !== "hidden" && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") visualBadgeCount += Number(value);
    }
    let count = Math.max(directCount, rowCount, visualBadgeCount);
    if (!count) {
        const bodyMatch = String(document.body?.innerText || "").match(/(?:^|\n)\s*(?:未读|Unread)\s+(\d{1,4})(?:\s|$)/imu);
        count = bodyMatch ? Number(bodyMatch[1]) : 0;
    }
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function getTelegramUnreadCount() {
    if (!isTelegram()) return 0;
    let count = 0;
    for (const row of document.querySelectorAll(".chatlist-chat,.chatlist .row,[class*='chatlist-chat']")) {
        for (const badge of row.querySelectorAll("[class*='badge' i],[class*='unread' i]")) {
            const value = String(badge.textContent || "").trim();
            if (!/^\d{1,4}$/u.test(value)) continue;
            const rect = badge.getBoundingClientRect(), style = getComputedStyle(badge);
            if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") continue;
            count += Number(value);
            break;
        }
    }
    return count;
}

function getTelegramIncomingKey() {
    if (!isTelegram()) return "";
    const last = [ ...document.querySelectorAll(".bubbles [data-mid]") ].at(-1);
    if (!last) return "";
    return `${last.getAttribute("data-mid") || ""}\u0000${String(last.innerText || last.textContent || "").trim().slice(-500)}`;
}

function getTelegramUnreadKey() {
    if (!isTelegram()) return "";
    const parts = [];
    for (const row of document.querySelectorAll(".chatlist-chat")) {
        const badge = [ ...row.querySelectorAll("[class*='badge' i],[class*='unread' i]") ].find(node => /^\d{1,4}$/u.test(String(node.textContent || "").trim()));
        if (!badge) continue;
        parts.push(`${row.getAttribute("data-mid") || row.innerText?.slice(0, 120) || ""}|${String(badge.textContent || "").trim()}`);
    }
    return parts.join("\n");
}

function webPlatformLabel() {
    return isTelegram() ? "Telegram" : "WhatsApp";
}

function reportWhatsAppUnreadRealtime() {
    if (!(isWhatsApp() || isTelegram())) return;
    clearTimeout(unreadObserverTimer), unreadObserverTimer = setTimeout(() => {
        const count = isTelegram() ? getTelegramUnreadCount() : getWhatsAppUnreadCount(), loaded = !!document.querySelector("#pane-side,[aria-label*='WhatsApp'],[data-testid='chat-list'],.chatlist,.chatlist-container");
        zeroUnreadScans = count === 0 && loaded ? zeroUnreadScans + 1 : 0;
        const increased = lastUnreadCount !== null && count > lastUnreadCount;
        if (count > 0) document.title = `(${count}) ${webPlatformLabel()}`;
        ipcRenderer.sendToHost("caisheng:unread-count", {
            count,
            increased,
            incomingChanged: !1,
            authoritative: !0,
            stableZero: loaded && zeroUnreadScans >= 2,
            archivedExcluded: isWhatsAppArchivedSurface()
        });
        const workspaceId = process.argv.find(e => e.startsWith("--caisheng-web-workspace="))?.slice("--caisheng-web-workspace=".length);
        workspaceId && ipcRenderer.send("caisheng:web-unread-direct", { id: workspaceId, count, increased, authoritative: !0, stableZero: loaded && zeroUnreadScans >= 2, archivedExcluded: isWhatsAppArchivedSurface() });
        lastUnreadCount = count;
    }, 600);
}

function installWhatsAppUnreadObserver() {
    if ((!isWhatsApp() && !isTelegram()) || window.__haituoUnreadObserverInstalled || !document.body) return;
    window.__haituoUnreadObserverInstalled = !0;
    const observer = new MutationObserver(reportWhatsAppUnreadRealtime);
    observer.observe(document.body, { subtree: !0, childList: !0 });
    reportWhatsAppUnreadRealtime();
}

function getWhatsAppUnreadKey() {
    if (!isWhatsApp() || isWhatsAppArchivedSurface()) return "";
    const parts = [];
    for (const row of document.querySelectorAll('#pane-side [role="listitem"],#pane-side [data-testid="cell-frame-container"],#pane-side [role="row"]')) {
        if (/(?:已归档|Archived)/iu.test(String(row.innerText || row.textContent || ""))) continue;
        const markers = [ ...row.querySelectorAll('[data-testid="icon-unread-count"],[data-icon="unread-count"],[aria-label*="unread" i],[aria-label*="未读"],span[dir="auto"]') ].filter(marker => {
            const value = `${marker.getAttribute?.("aria-label") || ""} ${marker.getAttribute?.("data-testid") || ""} ${marker.getAttribute?.("data-icon") || ""} ${marker.textContent || ""}`;
            return /unread|未读/iu.test(value) || /^\s*\d{1,4}\s*$/u.test(marker.textContent || "");
        });
        if (!markers.length) continue;
        parts.push(`${row.getAttribute("data-id") || row.innerText?.slice(0, 120) || ""}|${markers.map(marker => marker.textContent || marker.getAttribute?.("aria-label") || "1").join(",")}`);
    }
    return parts.join("\n");
}

async function getWhatsAppInternalUnreadCount() {
    if (!isWhatsApp()) return 0;
    const value = await webFrame.executeJavaScript(`(()=>{try{
        const number=v=>{v=typeof v==="function"?(()=>{try{return v()}catch{return 0}})():v;v=Number(v);return Number.isFinite(v)&&v>0?Math.floor(v):0};
        const chatId=chat=>String(chat?.id?._serialized||chat?.id?.user||chat?.id||chat?.wid?._serialized||chat?.wid||chat?.__x_id?._serialized||chat?.__x_id||"");
        const unread=chat=>Math.max(number(chat?.unreadCount),number(chat?.__x_unreadCount),number(chat?.unreadMessages),number(chat?.unread));
        const collections=[];
        const add=value=>{if(value&&Array.isArray(value.models)&&value.models.some(chat=>chat&&typeof chat==="object"&&(chat.id||chat.wid||"unreadCount" in chat||"__x_unreadCount" in chat)))collections.push(value)};
        add(window.Store?.Chat);add(window.Store?.ChatCollection);add(window.WWebJS?.Store?.Chat);
        if(!collections.length&&Array.isArray(window.webpackChunkwhatsapp_web_client)){
          window.webpackChunkwhatsapp_web_client.push([["haituo_unread_"+Date.now()],{},req=>{for(const id of Object.keys(req.m||{})){let src="";try{src=String(req.m[id])}catch{}if(!/unreadCount|unreadMessages/.test(src))continue;try{const exp=req(id),queue=[exp,exp?.default];for(const root of queue){if(!root)continue;add(root);for(const item of Object.values(root).slice(0,80))add(item)}}catch{}}}]);
        }
        let aggregate=0;const chats=new Map;
        const archived=chat=>Boolean(chat?.archive||chat?.archived||chat?.isArchived||chat?.__x_archive||chat?.__x_archived||chat?.get?.("archive")||chat?.get?.("archived")||chat?.get?.("isArchived"));
        for(const collection of collections)for(const chat of collection.models||[]){if(archived(chat))continue;const count=unread(chat);if(!count)continue;const id=chatId(chat)||String(chats.size);chats.set(id,Math.max(chats.get(id)||0,count))}
        return [...chats.values()].reduce((sum,count)=>sum+count,0);
    }catch{return 0}})()`).catch(() => 0);
    return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
}

async function automaticallyLoadVoiceAudio(message, trigger) {
    const knownAudio = new Set(document.querySelectorAll("audio"));
    let audio = message.querySelector("audio"), control = trigger?.closest?.('button,[role="button"]') || trigger;
    const activate = async () => {
        if (!(control instanceof HTMLElement)) return;
        const rect = control.getBoundingClientRect();
        try {
            const result = await ipcRenderer.invoke("caisheng:activate-voice-control", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            if (result?.ok) return;
        } catch {}
        const options = { bubbles: !0, cancelable: !0, composed: !0, button: 0, buttons: 1 };
        try { control.dispatchEvent(new PointerEvent("pointerdown", options)); } catch {}
        control.dispatchEvent(new MouseEvent("mousedown", options));
        try { control.dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0 })); } catch {}
        control.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 })), control.click();
    };
    audio || await activate();
    for (let attempt = 0; attempt < 70; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
        const allAudio = [ ...document.querySelectorAll("audio") ];
        audio = message.querySelector("audio") || allAudio.find(e => !knownAudio.has(e) && (e.currentSrc || e.src)) || allAudio.find(e => !e.paused && (e.currentSrc || e.src)) || allAudio.toReversed().find(e => e.currentSrc || e.src);
        if (audio) {
            const source = audio.currentSrc || audio.src || audio.querySelector("source")?.src;
            if (source) return audio;
        }
        attempt === 20 && await activate();
    }
    throw new Error("语音文件自动获取失败，请检查网络后重试");
}

async function fetchVoiceBlob(audio) {
    const source = audio?.currentSrc || audio?.src || audio?.querySelector?.("source")?.src;
    if (source) try {
        const response = await fetch(source, { credentials: "include" });
        if (response.ok) return await response.blob();
    } catch {}
    const result = await webFrame.executeJavaScript(`(async()=>{const list=[...document.querySelectorAll("audio")],audio=list.find(a=>!a.paused&&(a.currentSrc||a.src))||list.reverse().find(a=>a.currentSrc||a.src);if(!audio)return null;const src=audio.currentSrc||audio.src||audio.querySelector("source")?.src;if(!src)return null;const response=await fetch(src);if(!response.ok)return null;const blob=await response.blob();const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader;reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});return {dataUrl,type:blob.type}})()`).catch(() => null);
    if (!result?.dataUrl && typeof audio?.captureStream === "function" && typeof MediaRecorder === "function") {
        const stream = audio.captureStream(), chunks = [], recorder = new MediaRecorder(stream);
        const done = new Promise((resolve, reject) => (recorder.ondataavailable = event => event.data.size && chunks.push(event.data), recorder.onerror = reject, recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }))));
        recorder.start(250), audio.currentTime = 0, await audio.play(), await Promise.race([ new Promise(resolve => audio.addEventListener("ended", resolve, { once: !0 })), new Promise(resolve => setTimeout(resolve, Math.min(120000, Math.max(5000, 1000 * (Number(audio.duration) || 60) + 1500)))) ]), recorder.state !== "inactive" && recorder.stop();
        const blob = await done;
        if (blob.size) return blob;
    }
    if (!result?.dataUrl) throw new Error("语音文件自动获取失败，请等待语音下载完成后重试");
    const base64 = String(result.dataUrl).split(",")[1] || "", binary = atob(base64), bytes = Uint8Array.from(binary, e => e.charCodeAt(0));
    return new Blob([ bytes ], { type: result.type || "audio/ogg" });
}

function getVoiceMessageMount(message, trigger) {
    let node = trigger?.parentElement, best = message;
    while (node && node !== message) {
        const rect = node.getBoundingClientRect();
        if (!node.matches?.("button,[role=button]") && rect.width >= 180 && rect.height >= 36) best = node;
        node = node.parentElement;
    }
    return best;
}

document.addEventListener("keydown", e => {
    if (composerFrom(e.target) && "triple-space" === (settings.translateShortcut || "triple-space")) if (" " !== e.key && "Space" !== e.code || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.isComposing || 229 === e.keyCode) e.isComposing || "Process" === e.key || (spaces = 0); else {
        const t = Date.now();
        spaces = t - spaceAt < 1200 ? spaces + 1 : 1, spaceAt = t, spaces >= 3 && (spaces = 0, 
        e.preventDefault(), e.stopImmediatePropagation(), run(!1));
    }
}, !0), refreshSettings(), setInterval(() => {
    const domCount = isTelegram() ? getTelegramUnreadCount() : getWhatsAppUnreadCount();
    if (domCount > 0) {
        const expectedTitle = `(${domCount}) ${webPlatformLabel()}`;
        document.title !== expectedTitle && (document.title = expectedTitle), ipcRenderer.sendToHost("caisheng:unread-count", { count: domCount, increased: lastUnreadCount !== null && domCount > lastUnreadCount, incomingChanged: !1, authoritative: !0, stableZero: !1 });
    }
    const t = domCount, incomingKey = isTelegram() ? getTelegramIncomingKey() : getWhatsAppIncomingKey(), unreadKey = isTelegram() ? getTelegramUnreadKey() : getWhatsAppUnreadKey();
        const incomingChanged = incomingReady && (incomingKey && incomingKey !== lastIncomingKey || unreadKey && unreadKey !== lastUnreadKey);
        const e = lastUnreadCount !== null && t > lastUnreadCount || incomingChanged && Date.now() - lastNativeNotificationAt > 2500;
        zeroUnreadScans = t === 0 && !e && !incomingChanged && Date.now() - lastNativeNotificationAt > 6000 ? zeroUnreadScans + 1 : 0;
        ipcRenderer.sendToHost("caisheng:unread-count", {
            count: t,
            increased: e,
            incomingChanged,
            authoritative: !0,
            stableZero: !1,
            archivedExcluded: isWhatsAppArchivedSurface()
    }), lastUnreadCount = t, incomingKey && (lastIncomingKey = incomingKey), unreadKey && (lastUnreadKey = unreadKey), incomingReady = !0, refreshSettings();
}, 1500);

// Own only the message text subtree: expanded text and translation share normal flow.
function haituoWhatsAppTranslationMount(message, roots) {
    let mount = roots.at(-1)?.parentElement;
    while (mount && mount !== message && !roots.every(root => mount.contains(root))) mount = mount.parentElement;
    const metadata = roots.at(-1)?.closest('[data-pre-plain-text]');
    if (metadata && message.contains(metadata) && roots.every(root => metadata.contains(root))) mount = metadata;
    while (mount && mount !== message && /^(inline|contents)$/u.test(getComputedStyle(mount).display)) mount = mount.parentElement;
    if (!mount || !message.contains(mount)) return null;
    for (const root of roots) {
        for (let node = root; node && node !== message; node = node.parentElement) {
            for (const [name, value] of Object.entries({height:'auto','max-height':'none',overflow:'visible','-webkit-line-clamp':'unset'})) node.style.setProperty(name,value,'important');
            if (getComputedStyle(node).display === '-webkit-box') node.style.setProperty('display','block','important');
            // Include outer text wrappers whose fixed height can otherwise clip expanded content.
        }
    }
    // A bounded text flow prevents an inline/grid wrapper from sharing a row with its translation.
    mount.style.setProperty('display','flow-root','important');
    mount.style.setProperty('height','auto','important');
    mount.style.setProperty('max-height','none','important');
    mount.style.setProperty('overflow','visible','important');
    return mount;
}

function haituoWebMessageId(node) {
    return node.getAttribute("data-id") || node.closest("[data-id]")?.getAttribute("data-id") || (isTelegram() ? node.getAttribute("data-mid") : undefined);
}
function haituoCurrentWebMessage(item) {
    return item.e.isConnected && item.e.dataset.haituoTranslationSource === item.n && (!item.target || item.e.dataset.haituoTranslationTarget === item.target) && haituoWebMessageId(item.e) === item.messageId;
}
function haituoLocalChatConversation(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]||null:null}
function haituoInstallLocalChatView(options){return installResident({...options,translate:(text,id)=>translateMessage(text,false,id),enabled:()=>incomingTranslationOn(),installMainWorld:()=>contextBridge.executeInMainWorld({func:function(){(// Runs in the page main world. No IPC, account IDs, source cache or credentials.
function installHooks({document,window}){
 if(window.__haituoWACreationHooks){document.dispatchEvent(new window.CustomEvent('haituo:wa-hooks-ready'));return;}window.__haituoWACreationHooks=true;
 let busy=false;const roots=new Set,own='.ht-translation-slot';
 function visit(value){if(!value||!value.nodeType)return;const element=value.nodeType===1?value:value.parentElement;if(element?.closest(own))return;const items=new Set;if(element?.closest('[data-id]'))items.add(element.closest('[data-id]'));if(element?.matches('[data-id]'))items.add(element);for(const node of value.querySelectorAll?.('[data-id]')||[])items.add(node);for(const node of items)if(node.isConnected&&!node.closest(own))document.dispatchEvent(new window.CustomEvent('haituo:wa-render-node',{detail:node}));}
 function reconcile(values){if(busy)return;busy=true;try{for(const value of values)visit(value);for(const reference of roots){const root=reference.deref();if(!root)roots.delete(reference);else if(root.host.isConnected)visit(root)}}finally{busy=false}}
 function wrap(proto,key){const descriptor=Object.getOwnPropertyDescriptor(proto,key);if(!descriptor?.value)return;Object.defineProperty(proto,key,{...descriptor,value:function(...args){const fragmentNodes=args.flatMap(value=>value?.nodeType===11?[...value.childNodes]:[]);const parent=this.parentNode;const result=Reflect.apply(descriptor.value,this,args);reconcile([this,parent,...args,...fragmentNodes]);return result}})}
 function setter(proto,key){const descriptor=Object.getOwnPropertyDescriptor(proto,key);if(!descriptor?.set)return;Object.defineProperty(proto,key,{...descriptor,set(value){Reflect.apply(descriptor.set,this,[value]);reconcile([this,this.parentNode])}})}
 for(const name of ['appendChild','insertBefore','replaceChild','removeChild'])wrap(window.Node.prototype,name);
 for(const proto of [window.Element.prototype,window.Document.prototype,window.DocumentFragment.prototype])for(const name of ['append','prepend','replaceChildren'])wrap(proto,name);
 for(const proto of [window.Element.prototype,window.CharacterData.prototype])for(const name of ['before','after','replaceWith','remove'])wrap(proto,name);
 for(const name of ['insertAdjacentHTML','setAttribute','removeAttribute'])wrap(window.Element.prototype,name);
 wrap(window.Range.prototype,'insertNode');
 for(const name of ['textContent','nodeValue'])setter(window.Node.prototype,name);
 setter(window.CharacterData.prototype,'data');for(const name of ['innerHTML','outerHTML','className'])setter(window.Element.prototype,name);setter(window.ShadowRoot.prototype,'innerHTML');
 const attach=Object.getOwnPropertyDescriptor(window.Element.prototype,'attachShadow');Object.defineProperty(window.Element.prototype,'attachShadow',{...attach,value:function(options){const root=Reflect.apply(attach.value,this,[options]);if(!this.closest(own))roots.add(new WeakRef(root));return root}});
 const observer=new window.MutationObserver(events=>{const values=[];for(const event of events){if(event.target.nodeType===1&&event.target.closest(own))continue;values.push(event.target,...event.addedNodes||[])}reconcile(values)});
 observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-id','data-pre-plain-text','data-mid','data-timestamp','cid','class']});
 document.dispatchEvent(new window.CustomEvent('haituo:wa-hooks-ready'));reconcile([document]);
})( {document,window});return true}})})}
function installResident({document,window,ipc,targetFor,translate,enabled=()=>true,keepPosition=(_node,work)=>work(),installMainWorld}){
 const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/gu,' ').trim(),memory=new Map,live=new Map,pending=new Map,queue=new Map,hidden=new WeakMap,slots=new WeakMap,rendering=new WeakSet;
 const counters={cacheHits:0,lookups:0,translationRequests:0,hookReady:false,errors:0,firstNodesBeforeHook:0,rehydrates:0,slotReattachments:0};const warmed=new Map;let generation=0,scope='',bytes=0,stopped=false,queued=false,touch=0;
 const own='.ht-translation-slot,.haituo-wa-message-translation,.haituo-voice-result,.haituo-wa-translation-error',quotes='[data-testid*="quoted" i],[aria-label*="Quoted" i],[aria-label*="引用"]';
 const textSelector='.selectable-text,[data-testid="selectable-text"],[data-testid="msg-text"],[data-testid="conversation-text"],[data-pre-plain-text] span[dir="auto"]';
 const byteSize=value=>new window.TextEncoder().encode(JSON.stringify(value)).length;
 const chat=id=>typeof id==='string'?id.match(/^(?:true|false)_([^_]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]:null;
 const key=(room,lang,source)=>JSON.stringify([room,lang,norm(source)]);
 function read(node){if(!node||node.ownerDocument!==document||!node.isConnected)return;const id=node.getAttribute('data-id'),room=chat(id);if(!room)return;
 const selected=[...(node.matches(textSelector)?[node]:[]),...node.querySelectorAll(textSelector)].filter(n=>!n.closest(own)&&!n.closest(quotes));const roots=selected.filter(n=>!selected.some(p=>p!==n&&p.contains(n)));
 const source=roots.map(n=>{const clone=n.cloneNode(true);clone.querySelectorAll(own+','+quotes).forEach(n=>n.remove());return(clone.textContent||'').trim()}).filter(Boolean).join('\n\n').trim();if(!source||source.length>30000)return;
 let mount=roots.at(-1)?.closest('[data-pre-plain-text]')||roots.at(-1)?.parentElement;while(mount&&mount!==node&&!roots.every(root=>mount.contains(root)))mount=mount.parentElement;if(!mount||!node.contains(mount))return;
 const lang=targetFor(source);return{node,id,chat:room,source,lang,roots,mount,key:key(room,lang,source)};}
 function remember(k,value){const old=memory.get(k);if(old)bytes-=old.size;const entry={...value,touched:++touch,hits:old?.hits||0};entry.size=byteSize(entry);memory.set(k,entry);bytes+=entry.size;
 const pinned=new Set([...live].filter(([node])=>node.isConnected).map(([,item])=>item.key));while(memory.size>1000||bytes>8*1024*1024){const candidates=[...memory].filter(([key])=>!pinned.has(key)).sort((a,b)=>a[1].hits-b[1].hits||a[1].touched-b[1].touched);if(!candidates.length)break;const [oldKey,oldValue]=candidates[0];bytes-=oldValue.size;memory.delete(oldKey)}return entry;}
 function forget(k){const old=memory.get(k);if(old)bytes-=old.size;memory.delete(k)}
 function mask(item,on){for(const root of item.roots){if(on&&!hidden.has(root)){hidden.set(root,root.style.visibility);root.style.visibility='hidden'}else if(!on&&hidden.has(root)){root.style.visibility=hidden.get(root);hidden.delete(root)}}}
 function slotFor(item){let state=slots.get(item.node);
 if(state?.key!==item.key){slots.delete(item.node);state?.host.remove();state=undefined}
 if(!state){item.node.querySelectorAll('.ht-translation-slot').forEach(old=>old.remove());const host=document.createElement('div');host.className='ht-translation-slot haituo-wa-message-translation';host.dataset.htSlot='1';Object.assign(host.style,{display:'block',visibility:'visible',textAlign:'right',color:'inherit',userSelect:'none',overflowAnchor:'none',whiteSpace:'pre-wrap',overflowWrap:'anywhere',marginTop:'6px'});host.setAttribute('contenteditable','false');host.setAttribute('aria-hidden','true');state={host,shadow:host.attachShadow({mode:'closed'}),key:item.key,status:''};slots.set(item.node,state)}
 // React may clone a light-DOM slot shell without its closed shadow root.
 for(const other of item.node.querySelectorAll('.ht-translation-slot'))if(other!==state.host)other.remove();
 // A WeakMap entry is not evidence that WhatsApp kept its host in the DOM.
 if(!state.host.isConnected||state.host.parentElement!==item.mount||!item.node.contains(state.host)){item.mount.append(state.host);counters.slotReattachments++}
 return state;
 }
 function render(item,entry){if(stopped||!item.node.isConnected||rendering.has(item.node))return;rendering.add(item.node);try{const state=slotFor(item),status=entry?.state||'unknown';item.node.dataset.haituoTranslationSource=item.source;item.node.dataset.haituoTranslationMessageId=item.id;item.node.dataset.haituoTranslationTarget=item.lang;item.node.dataset.haituoTranslationDone='1';state.host.dataset.htState=status;const hit=status==='hit';if(hit){item.node.setAttribute('data-translation-cache-hit','true');state.host.setAttribute('data-translation-cache-hit','true')}else{item.node.removeAttribute('data-translation-cache-hit');state.host.removeAttribute('data-translation-cache-hit')}
 if(status==='hit'){mask(item,false);if(state.status!=='hit'||state.text!==entry.text){const text=document.createElement('span');text.textContent=entry.text;state.shadow.replaceChildren(text);state.text=entry.text}state.status='hit';return}
 if(status==='empty'||status==='stale'){mask(item,false);state.shadow.replaceChildren();state.status=status;return}
 mask(item,status==='unknown'||status==='error'&&!entry?.originalAllowed);if(state.status===status)return;state.status=status;
 if(status==='error'){const button=document.createElement('button');button.textContent='重试';button.onclick=()=>{forget(item.key);pending.delete(item.key);process(item.node)};state.shadow.replaceChildren(button);return}
 const style=document.createElement('style');style.textContent='@keyframes ht-spin{to{transform:rotate(360deg)}}';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.style.cssText='width:20px;height:20px;animation:ht-spin 1s linear infinite';const circle=document.createElementNS(svg.namespaceURI,'circle');for(const [k,v] of Object.entries({cx:'12',cy:'12',r:'9',fill:'none',stroke:'currentColor','stroke-width':'3','stroke-dasharray':'42 15'}))circle.setAttribute(k,v);svg.append(circle);state.shadow.replaceChildren(style,svg);
 }finally{rendering.delete(item.node)}}
 function update(k,entry){remember(k,entry);for(const [node,item] of live)if(!node.isConnected)live.delete(node);else if(item.key===k){const next=read(node);if(next&&next.key===k)keepPosition(node,()=>render(next,entry))}}
 function scheduleWarm(item){const id=JSON.stringify([item.chat,item.lang]);if(warmed.has(id))return;warmed.set(id,{next:undefined,busy:true});const work=async()=>{try{const page=await ipc.invoke('haituo:wa-cache-warm',{chat:item.chat,lang:item.lang});if(stopped)return;warmed.set(id,{next:page.next,busy:false});for(const row of page.entries||[]){const k=key(item.chat,item.lang,row.source);if(!memory.has(k))update(k,{state:'hit',text:row.text})}}catch{warmed.set(id,{next:undefined,busy:false})}};if(window.requestIdleCallback)window.requestIdleCallback(work,{timeout:3000});else window.setTimeout(work,0);}
 function process(node){if(stopped||!node||rendering.has(node))return;const item=read(node);if(!item){const previous=live.get(node);if(previous)mask(previous,false);live.delete(node);const old=slots.get(node);slots.delete(node);old?.host.remove();node.removeAttribute?.('data-translation-cache-hit');return;}if(!counters.hookReady)counters.firstNodesBeforeHook++;scope=JSON.stringify([item.chat]);for(const [old] of live)if(!old.isConnected)live.delete(old);scheduleWarm(item);live.set(node,item);const cached=memory.get(item.key);
 if(cached?.state==='hit'){cached.hits++;cached.touched=++touch;counters.cacheHits++;render(item,cached);return}
 render(item,cached);if(!cached&&!pending.has(item.key)){queue.set(item.key,item);if(!queued){queued=true;window.queueMicrotask(flushQueue)}}
 }
 async function flushQueue(){queued=false;const items=[...queue.values()];queue.clear();if(stopped||!items.length)return;const token=generation;
 const grouped=new Map;for(const item of items){const group=JSON.stringify([item.chat,item.lang]);if(!grouped.has(group))grouped.set(group,[]);grouped.get(group).push(item)}
 for(const group of grouped.values())for(let start=0;start<group.length;start+=100){const batch=group.slice(start,start+100);for(const item of batch)pending.set(item.key,true);const timer=window.setTimeout(()=>{if(token===generation)for(const item of batch)update(item.key,{state:'error'})},2000);
 try{counters.lookups++;const rows=await ipc.invoke('haituo:wa-cache-lookup',{chat:batch[0].chat,lang:batch[0].lang,sources:batch.map(x=>x.source),outgoing:batch.map(x=>x.id.startsWith('true_'))});if(token!==generation||stopped)continue;
 for(const [index,item] of batch.entries()){const row=rows[index];if(!row||norm(row.source)!==norm(item.source))throw Error('译文响应归属错误');if(row.state==='hit'){update(item.key,{state:'hit',text:row.text});continue}update(item.key,{state:row.state==='stale'?'stale':'empty'});if(enabled(item.source))runTranslation(item,token)}
 }catch{if(token===generation&&!stopped){counters.errors++;for(const item of batch)update(item.key,{state:'error'})}}finally{window.clearTimeout(timer);for(const item of batch)pending.delete(item.key)}}
 }
 async function runTranslation(item,token){if(pending.get(item.key)==='translation')return;pending.set(item.key,'translation');update(item.key,{state:'translating'});counters.translationRequests++;const timer=window.setTimeout(()=>{if(token===generation&&!stopped)update(item.key,{state:'error',originalAllowed:true})},2000);
 try{const result=await translate(item.source,item.id,false);if(token===generation&&!stopped){if(!result?.trim())throw Error('译文为空');update(item.key,{state:'hit',text:result})}}catch{if(token===generation&&!stopped){counters.errors++;update(item.key,{state:'error',originalAllowed:true})}}finally{window.clearTimeout(timer);if(token===generation)pending.delete(item.key)}}
 function onNode(event){process(event.detail)}function onReady(){counters.hookReady=true}
 const onCopy=event=>{const selection=window.getSelection();if(!selection?.rangeCount)return;const parts=[];let touches=false;for(let i=0;i<selection.rangeCount;i++){const range=selection.getRangeAt(i);for(const host of document.querySelectorAll('.ht-translation-slot'))try{if(range.intersectsNode(host))touches=true}catch{}const fragment=range.cloneContents();fragment.querySelectorAll('.ht-translation-slot').forEach(node=>node.remove());parts.push(fragment.textContent||'')}if(touches&&event.clipboardData){event.clipboardData.setData('text/plain',parts.join('\n'));event.preventDefault();event.stopImmediatePropagation()}};
 document.addEventListener('copy',onCopy,true);
 document.addEventListener('haituo:wa-render-node',onNode);document.addEventListener('haituo:wa-hooks-ready',onReady);
 const init=installMainWorld?.();if(init?.catch)init.catch(()=>{counters.errors++});
 for(const node of document.querySelectorAll('#main [data-id]'))process(node);
 let rehydrateFrame=null,rehydrateTimer=null;
 function rehydrateVisible(){if(stopped)return;counters.rehydrates++;for(const [node] of live)if(!node.isConnected)live.delete(node);const height=window.innerHeight||document.documentElement?.clientHeight||0,width=window.innerWidth||document.documentElement?.clientWidth||0;for(const node of document.querySelectorAll('[data-id]')){if(node.closest(own))continue;const box=node.getBoundingClientRect();if(box.width>0&&box.height>0&&box.bottom>=-80&&box.top<=height+80&&box.right>=0&&box.left<=width)process(node)}}
 function scheduleRehydrate(){if(stopped)return;if(rehydrateFrame===null)rehydrateFrame=window.requestAnimationFrame(()=>{rehydrateFrame=null;rehydrateVisible()});if(rehydrateTimer!==null)window.clearTimeout(rehydrateTimer);rehydrateTimer=window.setTimeout(()=>{rehydrateTimer=null;rehydrateVisible()},100)}
 // Observe actual DOM in the isolated preload as well as synchronous main-world
 // hooks. Removed hosts, node reuse and connected text edits must not depend on
 // a cross-world CustomEvent arriving for every DOM operation.
 const residentObserver=new window.MutationObserver(records=>{if(stopped)return;const candidates=new Set;let changed=false;for(const record of records){const target=record.target.nodeType===1?record.target:record.target.parentElement;if(target?.closest(own))continue;if(record.type==='childList'&&!record.removedNodes.length&&record.addedNodes.length&&[...record.addedNodes].every(node=>node.nodeType===1&&node.matches(own)))continue;changed=true;for(let node=target?.closest('[data-id]');node;node=node.parentElement?.closest('[data-id]'))candidates.add(node);for(const added of record.addedNodes||[]){if(added.nodeType===1&&added.matches('[data-id]'))candidates.add(added);for(const node of added.querySelectorAll?.('[data-id]')||[])candidates.add(node)}}if(!changed)return;for(const node of candidates)process(node);scheduleRehydrate()});
 residentObserver.observe(document,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['data-id','data-pre-plain-text','class']});
 const onWheel=()=>scheduleRehydrate(),onScrollEnd=()=>{rehydrateVisible();scheduleRehydrate()};
 const onScroll=event=>{rehydrateVisible();scheduleRehydrate();const root=event.target;if(!root||!root.clientHeight||root.scrollTop>root.clientHeight*2)return;for(const [id,page] of warmed){if(page.busy||page.next===null||page.next===undefined)continue;const [room,lang]=JSON.parse(id);page.busy=true;ipc.invoke('haituo:wa-cache-warm',{chat:room,lang,before:page.next}).then(next=>{if(stopped)return;warmed.set(id,{next:next.next,busy:false});for(const row of next.entries||[]){const k=key(room,lang,row.source);if(!memory.has(k))update(k,{state:'hit',text:row.text})}}).catch(()=>{page.busy=false})}};
 document.addEventListener('scroll',onScroll,true);document.addEventListener('wheel',onWheel,{capture:true,passive:true});document.addEventListener('scrollend',onScrollEnd,true);
 const flush=()=>ipc.invoke('haituo:wa-cache-flush').catch(()=>{});window.addEventListener('pagehide',flush);const visibility=()=>{if(document.hidden)flush()};document.addEventListener('visibilitychange',visibility);
 return{isActive:()=>!stopped,isManaged:()=>!stopped,counters,rehydrate:rehydrateVisible,refreshTargets(){generation++;for(const [node,item] of live){mask(item,false);slots.get(node)?.host.remove()}live.clear();pending.clear();queue.clear();for(const node of document.querySelectorAll('#main [data-id]'))process(node)},async observe(){for(const node of document.querySelectorAll('#main [data-id]'))process(node)},async refresh(id){for(const [node,item] of live)if(item.id===id){forget(item.key);pending.delete(item.key);process(node)}},showError(_error,id){for(const item of live.values())if(item.id===id)update(item.key,{state:'error'})},destroy(){stopped=true;generation++;residentObserver.disconnect();if(rehydrateFrame!==null)window.cancelAnimationFrame(rehydrateFrame);if(rehydrateTimer!==null)window.clearTimeout(rehydrateTimer);document.removeEventListener('wheel',onWheel,true);document.removeEventListener('scrollend',onScrollEnd,true);document.removeEventListener('scroll',onScroll,true);document.removeEventListener('copy',onCopy,true);document.removeEventListener('haituo:wa-render-node',onNode);document.removeEventListener('haituo:wa-hooks-ready',onReady);window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',visibility);for(const item of live.values()){mask(item,false);item.node.removeAttribute('data-translation-cache-hit');slots.get(item.node)?.host.remove()}memory.clear();live.clear();pending.clear()}};
}


// Runs in the page main world. No IPC, account IDs, source cache or credentials.
function installHooks({document,window}){
 if(window.__haituoWACreationHooks){document.dispatchEvent(new window.CustomEvent('haituo:wa-hooks-ready'));return;}window.__haituoWACreationHooks=true;
 let busy=false;const roots=new Set,own='.ht-translation-slot';
 function visit(value){if(!value||!value.nodeType)return;const element=value.nodeType===1?value:value.parentElement;if(element?.closest(own))return;const items=new Set;if(element?.closest('[data-id]'))items.add(element.closest('[data-id]'));if(element?.matches('[data-id]'))items.add(element);for(const node of value.querySelectorAll?.('[data-id]')||[])items.add(node);for(const node of items)if(node.isConnected&&!node.closest(own))document.dispatchEvent(new window.CustomEvent('haituo:wa-render-node',{detail:node}));}
 function reconcile(values){if(busy)return;busy=true;try{for(const value of values)visit(value);for(const reference of roots){const root=reference.deref();if(!root)roots.delete(reference);else if(root.host.isConnected)visit(root)}}finally{busy=false}}
 function wrap(proto,key){const descriptor=Object.getOwnPropertyDescriptor(proto,key);if(!descriptor?.value)return;Object.defineProperty(proto,key,{...descriptor,value:function(...args){const fragmentNodes=args.flatMap(value=>value?.nodeType===11?[...value.childNodes]:[]);const parent=this.parentNode;const result=Reflect.apply(descriptor.value,this,args);reconcile([this,parent,...args,...fragmentNodes]);return result}})}
 function setter(proto,key){const descriptor=Object.getOwnPropertyDescriptor(proto,key);if(!descriptor?.set)return;Object.defineProperty(proto,key,{...descriptor,set(value){Reflect.apply(descriptor.set,this,[value]);reconcile([this,this.parentNode])}})}
 for(const name of ['appendChild','insertBefore','replaceChild','removeChild'])wrap(window.Node.prototype,name);
 for(const proto of [window.Element.prototype,window.Document.prototype,window.DocumentFragment.prototype])for(const name of ['append','prepend','replaceChildren'])wrap(proto,name);
 for(const proto of [window.Element.prototype,window.CharacterData.prototype])for(const name of ['before','after','replaceWith','remove'])wrap(proto,name);
 for(const name of ['insertAdjacentHTML','setAttribute','removeAttribute'])wrap(window.Element.prototype,name);
 wrap(window.Range.prototype,'insertNode');
 for(const name of ['textContent','nodeValue'])setter(window.Node.prototype,name);
 setter(window.CharacterData.prototype,'data');for(const name of ['innerHTML','outerHTML','className'])setter(window.Element.prototype,name);setter(window.ShadowRoot.prototype,'innerHTML');
 const attach=Object.getOwnPropertyDescriptor(window.Element.prototype,'attachShadow');Object.defineProperty(window.Element.prototype,'attachShadow',{...attach,value:function(options){const root=Reflect.apply(attach.value,this,[options]);if(!this.closest(own))roots.add(new WeakRef(root));return root}});
 const observer=new window.MutationObserver(events=>{const values=[];for(const event of events){if(event.target.nodeType===1&&event.target.closest(own))continue;values.push(event.target,...event.addedNodes||[])}reconcile(values)});
 observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-id','data-pre-plain-text','data-mid','data-timestamp','cid','class']});
 document.dispatchEvent(new window.CustomEvent('haituo:wa-hooks-ready'));reconcile([document]);
}


let haituoLocalBilingualView;
if(isWhatsApp()){haituoLocalBilingualView=haituoInstallLocalChatView({document,window,ipc:ipcRenderer,targetFor:haituoMessageTarget,keepPosition:haituoKeepTranslationPosition});ipcRenderer.send('haituo-wa-preload-ready',{hooksReady:haituoLocalBilingualView.counters.hookReady});}
function haituoMessageTarget(text) {
    const value=String(text).replace(/https?:\/\/\S+|www\.\S+/giu,` `);
    return (value.match(/\p{Script=Han}/gu)||[]).length > (value.match(/[a-z]+(?:['’][a-z]+)?/giu)||[]).length ? settings.targetLanguage || `en` : `zh-CN`;
}
function haituoInstallMessageScanner() {
    if (window.__haituoMessageScannerInstalled) return;
    window.__haituoMessageScannerInstalled = true;
    let e;
    if(isWhatsApp()) haituoLocalBilingualView ||= haituoInstallLocalChatView({document,window,ipc:ipcRenderer,targetFor:haituoMessageTarget,keepPosition:haituoKeepTranslationPosition,copyText:copyTranslationText,retranslate:(text,id)=>translateMessage(text,true,id)});
    installWhatsAppNotificationBridge(), installWhatsAppUnreadObserver();
    refreshSettings().then(() => {
        const e = findComposer();
        e && syncPanel(e);
    });
    let regionScanBusy = !1;
    const t = async () => {
        if (regionScanBusy) return;
        regionScanBusy = !0;
        try {
        applyWhatsAppMessageAppearance();
        const messageCandidates = isTelegram()
            ? [...document.querySelectorAll('.bubbles [data-mid],.bubbles .bubble')].map(node => node.closest('[data-mid]') || node)
            : [...document.querySelectorAll('[data-testid="msg-container"],#main .message-in,#main .message-out,#main [data-id]')]
                .map(node => node.closest('[data-id],.message-in,.message-out') || node);
        const visibleMessages = [ ...new Set(messageCandidates) ].filter(e => {
            const t = e.getBoundingClientRect();
            return t.width > 0 && t.height > 0 && t.bottom > 72 && t.top < innerHeight - 86;
        }).slice(-24);
        for (const e of visibleMessages) {
            const voiceTrigger = e.querySelector('audio,button[aria-label*="voice" i],button[aria-label*="audio" i],button[aria-label*="语音"],button[aria-label*="播放"],[data-icon*="audio-play" i],[data-icon*="ptt" i],[data-testid*="audio" i],[data-testid*="voice" i],[class*="icon-voice" i],.bubble.is-voice');
            if (voiceTrigger && webTranslationActive() && !voiceProcessed.has(voiceTrigger) && !e.querySelector(".haituo-voice-transcribe,.haituo-voice-result")) {
                voiceProcessed.add(voiceTrigger);
                const voiceMount = getVoiceMessageMount(e, voiceTrigger);
                const voice = document.createElement("button");
                voice.type = "button", voice.className = "haituo-voice-transcribe", voice.textContent = "语音转文字并翻译";
                Object.assign(voice.style, { display: "block", marginTop: "6px", border: "0", background: "transparent", color: "inherit", textDecoration: "underline", cursor: "pointer" });
                voice.onclick = async event => {
                    event.preventDefault(), event.stopPropagation(), voice.disabled = !0, voice.textContent = "识别中…";
                    let muteAcquired=false;
                    try {
                        await ipcRenderer.invoke("caisheng:capture-voice-media",{muteOnly:true});muteAcquired=true;
                        const control = voiceTrigger.closest?.('button,[role="button"]') || voiceTrigger, rect = control.getBoundingClientRect();
                        let captured = null;
                        try { if(!e.querySelector("audio[src],audio source[src]"))captured = await ipcRenderer.invoke("caisheng:capture-voice-media", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }); } catch {}
                        let bytes, mimeType;
                        if (captured?.ok && captured.bytes?.length) bytes = new Uint8Array(captured.bytes), mimeType = captured.mimeType || "audio/ogg";
                        else {
                            const audio = await automaticallyLoadVoiceAudio(e, voiceTrigger), blob = await fetchVoiceBlob(audio);
                            bytes = new Uint8Array(await blob.arrayBuffer()), mimeType = blob.type || audio.getAttribute("type") || "audio/ogg";
                        }
                        const extension = /webm/iu.test(mimeType) ? "webm" : /mp4|m4a/iu.test(mimeType) ? "m4a" : /mpeg|mp3/iu.test(mimeType) ? "mp3" : /wav/iu.test(mimeType) ? "wav" : "ogg";
                        const result = await ipcRenderer.invoke("caisheng:transcribe-audio", { bytes, mimeType, fileName: `voice.${extension}` });
                        voice.textContent = "翻译中…";
                        const translated = await translateVoiceText(result.text);
                        const output = document.createElement("div"), transcript = document.createElement("div"), translation = document.createElement("div"), voiceActions = document.createElement("span");
                        output.className = "haituo-voice-result", Object.assign(output.style, { display: "grid", gap: "5px", width: "100%", maxWidth: "420px", boxSizing: "border-box", marginTop: "7px", padding: "9px 11px", borderRadius: "10px", background: "rgba(255,255,255,.46)", border: "1px solid rgba(127,127,127,.22)", userSelect: "text", cursor: "text", whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: "1.45" }), transcript.textContent = `原文：${result.text}`, translation.textContent = `译文：${translated}`;
                        Object.assign(voiceActions.style, { display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap", width: "max-content", marginTop: "3px", marginRight: "34px", transform: "translateY(-1px)", userSelect: "none" }), voiceActions.append(translationAction("原文", "复制语音转写原文", event => {
                            copyTranslationText(result.text, "原文");
                        }, "📄"), translationAction("译文", "复制语音译文", event => {
                            copyTranslationText(translated, "译文");
                        }, "🌐")), output.append(transcript, translation, voiceActions);
                        voice.replaceWith(output);
                    } catch (error) {
                        voice.disabled = !1, voice.textContent = "失败，点击重试", voice.title = error instanceof Error ? error.message : "语音翻译失败", toast(error instanceof Error ? error.message : "语音识别失败", !0);
                    } finally {
                        if(muteAcquired){
                            const pause=e.querySelector('button[aria-label*="pause" i],button[aria-label*="暂停"],[data-icon*="audio-pause" i],[data-icon*="ptt-pause" i]');
                            try{(pause?.closest('button,[role="button"]')||pause)?.click()}catch{}
                            await webFrame.executeJavaScript(`(()=>{document.querySelectorAll('audio,video').forEach(media=>{try{media.pause()}catch{}})})()`).catch(()=>{});
                            await ipcRenderer.invoke("caisheng:capture-voice-media",{muteOnly:false}).catch(()=>{});
                        }
                    }
                }, voiceMount.append(voice);
            }
            
        }
        const quoteSelector = isTelegram() ? '.reply,.reply-media,.quiz,.poll' : '[data-testid*="quoted" i],[data-testid="quote"],[data-testid="quoted-message"],[aria-label*="Quoted" i],[aria-label*="引用"]';
        const isQuoted = node => Boolean(node.closest(quoteSelector));
        const textRootSelector = isTelegram()
            ? '.translatable-message,.bubble .message[dir="auto"]'
            : '.selectable-text,[data-testid="selectable-text"],[data-testid="msg-text"],[data-testid="conversation-text"],[data-pre-plain-text] span[dir="auto"]';
        const translationTargets = [], localRecords = [];
        for (const e of visibleMessages) {
            // One chat bubble is one translation job. Nested selectable spans and
            // paragraph breaks must not produce separate translations.
            const more = [ ...e.querySelectorAll('button,[role="button"],span') ].find(node =>
                /^(?:查看更多|显示更多|Read more|See more)$/iu.test(node.textContent?.trim() || "") &&
                !node.closest(".haituo-wa-message-translation") && !isQuoted(node));
            if (more) {
                more.click();
                continue;
            }
            const candidates = [ ...e.querySelectorAll(textRootSelector) ]
                .filter(node => node instanceof HTMLElement && !isQuoted(node) && !node.closest(".haituo-wa-message-translation,.haituo-voice-result,.haituo-wa-translation-error"));
            const roots = candidates.filter(node => !candidates.some(parent => parent !== node && parent.contains(node)));
            const n = roots.map(node => {
                if (!node.querySelector(quoteSelector)) return node.innerText?.trim() || "";
                const copy=node.cloneNode(true);copy.querySelectorAll(quoteSelector).forEach(quote=>quote.remove());
                return copy.textContent?.trim() || "";
            }).filter(Boolean).join("\n\n").trim();
            if (!n || /^\d{1,2}:\d{2}$/.test(n) || /^https?:\/\/\S+$/iu.test(n)) continue;
            const messageId = haituoWebMessageId(e);
            if(haituoLocalBilingualView && haituoLocalChatConversation(messageId)) localRecords.push({id:messageId,source:n,metadata:e.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || ``});
            if (!webTranslationActive()) continue;
            if (e.dataset.haituoTranslationSource !== n || e.dataset.haituoTranslationMessageId !== (messageId || "") || e.dataset.haituoTranslationTarget !== haituoMessageTarget(n)) {
                e.querySelectorAll(".haituo-wa-message-translation").forEach(node => node.remove());
                e.dataset.haituoTranslationSource = n;
                e.dataset.haituoTranslationMessageId = messageId || "";
                e.dataset.haituoTranslationTarget = haituoMessageTarget(n);
                delete e.dataset.haituoTranslationPending;
                delete e.dataset.haituoTranslationRetryAt;
                delete e.dataset.haituoAttachmentMiss;
                delete e.dataset.haituoTranslationDone;
            }
            const mount = haituoWhatsAppTranslationMount(e, roots);
            if (e.dataset.haituoTranslationDone === "1" && (haituoLocalBilingualView?.isActive() || e.querySelector(".haituo-wa-message-translation"))) continue;
            if (!incomingTranslationOn() && e.dataset.haituoAttachmentMiss === "1") continue;
            if (e.dataset.haituoTranslationPending === "1" || Number(e.dataset.haituoTranslationRetryAt || 0) > Date.now()) continue;
            e.dataset.haituoTranslationPending = "1";
            if (!mount || !e.contains(mount)) {
                delete e.dataset.haituoTranslationPending;
                continue;
            }
            if (!incomingTranslationOn() && !messageId) { delete e.dataset.haituoTranslationPending; continue; }
            translationTargets.push({ e, t: e, n, mount, messageId, target:haituoMessageTarget(n), attachmentOnly: !incomingTranslationOn() });
        }
        if(haituoLocalBilingualView && localRecords.length) await haituoLocalBilingualView.observe(localRecords,visibleMessages);
        const applyTranslation = item => {
        if(isWhatsApp() && haituoLocalBilingualView && haituoLocalChatConversation(item.messageId)){if(item.error)haituoLocalBilingualView.showError(item.error,item.messageId);else haituoLocalBilingualView.refresh(item.messageId).catch(error=>toast(error.message,!0));return;}
        haituoKeepTranslationPosition(item.e, () => {
            if (!webTranslationActive()) return;
            const { e, t, n, r, mount } = item;
            const liveId = e.getAttribute("data-id") || e.closest("[data-id]")?.getAttribute("data-id") || (isTelegram() ? e.getAttribute("data-mid") : undefined);
            if (item.messageId !== liveId) return;
            if (e.isConnected && mount?.isConnected && e.dataset.haituoTranslationSource === n) {
                let status = e.querySelector('.haituo-wa-translation-error');
                if (item.error) {
                    if (!status) {
                        status = document.createElement('button'); status.type = 'button';
                        status.className = 'haituo-wa-translation-error';
                        Object.assign(status.style,{display:'block',color:'inherit',background:'transparent',border:'0',padding:'5px 0',cursor:'pointer',fontSize:'12px'});
                        status.onclick = event => { event.preventDefault(); event.stopPropagation(); delete e.dataset.haituoTranslationRetryAt; scan(); };
                        mount.append(status);
                    }
                    status.textContent = '翻译失败，自动重试中 · 点击重试'; status.title = item.error;
                } else status?.remove();
            }
            if (!t || !r || !e.isConnected || !t.isConnected || !mount?.isConnected || !e.contains(mount) || e.dataset.haituoTranslationSource !== n || e.querySelector(".haituo-wa-message-translation")) return;
            const o = document.createElement("div");
            o.className = "haituo-wa-message-translation", Object.assign(o.style, {
                display: "block",
                position: "static",
                clear: "both",
                width: "100%",
                maxWidth: "100%",
                height: "auto",
                boxSizing: "border-box",
                borderTop: "1px solid #ffffff66",
                marginTop: "6px",
                paddingTop: "6px",
                fontSize: "13px",
                lineHeight: "1.35",
                opacity: "0.92",
                overflowAnchor: "none",
                userSelect: "text",
                cursor: "text",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere"
            });
            const translationText = document.createElement("span"), actions = document.createElement("span");
            Object.assign(translationText.style, { display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
            Object.assign(actions.style, { display: "flex", alignItems: "center", gap: "7px", whiteSpace: "nowrap", width: "max-content", marginTop: "5px", marginRight: "34px", transform: "translateY(-1px)", userSelect: "none" }), translationText.textContent = formatMessageParagraphs(n, r), actions.append(translationAction("原文", "复制原文", event => {
                copyTranslationText(n, "原文");
            }, "📄"), translationAction("译文", "复制译文", event => {
                copyTranslationText(translationText.textContent, "译文");
            }, "🌐")), o.append(translationText, actions), mount.append(o);
                const retryButton = document.createElement("button");
                retryButton.type = "button", retryButton.textContent = "✨", retryButton.title = "AI 重译：忠实原意，不做口语化改写", retryButton.setAttribute("aria-label", "AI 重译"), Object.assign(retryButton.style, {
                    margin: "0",
                    width: "28px",
                    minWidth: "28px",
                    height: "28px",
                    padding: "0",
                    border: "0",
                    borderRadius: "50%",
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    userSelect: "none",
                    fontSize: "17px",
                    lineHeight: "1"
                }), retryButton.onclick = async t => {
                    t.preventDefault(), t.stopPropagation();
                    const a = t.currentTarget;
                    a.disabled = !0, a.textContent = "…";
                    try {
                        translationText.textContent = formatMessageParagraphs(n, await translateMessage(n, !0, item.messageId)), a.textContent = "✨";
                    } catch (e) {
                        toast(e instanceof Error ? e.message : "智能重新翻译失败", !0), a.textContent = "✨";
                    } finally {
                        a.disabled = !1;
                    }
                }, actions.append(retryButton);
        });

        };
        const translated = [], queue = translationTargets.slice(0, 24);
        let queueIndex = 0;
        const worker = async () => {
            while (queueIndex < queue.length) {
                const item = queue[queueIndex++];
                try {
                    item.r = await translateMessage(item.n, !1, item.messageId, item.attachmentOnly);
                    if (haituoCurrentWebMessage(item)) {
                        item.t.dataset.haituoTranslationDone = "1";
                        if (!item.r && item.attachmentOnly) item.t.dataset.haituoAttachmentMiss = "1";
                        delete item.t.dataset.haituoTranslationRetryCount;
                        delete item.t.dataset.haituoTranslationRetryAt;
                    }
                } catch (error) {
                    item.error = error instanceof Error ? error.message : String(error);
                    const retry = Math.min(3, Number(item.t.dataset.haituoTranslationRetryCount || 0) + 1);
                    if (haituoCurrentWebMessage(item)) item.t.dataset.haituoTranslationRetryCount = String(retry), item.t.dataset.haituoTranslationRetryAt = String(Date.now() + [ 0, 600, 1500, 3500 ][retry]);
                } finally {
                    if (haituoCurrentWebMessage(item)) delete item.t.dataset.haituoTranslationPending;
                }
                applyTranslation(item);
            }
        };
        regionScanBusy = !1;
        await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
        } finally {
            regionScanBusy = !1;
        }
    };
    const scan = () => t().catch(error => console.error('HaiTuo message scan failed', error));
    setInterval(scan, 2000);
    document.addEventListener('scroll', () => { clearTimeout(e); e = setTimeout(scan, 120); }, true);
    new MutationObserver(records => {
        if (records.every(record => record.target instanceof Element && record.target.closest(".haituo-wa-message-translation,.haituo-wa-translation-error,.haituo-voice-result,#haituo-whatsapp-translator,#haituo-backtranslation-preview,#haituo-local-bilingual-chat"))) return;
        clearTimeout(e), e = setTimeout(() => {
            const e = findComposer();
            if (backTranslationComposer) {
                if (backTranslationWasSent() || !e || normalized(read(e)) !== normalized(backTranslationExpectedText)) hideBackTranslation(); else if (e !== backTranslationComposer) {
                    backTranslationComposer = e, activeComposer = e;
                    const text = backTranslationPreview?.textContent || "正在回译确认…";
                    showBackTranslationText(text, text.startsWith("回译失败"));
                }
            }
            e ? syncPanel(e) : hidePanels(), scan();
        }, 60);
    }).observe(document.documentElement, {
        attributes: !0, attributeFilter: ["data-id", "data-mid"], characterData: !0,
        childList: !0,
        subtree: !0
     }), scan();
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', haituoInstallMessageScanner, {once:true});
else haituoInstallMessageScanner();

let haituoTranslatorLayoutFrame = 0;
const haituoScheduleTranslatorLayout = () => {
    if (haituoTranslatorLayoutFrame) return;
    haituoTranslatorLayoutFrame = requestAnimationFrame(() => {
        haituoTranslatorLayoutFrame = 0;
        positionTranslator(findComposer());
    });
};
function haituoObserveTranslatorLayout() {
if (!document.documentElement) return;
new MutationObserver(records => {
    if (document.querySelector('[data-testid="media-viewer"],[data-testid="media-editor"],[role="dialog"][aria-modal="true"]')) positionTranslator(findComposer());
    if (records.some(record => !record.target.closest?.('#haituo-whatsapp-translator,#haituo-api-settings,footer,style'))) haituoScheduleTranslatorLayout();
}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});
}
if (document.documentElement) haituoObserveTranslatorLayout();
else document.addEventListener('DOMContentLoaded',haituoObserveTranslatorLayout,{once:true});

// HAITUO_CHAT_PREVIEW_START
function haituoInstallChatHoverPreview({ document, window, translate, delayMs = 650 }) {
    const rows = isTelegram()
        ? '.chatlist .chatlist-chat,.chatlist-chat,.chatlist a[href],[class*="chatlist-chat"]'
        : '#pane-side [role="row"],#pane-side [role="listitem"],#pane-side [data-testid="cell-frame-container"],[data-testid="chat-list"] [role="row"],[aria-label="Chat list"] [role="row"],[aria-label="聊天列表"] [role="row"]';
    const cache = new Map(), pending = new Map(), nativeTitles = new Map();
    let active, snapshot, timer, popup, sequence = 0, observer;
    const textOf = node => {
        const visible = String(node?.innerText || node?.textContent || '');
        const held = nativeTitles.get(node);
        const title = node?.getAttribute('title') || (held?.visible === visible ? held.title : '');
        return String(title || visible).replace(/\u200e|\u200f/gu, '').trim();
    };
    function read(row) {
        if (isTelegram()) {
            const name = String(row.querySelector('.peer-title')?.textContent || '').replace(/\u200e|\u200f/gu, '').trim();
            const node = row.querySelector('.row-subtitle,.subtitle,.dialog-subtitle,[class*="subtitle" i]');
            const text = String(node?.textContent || '').replace(/\u200e|\u200f/gu, '').trim();
            if (!name || !text) return null;
            // 草稿与"正在输入"属于未发送内容，不进悬停翻译。
            if (/^(?:草稿|draft|正在输入|输入中|typing|录制语音|recording)/iu.test(text)) return null;
            return { text, name, node, key: name + '\0' + text };
        }
        const heading = row.querySelector('[data-testid="cell-frame-title"], [data-testid="cell-frame-primary"] [title], [data-testid="cell-frame-primary"], [role="gridcell"] span[title]') || row.querySelector('span[title]');
        const name = textOf(heading);
        const secondary = row.querySelector('[data-testid="cell-frame-secondary"], [data-testid="chat-list-subtitle"]');
        let node = [...nativeTitles.keys()].find(el => secondary?.contains(el)) || secondary?.querySelector('span[title],span[dir="auto"],[dir="auto"]') || secondary;
        if (!node) node = [...row.querySelectorAll('span[title]'),...nativeTitles.keys()].filter(el => row.contains(el) && el !== heading && !heading?.contains(el) && textOf(el) !== name && !/^\d{1,2}:\d{2}$|^\d+$/u.test(textOf(el))).at(-1);
        const text = textOf(node);
        return text ? { text, name, node, key: name + '\0' + text } : null;
    }
    const valid = (row, data, id) => sequence === id && active === row && row.isConnected && read(row)?.key === data.key;

    // ---- Unread accumulation -------------------------------------------
    // Both WhatsApp Web and Telegram Web keep only the LAST message in each
    // chat-list row. Opening a chat to read the rest would send read
    // receipts, so instead every snippet change observed while the app runs
    // is accumulated per chat (bounded, session-scoped). On hover the row's
    // unread badge decides how many of the recorded messages to show; when
    // fewer were observed than the badge reports, the popup says so instead
    // of pretending. No click, focus, navigation or read receipt is ever
    // issued here.
    const MAX_MESSAGES = 8, MAX_SNIPPETS = 16, HISTORY_KEY = 'haituo-unread-preview-v1';
    const history = new Map();
    try {
        const saved = JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) || '[]');
        for (const [key, entry] of Array.isArray(saved) ? saved : []) {
            if (typeof key !== 'string' || !entry || !Array.isArray(entry.texts)) continue;
            if (Date.now() - Number(entry.updatedAt || 0) > 24 * 60 * 60 * 1000) continue;
            const texts = entry.texts.filter(item => item && typeof item.text === 'string' && item.text).map(item => ({ text: item.text.slice(0, 4000), at: Number(item.at || 0) }));
            if (texts.length) history.set(key, { texts: texts.slice(-MAX_SNIPPETS), updatedAt: Number(entry.updatedAt || 0) });
        }
    } catch {}
    function saveHistory() {
        try {
            const saved = [...history.entries()].slice(-40).map(([key, entry]) => [key, { texts: entry.texts.slice(-MAX_SNIPPETS), updatedAt: entry.updatedAt }]);
            window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(saved));
        } catch {}
    }
    const chatKey = (row, name) => String(row.getAttribute?.('data-id') || row.getAttribute?.('data-peer-id') || row.getAttribute?.('data-chat-id') || name || '').replace(/\u200e|\u200f/gu, '').trim();
    function unreadCount(row) {
        // Returns >0 for a numeric or dot badge, 0 only when we can see there
        // is no unread badge at all. A badge we cannot parse counts as 1.
        if (isTelegram()) {
            const badges = row.querySelectorAll('.unread,.dialog-badge,[class*="unread" i],[class*="badge" i]');
            let seen = false;
            for (const el of badges) {
                const text = String(el.textContent || '').trim();
                if (!text) continue;
                seen = true;
                const count = Number(text.replace(/[^\d]/gu, ''));
                if (Number.isFinite(count) && count > 0) return count;
            }
            return seen ? 1 : 0;
        }
        const labels = [row.getAttribute('aria-label') || '', ...[...row.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label') || '')].join(' ');
        const match = labels.match(/(?:unread|未读)[^\d]{0,16}(\d{1,4})/iu) || labels.match(/(\d{1,4})[^\d]{0,16}(?:unread|未读)/iu);
        if (match && Number(match[1]) > 0) return Number(match[1]);
        let seen = false;
        for (const el of row.querySelectorAll('[data-testid="icon-unread-count"],[data-icon="unread-count"],[aria-label*="unread" i],[aria-label*="未读" i]')) {
            const text = String(el.textContent || '').trim().replace(/[^\d]/gu, '');
            seen = true;
            const count = Number(text);
            if (Number.isFinite(count) && count > 0) return count;
        }
        return seen ? 1 : 0;
    }
    function remember(row, data, count) {
        const key = chatKey(row, data.name);
        if (!key) return;
        const entry = history.get(key) || { texts: [], updatedAt: 0 };
        const text = String(data.text || '').slice(0, 4000);
        entry.updatedAt = Date.now();
        history.set(key, entry);
        if (!text || entry.texts.at(-1)?.text === text) return;
        entry.texts.push({ text, at: entry.updatedAt });
        if (entry.texts.length > MAX_SNIPPETS) entry.texts.splice(0, entry.texts.length - MAX_SNIPPETS);
        saveHistory();
    }
    function messagesFor(row, data) {
        const unread = unreadCount(row), entry = history.get(chatKey(row, data.name));
        // No unread badge: this is a read chat, so preview only its latest
        // message instead of replaying stale unread history.
        if (!unread) return { texts: [data.text], unread: 0, missing: 0 };
        let texts = entry ? entry.texts.map(item => item.text) : [];
        if (!texts.length || texts.at(-1) !== data.text) texts.push(data.text);
        texts = texts.slice(-Math.min(unread, MAX_MESSAGES));
        return { texts: texts.filter(Boolean), unread, missing: unread > texts.length ? unread - texts.length : 0 };
    }
    let observedList, listObserver, rootObserver, scanTimer;
    function scanList() {
        const list = document.querySelector(isTelegram() ? '.chatlist' : '#pane-side,[aria-label="Chat list"],[aria-label="聊天列表"]');
        if (!list) return;
        for (const row of list.querySelectorAll(rows)) {
            const data = read(row);
            if (!data) continue;
            const unread = unreadCount(row);
            if (unread > 0) remember(row, data, unread);
            else history.delete(chatKey(row, data.name));
        }
    }
    const scheduleScan = () => { if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = undefined; scanList(); }, 150); };
    if (document.documentElement) {
        rootObserver = new window.MutationObserver(() => {
            const list = document.querySelector(isTelegram() ? '.chatlist' : '#pane-side,[aria-label="Chat list"],[aria-label="聊天列表"]');
            if (list && list !== observedList) {
                listObserver?.disconnect();
                listObserver = new window.MutationObserver(scheduleScan);
                listObserver.observe(list, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });
                observedList = list;
            }
            if (list) scheduleScan();
        });
        rootObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });
        scheduleScan();
    }

    function position() {
        if (!popup || !active) return;
        const box = active.getBoundingClientRect(), width = Math.min(420, window.innerWidth - 24);
        popup.style.width = width + 'px';
        const left = box.right + width + 12 <= window.innerWidth ? box.right + 8 : Math.max(12, window.innerWidth - width - 12);
        popup.style.left = left + 'px';
        popup.style.top = Math.max(12, Math.min(box.top, window.innerHeight - popup.getBoundingClientRect().height - 12)) + 'px';
    }
    function hide() {
        sequence++; clearTimeout(timer); timer = undefined;
        observer?.disconnect(); observer = undefined;
        for (const [node, held] of nativeTitles) if (node.isConnected && !node.hasAttribute('title') && String(node.innerText || node.textContent || '') === held.visible) node.setAttribute('title',held.title);
        nativeTitles.clear();
        active = undefined; snapshot = undefined;
        popup?.remove(); popup = undefined;
    }
    function create(data, messages) {
        // Replace only the native preview title while our bilingual tooltip is visible.
        // No clicks, focus, navigation, or read receipts are issued.
        const title = data.node?.getAttribute('title');
        if (title) { nativeTitles.set(data.node,{title,visible:String(data.node.innerText || data.node.textContent || '')}); data.node.removeAttribute('title'); }
        if (popup) popup.remove();
        popup = document.createElement('section'); popup.id = 'haituo-whatsapp-chat-preview';
        popup.setAttribute('role', 'tooltip'); popup.setAttribute('aria-label', '未读消息双语预览');
        Object.assign(popup.style, { position:'fixed', zIndex:'2147483647', boxSizing:'border-box', padding:'12px', borderRadius:'10px', border:'1px solid #52616b', background:'#202c33', color:'#e9edef', boxShadow:'0 6px 24px #0006', font:'14px/1.5 system-ui,sans-serif', maxHeight:'min(70vh,560px)', overflow:'auto', textAlign:'left' });
        const header = document.createElement('div');
        header.textContent = data.name || '未读消息';
        Object.assign(header.style, { fontWeight:'700', marginBottom:'8px', display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' });
        if (messages.unread > 0) {
            const badge = document.createElement('span'); badge.textContent = messages.unread + ' 条未读';
            Object.assign(badge.style, { color:'#0b141a', background:'#25d366', borderRadius:'999px', padding:'1px 7px', fontSize:'12px', fontWeight:'600' });
            header.append(badge);
        }
        popup.append(header);
        const boxes = [];
        messages.texts.forEach((text, index) => {
            const item = document.createElement('div');
            Object.assign(item.style, { marginBottom:'8px', paddingBottom:'8px', borderBottom:'1px solid #2f3b43' });
            if (messages.texts.length > 1) {
                const number = document.createElement('span');
                number.textContent = String(index + 1) + '.';
                Object.assign(number.style, { color:'#55d6b0', fontSize:'12px', fontWeight:'700', marginRight:'5px' });
                item.append(number);
            }
            const source = document.createElement('div'); source.className = 'haituo-chat-preview-source'; source.textContent = text;
            Object.assign(source.style, { color:'#8696a0', whiteSpace:'pre-wrap', overflowWrap:'anywhere', maxHeight:'12vh', overflowY:'auto', fontSize:'12px' });
            const target = document.createElement('div'); target.className = 'haituo-chat-preview-translation'; target.textContent = '正在翻译…';
            Object.assign(target.style, { whiteSpace:'pre-wrap', overflowWrap:'anywhere', maxHeight:'22vh', overflowY:'auto', userSelect:'text', marginTop:'2px' });
            item.append(source, target);
            popup.append(item);
            boxes.push(target);
        });
        if (messages.missing > 0) {
            // Be explicit rather than pretending: older unread messages exist
            // only inside the conversation, which cannot be opened without
            // sending a read receipt.
            const note = document.createElement('div');
            note.textContent = '还有 ' + messages.missing + ' 条更早的未读消息只能打开会话查看；海拓不会自动打开会话，以免发送已读回执。';
            Object.assign(note.style, { color:'#f0b866', fontSize:'12px', lineHeight:'1.4', marginTop:'2px' });
            popup.append(note);
        }
        popup.addEventListener('pointerleave', e => { if (!active?.contains(e.relatedTarget)) hide(); });
        // Preview interactions never bubble into WhatsApp's chat-row navigation.
        popup.addEventListener('click', e => e.stopPropagation());
        (document.body || document.documentElement).append(popup); position();
        return boxes;
    }
    async function load(row, data, id) {
        if (!valid(row,data,id)) return;
        const messages = messagesFor(row, data);
        const boxes = create(data, messages);
        for (let i = 0; i < messages.texts.length; i += 1) {
            const text = messages.texts[i];
            if (cache.has(text)) { boxes[i].textContent = cache.get(text); position(); continue; }
            try {
                // One outstanding preview request per account; fast hovering must not fill the API queue.
                if (pending.size) await Promise.allSettled([...pending.values()]);
                if (!valid(row,data,id)) return;
                if (!pending.has(text)) {
                    const task = Promise.resolve().then(() => translate(text)).then(result => {
                        const translated=String(typeof result === 'string' ? result : result?.text || '').trim();
                        if (!translated) throw Error('empty preview');
                        cache.set(text,translated); if(cache.size>128)cache.delete(cache.keys().next().value); return translated;
                    }).finally(() => pending.delete(text));
                    pending.set(text,task);
                }
                const translated=await pending.get(text);
                if (!valid(row,data,id)) return;
                boxes[i].textContent=translated;
                position();
            } catch {
                if (!valid(row,data,id)) return;
                boxes[i].textContent='暂时无法翻译，请移开鼠标后再次悬停重试';
                position();
            }
        }
    }
    function start(row) {
        const data=read(row); if(!data){hide();return;}
        if(active===row && snapshot?.key===data.key)return;
        hide();active=row;snapshot=data;const id=sequence;
        observer=new window.MutationObserver(() => {
            if(!row.isConnected){hide();return;}
            if(read(row)?.key!==snapshot?.key)start(row);
        });
        observer.observe(row,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','data-id']});
        timer=setTimeout(() => load(row,data,id),delayMs);
    }
    const over=e=>{const row=e.target?.closest?.(rows);if(row)start(row);};
    const out=e=>{if(active && !active.contains(e.relatedTarget) && !popup?.contains(e.relatedTarget))hide();};
    const close=e=>{if(!popup?.contains(e.target))hide();};
    const key=e=>{if(e.key==='Escape')hide();};
    const visible=()=>{if(document.hidden)hide();};
    document.addEventListener('pointerover',over,true);document.addEventListener('pointerout',out,true);
    document.addEventListener('pointerdown',close,true);document.addEventListener('wheel',close,true);document.addEventListener('scroll',close,true);
    document.addEventListener('keydown',key,true);document.addEventListener('visibilitychange',visible);
    window.addEventListener('blur',hide);window.addEventListener('resize',hide);
    return { hide, destroy(){hide();rootObserver?.disconnect();listObserver?.disconnect();if(scanTimer){clearTimeout(scanTimer);scanTimer=undefined}document.removeEventListener('pointerover',over,true);document.removeEventListener('pointerout',out,true);document.removeEventListener('pointerdown',close,true);document.removeEventListener('wheel',close,true);document.removeEventListener('scroll',close,true);document.removeEventListener('keydown',key,true);document.removeEventListener('visibilitychange',visible);window.removeEventListener('blur',hide);window.removeEventListener('resize',hide);} };
}
// HAITUO_CHAT_PREVIEW_END

function haituoChatPreviewWanted() {
    return location.hostname === 'web.whatsapp.com' || (isTelegram() && settings.telegramTranslationEnabled === !0);
}

function haituoSyncChatPreview() {
    if (haituoChatPreviewWanted()) {
        if (!window.__haituoChatPreview) window.__haituoChatPreview = haituoInstallChatHoverPreview({ document, window,
            translate: text => ipcRenderer.invoke('caisheng:translate', { text, targetLanguage:'zh-CN', provider:settings.chatTranslationProvider || 'google-free', purpose:'chat' })
        });
    } else if (window.__haituoChatPreview) {
        window.__haituoChatPreview.destroy();
        window.__haituoChatPreview = null;
    }
}
haituoSyncChatPreview();
