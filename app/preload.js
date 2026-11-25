'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kd', {
  api: (method, route, body) => ipcRenderer.invoke('kd:api', method, route, body),
  settings: () => ipcRenderer.invoke('kd:settings'),
  setStartup: (on) => ipcRenderer.invoke('kd:setStartup', on),
  chooseFolder: (which) => ipcRenderer.invoke('kd:chooseFolder', which || 'out'),
  clearFolder: (which) => ipcRenderer.invoke('kd:clearFolder', which),
  openPath: (p) => ipcRenderer.invoke('kd:openPath', p),
  showItem: (p) => ipcRenderer.invoke('kd:showItem', p),
  openExternal: (url) => ipcRenderer.invoke('kd:openExternal', url),
  copy: (text) => ipcRenderer.invoke('kd:copy', text),
  readClipboard: () => ipcRenderer.invoke('kd:readClipboard'),
  registerMcp: () => ipcRenderer.invoke('kd:registerMcp'),
  claudeStatus: () => ipcRenderer.invoke('kd:claudeStatus'),
  openExtensionsPage: (which) => ipcRenderer.invoke('kd:openExtensionsPage', which),
  setupDone: () => ipcRenderer.invoke('kd:setupDone'),
  restartHelper: () => ipcRenderer.invoke('kd:restartHelper'),
  onNavigate: (fn) => ipcRenderer.on('kd:navigate', (e, page) => fn(page)),
  browser: (action, arg) => ipcRenderer.invoke('kd:browser', action, arg),
  browserShow: (on) => ipcRenderer.invoke('kd:browserShow', on),
  browserBounds: (b) => ipcRenderer.invoke('kd:browserBounds', b),
  onBrowserState: (fn) => ipcRenderer.on('kd:browserState', (e, s) => fn(s)),
  onToast: (fn) => ipcRenderer.on('kd:toast', (e, t) => fn(t)),
  update: (action, value) => ipcRenderer.invoke('kd:update', action, value),
  onUpdate: (fn) => ipcRenderer.on('kd:update', (e, s) => fn(s)),
});
