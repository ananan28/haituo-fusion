'use strict';

function translationTimeout(provider, text, configured) {
  const free = ['google-free', 'mymemory'].includes(provider);
  const floor = free ? 20000 : 45000;
  const lengthBudget = Math.ceil(String(text || '').length / 1000) * (free ? 2000 : 10000);
  return Math.min(free ? 45000 : 120000, Math.max(floor + lengthBudget, Number(configured) || 0));
}

function normalizeBadge(value) {
  return [...String(value ?? 'SVIP').replace(/[\u0000-\u001f\u007f]/gu, '').trim()].slice(0, 24).join('');
}

async function requestJSON(fetcher, url, init, timeout, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxAttempts = 2) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let retryAfter = 0;
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const status = response.status;
        retryAfter = Math.min(status === 429 ? 60000 : 3000, Math.max(0, Number(response.headers?.get('retry-after')) * 1000 || 0));
        let code = '';
        try {
          const body = await response.json();
          const raw = String(body?.error?.code || body?.error?.type || '');
          if (/^[a-zA-Z0-9_-]{1,80}$/u.test(raw)) code = raw;
        } catch {}
        const parsed = new URL(url);
        let model = '';
        try { const raw = JSON.parse(init?.body || '{}').model; if (typeof raw === 'string' && /^[a-zA-Z0-9._:/-]{1,120}$/u.test(raw)) model = raw; } catch {}
        const note = status === 401 || status === 403 ? '（认证失败，请核对密钥与地址）' : status === 402 ? '（账户余额不足或该接口未开通）' : status === 429 ? `（请求过于频繁${retryAfter ? `，请约 ${Math.ceil(retryAfter / 1000)} 秒后重试` : '，请稍后重试'}）` : '';
        const error = Error(`HTTP ${status}${note}；地址：${parsed.origin}${parsed.pathname}${model ? '；模型：' + model : ''}${code ? '；服务错误：' + code : ''}`);
        error.status = status;
        error.retryAfterMs = retryAfter;
        throw error;
      }
      // Keep the deadline active while receiving and parsing the response body.
      try {
        return await response.json();
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          const error = new SyntaxError(`翻译服务返回了无法解析的内容（HTTP ${response.status}）`);
          error.code = 'TRANSLATION_BAD_JSON';
          error.status = response.status;
          throw error;
        }
        throw parseError;
      }
    } catch (cause) {
      const transient = cause?.code !== 'TRANSLATION_BAD_JSON' && (controller.signal.aborted || cause?.name === 'TimeoutError' || cause instanceof TypeError || /ERR_(?:CONNECTION|NETWORK|INTERNET|NAME_NOT_RESOLVED|TIMED_OUT)|fetch failed/iu.test(String(cause?.message || '')) || [408, 502, 503, 504].includes(cause?.status));
      if (!transient) throw cause;
      if (attempt === maxAttempts - 1) {
        const error = Error(controller.signal.aborted ? `翻译请求超时${maxAttempts===2?'，已重试一次':maxAttempts>1?'，已重试 '+(maxAttempts-1)+' 次':''}；请稍后重试` : `翻译服务连接中断${maxAttempts===2?'，已重试一次':maxAttempts>1?'，已重试 '+(maxAttempts-1)+' 次':''}；请检查网络或代理后重试`);
        error.code = controller.signal.aborted ? 'TRANSLATION_TIMEOUT' : 'TRANSLATION_NETWORK';
        error.status = cause?.status;
        throw error;
      }
    } finally { clearTimeout(timer); }
    await sleep(Math.max(700, retryAfter));
  }
}

async function resolveSignalProxy(session, serverUrl, explicit) {
  if (explicit) return explicit;
  try {
    // Honour the first route chosen by the OS/PAC. Never borrow the translation pool.
    const first = String(await session.resolveProxy(serverUrl)).split(';')[0].trim();
    const match = /^(PROXY|HTTPS|SOCKS5?|SOCKS4)\s+([^\s]+)$/iu.exec(first);
    if (!match) return undefined;
    const kind = match[1].toUpperCase();
    return `${kind.startsWith('SOCKS') ? 'socks5' : kind === 'HTTPS' ? 'https' : 'http'}://${match[2]}`;
  } catch { return undefined; }
}

function installWebRecovery(contents, timers = { setTimeout, clearTimeout }, log = () => {}) {
  let timer, tries = 0, failed = false, ready = false;
  // Weak-network logins can fail repeatedly for minutes; keep retrying with a
  // capped backoff instead of giving up after three attempts.
  const delays = [5000, 15000, 30000, 60000, 120000, 180000, 240000, 240000, 240000, 240000];
  const cancel = () => { if (timer) timers.clearTimeout(timer); timer = undefined; };
  contents.on('did-start-loading', () => { cancel(); failed = false; });
  contents.on('did-finish-load', () => {
    if (failed) return;
    ready = true;
    cancel();
    tries = 0;
  });
  contents.on('render-process-gone', () => {
    ready = false;
    failed = true;
    // A crashed renderer never fires did-fail-load; without a reload the
    // chat pane stays on the crash page until the user refreshes manually.
    if (timer || tries >= delays.length) return;
    const delay = delays[tries++];
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (!contents.isDestroyed()) {
        log(`reloading webview after its renderer crashed`);
        contents.reload();
      }
    }, delay);
  });
  contents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
    if (!mainFrame || ![-2, -7, -21, -100, -101, -102, -105, -106, -109, -118, -130].includes(code)) return;
    let host;
    try { host = new URL(url).hostname; } catch { return; }
    if (!['web.whatsapp.com', 'web.telegram.org'].includes(host)) return;
    failed = true;
    // A page that already rendered is kept. Reloading it because a later
    // in-page navigation failed is what made the chat randomly go back to its
    // loading screen; the web app reconnects on its own.
    if (ready) {
      log(`webview navigation failed after the page was ready (${code}); keeping the current page`);
      return;
    }
    if (timer || tries >= delays.length) return;
    const delay = delays[tries++];
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (!contents.isDestroyed()) {
        log(`reloading webview after an initial load failure (${code})`);
        contents.reload();
      }
    }, delay);
  });
  contents.once('destroyed', cancel);
}

module.exports = { translationTimeout, normalizeBadge, requestJSON, resolveSignalProxy, installWebRecovery };

// Translation-only retries never invoke a message-send operation.
async function retryTranslation(work, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = () => {}) {
  for (let attempt=0; attempt<=5; attempt++) {
    try { return await work(); } catch(error) {
      const message=String(error?.message||error);
      if (error?.code===`TRANSLATION_BAD_JSON`) { const failure=Error(message);failure.code=`TRANSLATION_BAD_JSON`;failure.status=error?.status;throw failure; }
      if ([400,401,402,403,404,422].includes(error?.status) || /HTTP (400|401|402|403|404|422)\b|invalid.api.key|insufficient_quota|认证失败|未配置|请.*填写|不支持图片/i.test(message)) throw error;
      // A long Retry-After must not stall the UI; tell the user instead.
      const retryAfterMs = Math.max(0, Number(error?.retryAfterMs) || 0);
      if (error?.status === 429 && retryAfterMs > 5000) throw error;
      if(attempt===5) { const failure=Error('翻译失败，已自动重试 5 次：'+message);failure.cause=error;throw failure; }
      onRetry(attempt+1,5);
      await sleep(Math.max([500,1000,2000,4000,8000][attempt], retryAfterMs));
    }
  }
}
module.exports.retryTranslation=retryTranslation;
