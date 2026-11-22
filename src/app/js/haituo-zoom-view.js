'use strict';
// Host-side lifecycle UI: Zoom only. Never runs inside the remote page.
function bind(view){
 if(view.__haituoZoomLifecycle)return view.__haituoZoomLifecycle;
 const doc=view.ownerDocument,win=doc.defaultView,panel=doc.createElement('section'),label=doc.createElement('div'),retry=doc.createElement('button');
 panel.dataset.haituoZoomStatus='loading';panel.setAttribute('role','status');panel.style.cssText='position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#191919;color:#eee;padding:28px;text-align:center';
 retry.type='button';retry.textContent='重试 Zoom';retry.style.cssText='padding:9px 22px;border:1px solid #6689c8;border-radius:8px;background:#23334d;color:white;cursor:pointer';panel.append(label,retry);
 let state='loading',message='正在打开 Zoom…',timer,failed=false;
 const visible=()=>view.isConnected&&view.dataset.haituoActive!=='false'&&view.style.visibility!=='hidden';
 function sync(){if(!view.isConnected){panel.remove();clearTimeout(timer);observer.disconnect();return;}const parent=view.parentElement;if(parent&&!panel.isConnected)parent.append(panel);panel.style.display=state==='ready'||!visible()?'none':'flex';panel.dataset.haituoZoomStatus=state;label.textContent=message;retry.hidden=state==='loading'}
 function set(next,text){state=next;view.dataset.haituoZoomState=next;message=text;clearTimeout(timer);sync()}
 function start(){failed=false;if(state==='ready'){clearTimeout(timer);return}set('loading','正在打开 Zoom…');timer=setTimeout(()=>set('error','Zoom 页面未能完成启动。可点击重试；账号数据不会被清除。'),30000)}
 function failure(event){if(event.isMainFrame===false||event.errorCode===-3)return;failed=true;set('error','Zoom 加载失败：'+String(event.errorCode??'')+' '+String(event.errorDescription||'页面启动异常').replace(/https?:\/\/\S+/g,'[地址]'))}
 function ready(){if(failed)return;try{const url=new URL(view.getURL());if(url.protocol!=='https:'||!(url.hostname==='zoom.us'||url.hostname.endsWith('.zoom.us')))return;set('ready','')}catch{/* A navigation can replace the guest between events; retain the bounded timer. */}}
 function gone(){failed=true;set('error','Zoom 页面进程已退出，请重试。')}
 function again(){start();try{if(typeof view.loadURL==='function')Promise.resolve(view.loadURL(view.src)).catch(()=>gone());else view.src=view.getAttribute('src')}catch{gone()}}
 const events={'did-start-loading':start,'dom-ready':ready,'did-finish-load':ready,'did-stop-loading':ready,'did-fail-load':failure,'render-process-gone':gone,'crashed':gone};
 for(const [type,handler]of Object.entries(events))view.addEventListener(type,handler);
 retry.addEventListener('click',again);const observer=new win.MutationObserver(sync);observer.observe(view,{attributes:true,attributeFilter:['style','data-haituo-active']});if(view.parentElement)observer.observe(view.parentElement,{childList:true});
 const api={dispose(){clearTimeout(timer);observer.disconnect();for(const [type,handler]of Object.entries(events))view.removeEventListener(type,handler);retry.removeEventListener('click',again);panel.remove();delete view.__haituoZoomLifecycle}};view.__haituoZoomLifecycle=api;queueMicrotask(()=>{if(view.isConnected)start()});return api;
}
module.exports={bind};
