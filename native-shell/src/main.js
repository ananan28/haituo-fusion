const {app,BrowserWindow,BrowserView,ipcMain}=require('electron');
const path=require('path'),fs=require('fs'),crypto=require('crypto');
app.setName('财盛聚合聊天'); app.setPath('userData',path.join(app.getPath('appData'),'财盛聚合聊天'));
let win; const views=new Map(), smoke=process.argv.includes('--smoke-test');
const stateFile=()=>path.join(app.getPath('userData'),'services.json');
const read=()=>{try{return JSON.parse(fs.readFileSync(stateFile(),'utf8'))}catch{return[]}};
const save=x=>{fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(stateFile(),JSON.stringify(x,null,2))};
const catalog=[{id:'signal',name:'Signal',kind:'native',color:'#3a76f0'},{id:'whatsapp',name:'WhatsApp',kind:'web',url:'https://web.whatsapp.com/',color:'#13a45a'}];
function hide(){for(const v of views.values())win.removeBrowserView(v)}
function bounds(v){const [w,h]=win.getContentSize();v.setBounds({x:260,y:0,width:Math.max(0,w-260),height:h});v.setAutoResize({width:true,height:true})}
function web(s){hide();let v=views.get(s.id);if(!v){v=new BrowserView({webPreferences:{partition:'persist:caisheng-'+s.id,contextIsolation:true,sandbox:true,nodeIntegration:false}});views.set(s.id,v);v.webContents.setWindowOpenHandler(({url})=>{v.webContents.loadURL(url);return{action:'deny'}});v.webContents.loadURL(s.url)}win.addBrowserView(v);bounds(v)}
ipcMain.handle('catalog:list',()=>catalog);ipcMain.handle('services:list',()=>read());
ipcMain.handle('services:add',(_,id)=>{const r=catalog.find(x=>x.id===id);if(!r)throw Error('未知服务');const a=read(),n=a.filter(x=>x.recipeId===id).length+1,s={id:crypto.randomUUID(),recipeId:id,name:n===1?r.name:r.name+' '+n,kind:r.kind,url:r.url||'',color:r.color};a.push(s);save(a);return s});
ipcMain.handle('services:open',(_,s)=>s.kind==='web'?web(s):hide());ipcMain.handle('view:hide',hide);
ipcMain.on('renderer:ready',()=>{if(smoke){console.log('CAISHENG_RENDERER_READY');app.exit(0)}});
app.whenReady().then(()=>{win=new BrowserWindow({width:1360,height:850,minWidth:980,minHeight:640,title:'财盛聚合聊天',backgroundColor:'#f4f6fb',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false}});win.setMenu(null);win.loadFile(path.join(__dirname,'renderer','index.html'));win.on('resize',()=>{for(const v of win.getBrowserViews())bounds(v)});if(smoke)setTimeout(()=>app.exit(2),15000)});app.on('window-all-closed',()=>app.quit());
