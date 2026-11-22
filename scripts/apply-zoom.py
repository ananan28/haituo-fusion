"""Materialize exact Zoom integration additions; never evaluate application bundles."""
import json,pathlib,sys,subprocess
ROOT=pathlib.Path(__file__).resolve().parent.parent
def apply(source,path):
 patches=[x for x in json.loads((ROOT/'scripts/zoom-patch.json').read_text()) if x['path']==path]
 for index,patch in enumerate(patches):
  old,new=patch['old'],patch['new']
  count=patch.get('count',1)
  # Later reviewed patches may refine an earlier insertion. Recognize its
  # final form too; otherwise a second build could reinsert the old block.
  final=new
  for later in patches[index+1:]:
   final=final.replace(later['old'],later['new'],later.get('count',1))
  if source.count(final)==count or source.count(new)==count:continue
  if source.count(old)!=count:raise RuntimeError('Zoom integration anchor drift: '+path+' '+old[:70])
  source=source.replace(old,new,count)
 return source
if __name__=='__main__':
 for path in sorted({x['path'] for x in json.loads((ROOT/'scripts/zoom-patch.json').read_text())}):
  p=ROOT/path
  source=subprocess.check_output(['git','show','acba10a49ebf7039f22a631a29417d5ff8862da8:'+path],cwd=ROOT,text=True) if '--canonical' in sys.argv else p.read_text()
  p.write_text(apply(source,path))
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
