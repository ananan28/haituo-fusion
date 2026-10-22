/* HAITUO_SIGNAL_CHAT_PREVIEW_START */
;(function(){
  if (window.__haituoSignalChatPreview) return;
  window.__haituoSignalChatPreview = true;
  const ROW = '.module-conversation-list__item--contact-or-conversation';
  const clean = text => String(text || '').replace(/\u200e|\u200f/gu, '').replace(/\s+/gu, ' ').trim();
  const cache = new Map(), pending = new Map();
  const HAN = /[\u3400-\u9fff]/u, LATIN = /[a-z]/iu;
  let popup, active, snapshot, timer, observer, seq = 0;
  function readRow(row) {
    const name = clean(row.querySelector(`${ROW}__content__header__name__contact-name, ${ROW}__content__header__name`)?.innerText);
    const text = clean(row.querySelector(`${ROW}__content__message__text`)?.innerText);
    return text ? { name, text, key: name + '\u0000' + text } : null;
  }
  const valid = (row, data, id) => seq === id && active === row && row.isConnected && readRow(row)?.key === data.key;
  function hide() {
    seq += 1; clearTimeout(timer); timer = undefined;
    observer?.disconnect(); observer = undefined;
    active = undefined; snapshot = undefined;
    popup?.remove(); popup = undefined;
  }
  function position() {
    if (!popup || !active) return;
    const box = active.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    popup.style.width = width + 'px';
    const fitsRight = box.right + width + 12 <= window.innerWidth;
    popup.style.left = (fitsRight ? box.right + 8 : Math.max(12, box.left + 8)) + 'px';
    popup.style.top = Math.max(12, Math.min(box.top, window.innerHeight - popup.getBoundingClientRect().height - 12)) + 'px';
  }
  function create(data) {
    popup?.remove();
    popup = document.createElement('section');
    popup.id = 'haituo-signal-chat-preview';
    popup.setAttribute('role', 'tooltip');
    popup.setAttribute('aria-label', '消息双语预览');
    Object.assign(popup.style, { position:'fixed', zIndex:'2147483647', boxSizing:'border-box', padding:'12px', borderRadius:'10px', border:'1px solid #52616b', background:'#202c33', color:'#e9edef', boxShadow:'0 6px 24px #0006', font:'14px/1.5 system-ui,sans-serif', maxHeight:'calc(100vh - 24px)', overflow:'auto', textAlign:'left' });
    const block = (label, value) => {
      const title = document.createElement('strong');
      Object.assign(title.style,{display:'block',color:'#55d6b0',fontSize:'12px',marginBottom:'4px'});
      title.textContent = label;
      const body = document.createElement('div');
      Object.assign(body.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'24vh',overflowY:'auto',marginBottom:'8px',userSelect:'text'});
      body.textContent = value;
      popup.append(title, body);
      return body;
    };
    if (data.name) { const name=document.createElement('div'); name.textContent=data.name; name.style.fontWeight='700'; name.style.marginBottom='8px'; popup.append(name); }
    block('原文', data.text);
    popup.__target = block('中文翻译', '正在翻译…');
    popup.addEventListener('pointerleave', e => { if (!active?.contains(e.relatedTarget)) hide(); });
    // Preview interactions never open the conversation and never mark messages read.
    popup.addEventListener('click', e => e.stopPropagation());
    (document.body || document.documentElement).append(popup);
    position();
  }
  async function load(row, data, id) {
    if (!valid(row, data, id)) return;
    if (HAN.test(data.text) && !LATIN.test(data.text)) {
      create(data); popup.__target.textContent = data.text; position(); return;
    }
    if (cache.has(data.text)) { create(data); popup.__target.textContent = cache.get(data.text); position(); return; }
    create(data);
    const target = popup.__target;
    try {
      const bridge = window.SignalContext?.caishengTranslate;
      if (typeof bridge !== 'function') throw Error('翻译服务不可用');
      if (pending.size && !pending.has(data.text)) await Promise.allSettled([...pending.values()]);
      if (!valid(row, data, id)) return;
      if (!pending.has(data.text)) {
        const task = Promise.resolve().then(() => bridge({ text: data.text, targetLanguage: 'zh-CN', purpose: 'chat' })).then(result => {
          const text = String(result?.text || '').trim();
          if (!text) throw Error('empty preview');
          cache.set(data.text, text);
          if (cache.size > 128) cache.delete(cache.keys().next().value);
          return text;
        }).finally(() => pending.delete(data.text));
        pending.set(data.text, task);
      }
      const translated = await pending.get(data.text);
      if (valid(row, data, id) && target.isConnected) { target.textContent = translated; position(); }
    } catch {
      if (valid(row, data, id) && target.isConnected) { target.textContent = '暂时无法翻译，请移开鼠标后再次悬停重试'; position(); }
    }
  }
  function start(row) {
    const data = readRow(row);
    if (!data) { hide(); return; }
    if (active === row && snapshot?.key === data.key) return;
    hide(); active = row; snapshot = data;
    const id = seq;
    observer = new MutationObserver(() => {
      if (!row.isConnected) { hide(); return; }
      if (readRow(row)?.key !== snapshot?.key) start(row);
    });
    observer.observe(row, { childList: true, subtree: true, characterData: true });
    timer = setTimeout(() => load(row, data, id), 650);
  }
  const over = e => { const row = e.target?.closest?.(ROW); if (row) start(row); };
  const out = e => { if (active && !active.contains(e.relatedTarget) && !popup?.contains(e.relatedTarget)) hide(); };
  const close = e => { if (!popup?.contains(e.target)) hide(); };
  const key = e => { if (e.key === 'Escape') hide(); };
  const visible = () => { if (document.hidden) hide(); };
  document.addEventListener('pointerover', over, true);
  document.addEventListener('pointerout', out, true);
  document.addEventListener('pointerdown', close, true);
  document.addEventListener('wheel', close, true);
  document.addEventListener('scroll', close, true);
  document.addEventListener('keydown', key, true);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
})();
/* HAITUO_SIGNAL_CHAT_PREVIEW_END */
