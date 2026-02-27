const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPcId: () => ipcRenderer.invoke('get-pc-id'),
  getConnectedCount: () => ipcRenderer.invoke('get-connected-count'),
  getAdbStatus: () => ipcRenderer.invoke('get-adb-status'),
});
