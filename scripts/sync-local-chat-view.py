from pathlib import Path
import re
root=Path(__file__).resolve().parent.parent
resident=(root/'src/app/js/haituo-wa-resident.js').read_text(encoding='utf-8').replace("'use strict';\n",'',1).replace('module.exports={installResident};','')
hooks=(root/'src/app/js/haituo-wa-node-hooks.js').read_text(encoding='utf-8').replace("'use strict';\n",'',1).replace('module.exports={installHooks};','')
helper="""function haituoLocalChatConversation(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_]+@(?:c\\.us|s\\.whatsapp\\.net|g\\.us|lid))_/u)?.[1]||null:null}
function haituoInstallLocalChatView(options){return installResident({...options,translate:(text,id)=>translateMessage(text,false,id),enabled:()=>incomingTranslationOn(),installMainWorld:()=>contextBridge.executeInMainWorld({func:function(){("""+hooks.strip()+""")( {document,window});return true}})})}
"""
p=root/'src/app/js/caisheng-webview-preload.js';source=p.read_text(encoding='utf-8')
start=source.index('function haituoLocalChatConversation(');end=source.index('let haituoLocalBilingualView;',start)
source=source[:start]+helper+resident+'\n'+hooks+'\n'+source[end:]
source=re.sub(r'\nif\(isWhatsApp\(\)\)\{?haituoLocalBilingualView=haituoInstallLocalChatView[^\n]+','',source)
old='let haituoLocalBilingualView;'
source=source.replace(old,old+"\nif(isWhatsApp()){haituoLocalBilingualView=haituoInstallLocalChatView({document,window,ipc:ipcRenderer,targetFor:haituoMessageTarget,keepPosition:haituoKeepTranslationPosition});ipcRenderer.send('haituo-wa-preload-ready',{hooksReady:haituoLocalBilingualView.counters.hookReady});}",1)
p.write_text(source,encoding='utf-8')
print('Generated WhatsApp resident controller + main-world creation hooks')
