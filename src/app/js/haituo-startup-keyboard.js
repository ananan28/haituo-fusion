'use strict';
// Keyboard labels are optional UI metadata, never a prerequisite for loading chats.
async function loadLayoutMap(navigator, {timeoutMs=2000,onFallback=()=>{}}={}) {
    let timer;
    try {
        if(typeof navigator?.keyboard?.getLayoutMap!=='function')throw Error('Keyboard layout API unavailable');
        const map=await Promise.race([
            Promise.resolve().then(()=>navigator.keyboard.getLayoutMap()),
            new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Keyboard layout timed out')),timeoutMs)})
        ]);
        if(!map || typeof map.get!=='function')throw Error('Invalid keyboard layout');
        return map;
    } catch(error) {
        onFallback();
        return new Map();
    } finally {
        clearTimeout(timer);
    }
}
module.exports={loadLayoutMap};
