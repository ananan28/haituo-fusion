// Build-time only: never download/execute mutable binaries on an end user's machine.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const tar = require('tar');
const unzip = require('extract-zip');
const root = path.resolve(__dirname, '..');
const lock = require('./signal-runtime.lock.json');
const target = path.join(root, 'resources', 'signal-runtime');
const cache = path.join(root, '.runtime-cache');
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function download(url, dest, redirects = 0) {
  if (redirects > 5 || !url.startsWith('https://')) throw new Error('Invalid download redirect');
  await new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'ChatTranslatorLite-build' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); download(new URL(response.headers.location, url).href, dest, redirects + 1).then(resolve, reject); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Download HTTP ${response.statusCode}`)); return; }
      const output = fs.createWriteStream(dest); response.pipe(output);
      output.on('finish', () => output.close(resolve)); output.on('error', reject); response.on('error', reject);
    });
    request.setTimeout(60000, () => request.destroy(new Error('Download timeout'))); request.on('error', reject);
  });
}
async function archive(item, suffix) {
  const file = path.join(cache, `${item.sha256}${suffix}`);
  if (fs.existsSync(file) && digest(file) === item.sha256) return file;
  const tmp = file + '.part'; await download(item.url, tmp);
  if (digest(tmp) !== item.sha256) { fs.rmSync(tmp, { force: true }); throw new Error('SHA256 mismatch'); }
  fs.renameSync(tmp, file); return file;
}
function directory(parent) {
  const dirs = fs.readdirSync(parent, { withFileTypes: true }).filter(x => x.isDirectory());
  if (dirs.length !== 1) throw new Error('Unexpected archive layout');
  return path.join(parent, dirs[0].name);
}
(async () => {
  fs.mkdirSync(cache, { recursive: true });
  if (process.argv.includes('--verify')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'runtime-manifest.json')));
    if (manifest.signal.sha256 !== lock.signal.sha256 || manifest.java.sha256 !== lock.java.sha256 || manifest.platform !== 'win32') throw new Error('Runtime lock mismatch');
    for (const [file, hash] of Object.entries(manifest.files)) if (digest(path.join(target, file)) !== hash) throw new Error(`Runtime changed: ${file}`);
    if (!manifest.files['jre/bin/java.exe']) throw new Error('Java executable missing');
    console.log('Verified bundled Signal runtime.'); return;
  }
  console.log('Preparing pinned Windows x64 Signal core and Java runtime...');
  const [signal, java] = await Promise.all([archive(lock.signal, '.tar.gz'), archive(lock.java, '.zip')]);
  const stage = fs.mkdtempSync(path.join(cache, 'stage-')); const s = path.join(stage, 'signal'); const j = path.join(stage, 'java'); fs.mkdirSync(s); fs.mkdirSync(j);
  await tar.x({ file: signal, cwd: s, strict: true, preservePaths: false }); await unzip(java, { dir: j });
  const output = path.join(stage, 'output'); fs.mkdirSync(output);
  fs.renameSync(directory(s), path.join(output, 'signal-cli')); fs.renameSync(directory(j), path.join(output, 'jre'));
  const files = {};
  function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, item.name); if (item.isDirectory()) walk(full); else if (item.isFile()) files[path.relative(output, full).split(path.sep).join('/')] = digest(full); else throw new Error('Unexpected runtime symlink'); } }
  walk(output);
  if (!files['jre/bin/java.exe'] || !Object.keys(files).some(x => x.startsWith('signal-cli/lib/') && x.endsWith('.jar'))) throw new Error('Runtime incomplete');
  fs.writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify({ ...lock, files }, null, 2));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(output, target); fs.rmSync(stage, { recursive: true, force: true });
  console.log('Bundled runtime prepared and checksums recorded.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
