'use strict';

// Old builds registered the login item with --start-in-tray, and even older
// ones with --use-tray-icon. A launch carrying either flag is a background or
// login start, not a user request to surface the app.
const BACKGROUND_LAUNCH_FLAGS = new Set(['--start-in-tray', '--use-tray-icon']);

function isBackgroundLaunch(argv) {
  return Array.isArray(argv) && argv.some(argument => BACKGROUND_LAUNCH_FLAGS.has(argument));
}

function secondInstanceShouldShow(argv) {
  return !isBackgroundLaunch(argv);
}

// Refreshes and child-window syncs also run while the app sits in the tray.
// Layout work may proceed, but a hidden or minimized shell must stay that way.
function keepShellVisibleAllowed(state) {
  return Boolean(state) && state.visible === true && state.minimized !== true;
}

module.exports = { isBackgroundLaunch, secondInstanceShouldShow, keepShellVisibleAllowed };
