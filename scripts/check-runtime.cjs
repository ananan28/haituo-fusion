const { execFileSync } = require('node:child_process');
module.exports = async () => execFileSync(process.execPath, [require('node:path').join(__dirname, 'prepare-signal-runtime.cjs'), '--verify'], { stdio: 'inherit', windowsHide: true });
