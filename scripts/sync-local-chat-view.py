from pathlib import Path
root=Path(__file__).resolve().parent.parent
module=(root/'src/app/js/haituo-local-chat-view.js').read_text(encoding='utf-8')
view=module.replace("'use strict';\n",'',1).replace('function conversation(id)','function haituoLocalChatConversation(id)',1).replace('conversation(', 'haituoLocalChatConversation(').replace('function install({','function haituoInstallLocalChatView({',1).replace('module.exports={install};','')
p=root/'src/app/js/caisheng-webview-preload.js';source=p.read_text(encoding='utf-8')
start=source.index('function haituoLocalChatConversation(');end=source.index('let haituoLocalBilingualView;',start)
source=source[:start]+view+'\n'+source[end:]
p.write_text(source,encoding='utf-8')
print('Generated sandbox-safe local chat view from editable module')
