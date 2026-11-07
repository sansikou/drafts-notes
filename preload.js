/**
 * preload.js — 预加载脚本
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('draftsAPI', {
  notifyReady: () => ipcRenderer.send('editor-ready'),

  onFocusEditor: (callback) => {
    ipcRenderer.on('focus-editor', callback);
  },

  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeGetAll: () => ipcRenderer.invoke('store-get-all'),

  minimizeToBall: () => ipcRenderer.send('minimize-to-ball'),
  closeToTray: () => ipcRenderer.send('close-to-tray'),
});
