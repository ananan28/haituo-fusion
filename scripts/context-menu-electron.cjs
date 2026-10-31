'use strict';
const assert=require('node:assert/strict');
module.exports=async function(e,resources){
 const {install}=require(require('node:path').join(resources,'js/haituo-context-menu.js'));
 const {readImage}=require(require('node:path').join(resources,'js/haituo-clipboard.js'));
 const win=new e.BrowserWindow({show:true,width:640,height:480,webPreferences:{sandbox:true}});
 const original=e.Menu.buildFromTemplate;let received;const records=[];
 e.Menu.buildFromTemplate=function(items){const menu=original.call(this,items);menu.popup=options=>{received={items,owner:options.window};records.push(received)};return menu};
 const views=[];
 try{
  for(let i=0;i<2;i++){
   const ses=e.session.fromPartition('context-menu-native-'+i);
   const rgba=Buffer.from(i?[255,0,0,255]:[0,0,255,255]);const png=e.nativeImage.createFromBitmap(rgba,{width:1,height:1}).toPNG();
   await ses.protocol.handle('attachment',()=>new Response(png,{headers:{'Content-Type':'image/png'}}));
   const view=new e.WebContentsView({webPreferences:{session:ses,sandbox:true,contextIsolation:true}});views.push(view);win.contentView.addChildView(view);view.setBounds({x:0,y:0,width:640,height:480});
   install({electron:e,contents:view.webContents,getWindow:()=>win});
   await view.webContents.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0"><img style="width:100px;height:100px" src="attachment://image/picture.png"><input value="native edit"></body>'));
   await view.webContents.executeJavaScript('Promise.all(Array.from(document.images,img=>img.decode()))');
   received=null;view.webContents.focus();view.webContents.sendInputEvent({type:'mouseDown',button:'right',x:32,y:32,clickCount:1});view.webContents.sendInputEvent({type:'mouseUp',button:'right',x:32,y:32,clickCount:1});
   for(let n=0;n<50&&!received;n++)await new Promise(r=>setTimeout(r,20));
   assert.ok(received,'native context-menu event on view '+i);assert.equal(received.owner,win);assert.ok(received.items.some(item=>item.label==='复制图片'));
   await e.clipboard.clear();await received.items.find(item=>item.label==='复制图片').click();
   let copied;for(let n=0;n<50;n++){copied=await readImage(e);if(copied&&!copied.isEmpty())break;await new Promise(r=>setTimeout(r,20))}
   assert.ok(copied&&!copied.isEmpty(),'clipboard contains the displayed image');
   assert.deepEqual([...copied.getBitmap().subarray(0,4)],[...rgba],'clipboard must contain clicked account image');
   win.contentView.removeChildView(view);view.webContents.close();
  }
  return{nativeRightClickEvents:records.length,sourceAccountClipboard:true,parentWindow:true,nativeMenuSelection:'UNTESTED: action invoked programmatically',realAccountMenus:'UNTESTED'};
 }finally{e.Menu.buildFromTemplate=original;for(const view of views)if(view.webContents&&!view.webContents.isDestroyed())view.webContents.close();win.destroy()}
};
