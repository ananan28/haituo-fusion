'use strict';

// Windows registers the login item with --start-in-tray. A second launch that
// carries that flag is a background/login start, not a user request to surface
// the app, so the single-instance handler must not restore or raise the window.
function secondInstanceShouldShow(argv) {
  return !Array.isArray(argv) || !argv.includes('--start-in-tray');
}

// Refreshes and child-window syncs also run while the app sits in the tray.
// Layout work may proceed, but a hidden or minimized shell must stay that way.
function keepShellVisibleAllowed(state) {
  return Boolean(state) && state.visible === true && state.minimized !== true;
}

module.exports = { secondInstanceShouldShow, keepShellVisibleAllowed };
