"""Materialize exact Zoom integration additions; never evaluate application bundles."""
import json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
def apply(source,path):
 for patch in json.loads((ROOT/'scripts/zoom-patch.json').read_text()):
  if patch['path']!=path:continue
  old,new=patch['old'],patch['new']
  count=patch.get('count',1)
  if source.count(new)==count:continue
  if source.count(old)!=count:raise RuntimeError('Zoom integration anchor drift: '+path+' '+old[:70])
  source=source.replace(old,new,count)
 return source
if __name__=='__main__':
 for path in sorted({x['path'] for x in json.loads((ROOT/'scripts/zoom-patch.json').read_text())}):
  p=ROOT/path;p.write_text(apply(p.read_text(),path))
 p=ROOT/'src/app/js/haituo-zoom-preload.js'
 p.write_text((ROOT/'src/app/js/haituo-zoom-adapter.js').read_text()+'''
const {ipcRenderer}=require('electron');
function startHaituoZoom(){installZoom(document,{
 getConfig:()=>ipcRenderer.invoke('caisheng:get-translation-config'),
 translate:value=>ipcRenderer.invoke('caisheng:translate',value),
 gesture:()=>ipcRenderer.send('haituo-user-gesture'),
 onConfig:handler=>{const listener=(_event,value)=>handler(value);ipcRenderer.on('caisheng:translation-config-changed',listener);return()=>ipcRenderer.removeListener('caisheng:translation-config-changed',listener)}
});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startHaituoZoom,{once:true});else startHaituoZoom();
''')
 print('Materialized Zoom registry, bounded navigation, isolated preload and permissions.')
