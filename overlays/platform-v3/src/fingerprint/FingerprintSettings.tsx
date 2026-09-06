import { useEffect, useState, type FormEvent } from 'react';
import type { AccountFingerprintProfile, ProxyScheme } from './types';
import './fingerprint-settings.css';

export function FingerprintSettings({ accountId }: { accountId: string }) {
  const [profile, setProfile] = useState<AccountFingerprintProfile | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMessage('');
    void window.caishengFingerprint.get(accountId).then(setProfile).catch(error => {
      setMessage(error instanceof Error ? error.message : '读取设置失败');
    });
  }, [accountId]);

  if (!profile) return <div className="fingerprint-loading">正在读取账号环境…</div>;

  const update = (patch: Partial<AccountFingerprintProfile>) =>
    setProfile(current => (current ? { ...current, ...patch } : current));
  const updateProxy = (patch: Partial<AccountFingerprintProfile['proxy']>) =>
    update({ proxy: { ...profile.proxy, ...patch } });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('正在保存…');
    try {
      setProfile(await window.caishengFingerprint.save(profile));
      setMessage('已保存，重新加载该账号后全部生效');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };

  return (
    <form className="fingerprint-settings" onSubmit={submit}>
      <header><h2>账号浏览器环境</h2><p>每个账号独立保存；修改不会影响其他账号。</p></header>
      <section>
        <h3>地区与设备</h3>
        <div className="fingerprint-grid">
          <label>语言<input value={profile.language} onChange={e => update({ language: e.target.value })} placeholder="zh-CN" /></label>
          <label>时区<input value={profile.timezone} onChange={e => update({ timezone: e.target.value })} placeholder="Asia/Shanghai" /></label>
          <label>屏幕宽度<input type="number" min="800" max="7680" value={profile.screen.width} onChange={e => update({ screen: { ...profile.screen, width: Number(e.target.value) } })} /></label>
          <label>屏幕高度<input type="number" min="600" max="4320" value={profile.screen.height} onChange={e => update({ screen: { ...profile.screen, height: Number(e.target.value) } })} /></label>
          <label>显示缩放<input type="number" min="0.5" max="4" step="0.25" value={profile.screen.scaleFactor} onChange={e => update({ screen: { ...profile.screen, scaleFactor: Number(e.target.value) } })} /></label>
          <label>CPU 核心数<select value={profile.hardwareConcurrency} onChange={e => update({ hardwareConcurrency: Number(e.target.value) })}>{[1,2,4,6,8,12,16,24,32].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>内存（GB）<select value={profile.deviceMemory} onChange={e => update({ deviceMemory: Number(e.target.value) })}>{[1,2,4,8,16,32].map(v => <option key={v}>{v}</option>)}</select></label>
        </div>
      </section>
      <section>
        <h3>WebGL</h3>
        <label>厂商<input value={profile.webgl.vendor} onChange={e => update({ webgl: { ...profile.webgl, vendor: e.target.value } })} /></label>
        <label>渲染器<input value={profile.webgl.renderer} onChange={e => update({ webgl: { ...profile.webgl, renderer: e.target.value } })} /></label>
      </section>
      <section>
        <h3>独立代理</h3>
        <label className="fingerprint-check"><input type="checkbox" checked={profile.proxy.enabled} onChange={e => updateProxy({ enabled: e.target.checked })} />启用此账号代理</label>
        <div className="fingerprint-grid">
          <label>协议<select value={profile.proxy.scheme} disabled={!profile.proxy.enabled} onChange={e => updateProxy({ scheme: e.target.value as ProxyScheme })}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
          <label>服务器<input disabled={!profile.proxy.enabled} value={profile.proxy.host} onChange={e => updateProxy({ host: e.target.value })} /></label>
          <label>端口<input type="number" min="1" max="65535" disabled={!profile.proxy.enabled} value={profile.proxy.port} onChange={e => updateProxy({ port: Number(e.target.value) })} /></label>
          <label>用户名<input disabled={!profile.proxy.enabled} value={profile.proxy.username} onChange={e => updateProxy({ username: e.target.value })} /></label>
          <label>密码<input type="password" disabled={!profile.proxy.enabled} value={profile.proxy.password} onChange={e => updateProxy({ password: e.target.value })} /></label>
        </div>
      </section>
      <footer><span role="status">{message}</span><button type="submit">保存账号环境</button></footer>
    </form>
  );
}

