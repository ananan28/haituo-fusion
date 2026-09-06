'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('src/renderer/index.html');
const app = read('src/renderer/app.js');
const css = read('src/renderer/app.css');
const main = read('src/main.js');
const combined = [html, app, css, main].join('\n');

for (const forbidden of ['One' + 'Chat', 'Fer' + 'dium', 'Work' + 'spaces', 'To' + 'dos', 'Get ' + 'started']) {
  if (combined.includes(forbidden)) throw new Error(`独立外壳中发现禁用内容：${forbidden}`);
}
for (const id of ['quickAccounts', 'services', 'content', 'picker', 'accountPane', 'settingsPane', 'minimize', 'maximize', 'windowClose']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`缺少独立外壳控件：${id}`);
}
for (const selector of ['.titlebar', 'aside{', 'main{', '.rail{', '.signalWorkspace', 'dialog{']) {
  if (!css.includes(selector)) throw new Error(`缺少外壳布局样式：${selector}`);
}
if (/\.innerHTML\s*=/.test(app)) throw new Error('渲染器禁止使用 innerHTML 写入界面');
for (const preference of ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', 'webSecurity: true']) {
  if (!main.includes(preference)) throw new Error(`缺少安全配置：${preference}`);
}
console.log('独立中文外壳静态验收通过');
