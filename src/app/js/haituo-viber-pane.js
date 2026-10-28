'use strict';
// This component receives only its own account's ephemeral native stream.
function createPane(React,api){
 return function ViberPane({account,active}){
  const [state,setState]=React.useState({ready:false,status:'选择 Viber 账号以连接',image:null}),[source,setSource]=React.useState(''),[translated,setTranslated]=React.useState(''),[busy,setBusy]=React.useState(false),[target,setTarget]=React.useState('zh-CN'),[revision,reconnect]=React.useState(0);
  const token=React.useRef(null),generation=React.useRef(0);
  React.useEffect(()=>{
   const current=++generation.current;token.current=null;setState({ready:false,status:'正在连接 Viber……',image:null});setSource('');setTranslated('');setBusy(false);
   if(!active)return;
   const off=api.onEvent(event=>{if(event.type==='reconnect'){reconnect(n=>n+1);return}if(generation.current!==current||event.accountId!==account.id||event.epoch!==token.current)return;if(event.type==='clear')setState(s=>({...s,ready:false,image:null}));else if(event.type==='frame')setState(s=>({...s,image:event.image}));else if(event.type==='state')setState(s=>({...s,...event}));});
   api.command('select',{id:account.id}).then(result=>{if(generation.current!==current){api.command('hide',{id:account.id,epoch:result.epoch}).catch(()=>{});return}token.current=result.epoch}).catch(error=>{if(generation.current===current)setState({ready:false,status:String(error.message||error),image:null})});
   return()=>{generation.current++;off();if(token.current!==null)api.command('hide',{id:account.id,epoch:token.current}).catch(()=>{});token.current=null};
  },[account.id,active,revision]);
  async function recognize(){const current=generation.current;setBusy(true);setTranslated('');try{const result=await api.command('ocr',{id:account.id,epoch:token.current});if(generation.current===current)setSource(result.original)}catch(error){if(generation.current===current)setState(s=>({...s,status:String(error.message||error)}))}finally{if(generation.current===current)setBusy(false)}}
  async function translate(){const current=generation.current,text=source;setBusy(true);try{const cfg=await api.config();const result=await api.translate({text,targetLanguage:target,provider:cfg.chatTranslationProvider||'google-free',purpose:'input'});if(generation.current===current)setTranslated(result.text)}catch(error){if(generation.current===current)setState(s=>({...s,status:String(error.message||error)}))}finally{if(generation.current===current)setBusy(false)}}
  function click(event){if(!state.ready||!state.image)return;const image=event.currentTarget,r=image.getBoundingClientRect(),scale=Math.min(r.width/image.naturalWidth,r.height/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale,x=(event.clientX-r.left-(r.width-width)/2)/width,y=(event.clientY-r.top-(r.height-height)/2)/height;if(x>=0&&x<=1&&y>=0&&y<=1)api.command('click',{id:account.id,epoch:token.current,x,y}).catch(()=>{})}
  const h=React.createElement;
  return h('section',{hidden:!active,'data-haituo-viber-account':account.id,style:{position:'absolute',inset:0,display:active?'flex':'none',flexDirection:'column',background:'#151a22',color:'#edf2fa',zIndex:active?3:0}},
   h('div',{role:'status',style:{padding:'8px 12px',fontSize:13}},state.status,' ',h('button',{onClick:()=>reconnect(n=>n+1)},'重新连接')),
   h('div',{style:{flex:1,minHeight:0,position:'relative'}},state.ready&&state.image?h('img',{src:state.image,alt:'Viber 当前账号画面',onClick:click,draggable:false,style:{width:'100%',height:'100%',objectFit:'contain'}}):h('p',{style:{padding:20}},'画面未就绪；可重新选择账号恢复。')),
   h('div',{style:{padding:10,display:'flex',gap:8,alignItems:'center'}},h('button',{onClick:recognize,disabled:busy||!state.ready},'识别当前画面文字'),h('select',{'aria-label':'Viber 翻译目标语言',value:target,onChange:e=>setTarget(e.target.value)},...[['zh-CN','中文'],['en','English'],['th','ไทย']].map(([value,label])=>h('option',{key:value,value},label))),h('button',{onClick:translate,disabled:busy||!source.trim()},busy?'处理中……':'翻译'),h('small',null,'识字在本机完成；翻译复用海拓当前接口。')),
   h('div',{style:{display:'flex',gap:8,padding:'0 10px 10px',height:110}},h('textarea',{'aria-label':'Viber 翻译原文',value:source,onChange:e=>setSource(e.target.value),placeholder:'识字后可编辑，也可手动输入原文',style:{width:'50%',resize:'none'}}),h('textarea',{'aria-label':'Viber 译文',value:translated,readOnly:true,style:{width:'50%',resize:'none'}}))
  );
 };
}
module.exports={createPane};
