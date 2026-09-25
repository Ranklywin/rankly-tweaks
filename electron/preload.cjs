const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rankly', Object.freeze({
  sessionApps: () => ipcRenderer.invoke('rankly:session-apps'),
  closeApps: tokens => ipcRenderer.invoke('rankly:close-apps',tokens),
  status: () => ipcRenderer.invoke('rankly:status'),
  apply: ids => ipcRenderer.invoke('rankly:apply', ids),
  restore: id => ipcRenderer.invoke('rankly:restore', id),
  network: target => ipcRenderer.invoke('rankly:network', target),
  openSettings: id => ipcRenderer.invoke('rankly:settings', id),
  openSource: id => ipcRenderer.invoke('rankly:source', id),
  exportReport: () => ipcRenderer.invoke('rankly:export'),
  windowControl: action => ipcRenderer.invoke('rankly:window', action),
}));
