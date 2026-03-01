const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 基本信息
  getPcId: () => ipcRenderer.invoke('get-pc-id'),
  getConnectedCount: () => ipcRenderer.invoke('get-connected-count'),
  getAdbStatus: () => ipcRenderer.invoke('get-adb-status'),
  getAdbVersion: () => ipcRenderer.invoke('get-adb-version'),
  getStreamStatus: () => ipcRenderer.invoke('get-stream-status'),
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  
  // ADB 控制
  restartAdb: () => ipcRenderer.invoke('restart-adb'),
  
  // 串流控制
  startStream: () => ipcRenderer.invoke('start-stream'),
  stopStream: () => ipcRenderer.invoke('stop-stream'),
  
  // 設置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  
  // 事件監聽
  onConnectionChange: (callback) => {
    ipcRenderer.on('connection-change', (event, data) => callback(data));
  },
  onStreamData: (callback) => {
    ipcRenderer.on('stream-data', (event, data) => callback(data));
  },
  onAppLog: (callback) => {
    ipcRenderer.on('app-log', (event, data) => callback(data));
  },
});
