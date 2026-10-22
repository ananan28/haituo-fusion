// Translation-only layout transaction. Never observe or continuously write scrollTop.
function haituoTranslationScroller(node) {
    for(let parent=node?.parentElement;parent;parent=parent.parentElement) {
        const css=getComputedStyle(parent);
        if(/^(auto|scroll)$/.test(css.overflowY) && parent.clientHeight>0)return parent;
    }
    return null;
}
function haituoKeepTranslationPosition(node, update) {
    const root=haituoTranslationScroller(node);
    if(!root || !root.isConnected)return update();
    const bounds=root.getBoundingClientRect();
    const atBottom=root.scrollHeight-root.clientHeight-root.scrollTop<=24;
    const candidates=root.querySelectorAll('.module-message,[data-testid="message"],.message-in,.message-out,[data-id]');
    const anchor=[...candidates].find(item=>{const r=item.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom});
    const top=anchor?.getBoundingClientRect().top, oldTop=root.scrollTop;
    const identity=anchor?.getAttribute('data-id')||anchor?.id;
    const oldAnchor=root.style.getPropertyValue('overflow-anchor'),priority=root.style.getPropertyPriority('overflow-anchor');
    const oldBehavior=root.style.getPropertyValue('scroll-behavior'),behaviorPriority=root.style.getPropertyPriority('scroll-behavior');
    root.style.setProperty('overflow-anchor','none','important');
    root.style.setProperty('scroll-behavior','auto','important');
    try {
        const result=update();
        if(!root.isConnected)return result;
        if(atBottom)root.scrollTop=Math.max(0,root.scrollHeight-root.clientHeight);
        else if(anchor?.isConnected && (anchor.getAttribute('data-id')||anchor.id)===identity) {
            const delta=anchor.getBoundingClientRect().top-top;
            if(Math.abs(delta)>.5)root.scrollTop+=delta;
        } else root.scrollTop=oldTop;
        return result;
    } finally {
        oldAnchor?root.style.setProperty('overflow-anchor',oldAnchor,priority):root.style.removeProperty('overflow-anchor');
        oldBehavior?root.style.setProperty('scroll-behavior',oldBehavior,behaviorPriority):root.style.removeProperty('scroll-behavior');
    }
}
let haituoSignalTranslationFrame=0;
const haituoSignalTranslationUpdates=new Map();
let haituoSignalReactDOM;
function haituoQueueSignalTranslation(reference, apply) {
    haituoSignalTranslationUpdates.set(reference,apply);
    if(haituoSignalTranslationFrame)return;
    haituoSignalTranslationFrame=requestAnimationFrame(()=>{
        haituoSignalTranslationFrame=0;
        const updates=[...haituoSignalTranslationUpdates].filter(([reference])=>reference.current?.isConnected);
        haituoSignalTranslationUpdates.clear();
        if(!updates.length)return;
        // Each live chat scroller has its own anchor. Never use the sidebar.
        const groups=new Map();
        for(const entry of updates){const root=haituoTranslationScroller(entry[0].current);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(entry)}
        for(const entries of groups.values())haituoKeepTranslationPosition(entries[0][0].current,()=>{
            haituoSignalReactDOM.flushSync(()=>entries.forEach(([,apply])=>apply()));
        });
    });
}
function haituoCachedSignalTranslation(text) {
    const config=x_(),target=HaituoIncomingTarget(text),provider=config.chatTranslationProvider||'google-free';
    if(!config.autoTranslateIncoming)return '';
    const key=`chat\0${provider}\0${config.openAIModel}\0${config.compatibleEndpoint}\0${target}\0${text}`;
    const cached=C_.get(key);
    return cached?HaituoFormatMessageParagraphs(text,cached):'';
}
