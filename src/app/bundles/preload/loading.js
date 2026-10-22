const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('SignalContext', {
  i18n: () => '正在初始化账号资料…'
});
