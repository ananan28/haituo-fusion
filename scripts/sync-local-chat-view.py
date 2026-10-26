from pathlib import Path
import re
root=Path(__file__).resolve().parent.parent
resident=(root/'src/app/js/haituo-wa-resident.js').read_text(encoding='utf-8').replace("'use strict';\n",'',1).replace("const {conversationContext,messageOutgoing,shortMessageId}=require('./haituo-wa-identity.js');\n",'').replace('module.exports={installResident};','')
identity=(root/'src/app/js/haituo-wa-identity.js').read_text(encoding='utf-8').replace("'use strict';\n",'',1)
identity=identity[:identity.index('module.exports=')]
helper="""function haituoLocalChatConversation(id,node){return conversationContext(document,id,node)}
function haituoInstallLocalChatView(options){return installResident({...options,translate:(text,id,chatId)=>translateMessage(text,false,id,false,chatId),enabled:(_text,id,outgoing)=>outgoing?settings.backTranslationEnabled!==false:incomingTranslationOn()})}
"""
p=root/'src/app/js/caisheng-webview-preload.js';source=p.read_text(encoding='utf-8')
start=source.index('function haituoLocalChatConversation(');end=source.index('let haituoLocalBilingualView;',start)
source=source[:start]+helper+identity+resident+'\n'+source[end:]
source=re.sub(r'\nif\(isWhatsApp\(\)\)\{?haituoLocalBilingualView=haituoInstallLocalChatView[^\n]+','',source)
old='let haituoLocalBilingualView;'
source=source.replace(old,old+"\nif(isWhatsApp()){haituoLocalBilingualView=haituoInstallLocalChatView({document,window,ipc:ipcRenderer,targetFor:haituoMessageTarget,keepPosition:haituoKeepTranslationPosition});ipcRenderer.send('haituo-wa-preload-ready',{hooksReady:haituoLocalBilingualView.counters.hookReady});}",1)
p.write_text(source,encoding='utf-8')
print('Generated WhatsApp isolated observer + light DOM resident controller')
