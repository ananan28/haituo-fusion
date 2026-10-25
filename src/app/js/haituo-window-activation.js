'use strict';
// A window may already have been shown before its preload's activate listener exists.
// Replay readiness only for an actually visible window; never raise hidden accounts.
function replayOnRendererReady(window, activate) {
    const ready=()=>{
        if(window.isDestroyed() || window.webContents.isDestroyed() || !window.isVisible() || window.isMinimized())return;
        activate();
    };
    window.webContents.on('dom-ready',ready);
    return ()=>{if(!window.webContents.isDestroyed())window.webContents.removeListener('dom-ready',ready)};
}
module.exports={replayOnRendererReady};
