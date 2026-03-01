const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const net = require('net');
const util = require('util');
const { AdbClient } = require('adbkit');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const log = require('electron-log');
const Streamer = require('./streamer');
const TouchHandler = require('./touch_handler');
const MultiTouchHandler = require('./multi_touch_handler');
const MdnsAdvertiser = require('./mdns_advertiser');
const DeviceManager = require('./device_manager');
const MultiInstanceManager = require('./multi_instance_manager');
const ReconnectionManager = require('./reconnection_manager');
const config = require('../config');

log.transports.file.level = 'info';

// 將 log 轉發到 renderer 供 UI 顯示
log.hooks.push((message, transport, transportName) => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    const time = message.date.toLocaleTimeString('zh-TW', { hour12: false });
    const text = message.data.map(d => typeof d === 'object' ? util.inspect(d) : String(d)).join(' ');
    mainWindow.webContents.send('app-log', { level: message.level, time, text });
  }
  return message;
});

// 攔截 stdout/stderr，統一轉發到 electron-log（寫檔 + UI）
// 用 flag 避免 log 本身寫 stdout 造成無限迴圈
let _logIntercepting = false;
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
const _origStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = (chunk, encoding, callback) => {
  if (!_logIntercepting) {
    _logIntercepting = true;
    const text = chunk.toString().trimEnd();
    if (text) log.info(text);
    _logIntercepting = false;
  }
  return _origStdoutWrite(chunk, encoding, callback);
};

process.stderr.write = (chunk, encoding, callback) => {
  if (!_logIntercepting) {
    _logIntercepting = true;
    const text = chunk.toString().trimEnd();
    if (text) log.error(text);
    _logIntercepting = false;
  }
  return _origStderrWrite(chunk, encoding, callback);
};

log.info('MuRemote PC Client starting...');

let mainWindow = null;
let tray = null;
let adbClient = null;
let wsServer = null;
let streamer = null;
let touchHandler = null;
let multiTouchHandler = null;
let mdnsAdvertiser = null;
let deviceManager = null;
let multiInstanceManager = null;
let reconnectionManager = null;
let connectedClients = new Map();
let pcId = uuidv4().substring(0, 8).toUpperCase();

// ADB connection settings
const ADB_HOST = '127.0.0.1';
const ADB_PORT = 7555; // MuMu default ADB port

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 480,
    minWidth: 400,
    minHeight: 360,
    webPreferences: {
      preload: path.join(__dirname, 'src/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    resizable: true,
    alwaysOnTop: true,
  });

  mainWindow.loadFile('src/renderer/index.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  log.info('Main window created');
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '顯示', click: () => mainWindow.show() },
    { label: 'ID: ' + pcId, enabled: false },
    { type: 'separator' },
    { label: '連線狀態: ' + (connectedClients.size > 0 ? '已連線' : '等待中'), enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('MuRemote - ' + pcId);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });

  log.info('System tray created');
}

async function connectADB() {
  try {
    // 使用 DeviceManager 進行設備管理
    deviceManager = new DeviceManager();
    
    // 初始化多開同步管理器
    multiInstanceManager = new MultiInstanceManager(deviceManager);
    
    // 初始化並連接模擬器
    const connected = await deviceManager.initialize();
    
    if (connected && deviceManager.primaryDevice) {
      const device = deviceManager.primaryDevice;
      
      // 初始化 Streamer 和 TouchHandler
      streamer = new Streamer(deviceManager.adbPath, device.id);
      touchHandler = new TouchHandler(deviceManager.adbPath, device.id);
      multiTouchHandler = new MultiTouchHandler(touchHandler);
      
      // 獲取螢幕大小
      await touchHandler.updateScreenSize();
      
      log.info('Connected to device:', device.id, '- Type:', device.emulatorName || device.emulatorType);
      
      // 如果有主要設備，更新 mDNS 廣告的模擬器類型
      if (mdnsAdvertiser && device.emulatorType) {
        mdnsAdvertiser.setEmulatorType(device.emulatorType);
        mdnsAdvertiser.stop();
        mdnsAdvertiser.start();
        log.info('Updated mDNS with emulator type:', device.emulatorType);
      }
    } else {
      log.info('No emulator connected, waiting for connection...');
    }

    return true;
  } catch (error) {
    log.error('ADB connection error:', error);
    return false;
  }
}

/**
 * 初始化重連管理器
 */
function initReconnectionManager() {
  reconnectionManager = new ReconnectionManager();
  
  // 設置重連回調 - 嘗試重新連接 ADB 設備
  reconnectionManager.setReconnectCallback(async () => {
    log.info('Attempting to reconnect ADB...');
    try {
      const success = await connectADB();
      if (success) {
        log.info('ADB reconnection successful');
        // 通知所有客戶端重新連接
        broadcastToClients({
          type: 'reconnected',
          message: 'Server reconnected to emulator'
        });
        return true;
      }
    } catch (e) {
      log.error('Reconnection failed:', e);
    }
    return false;
  });
  
  // 設置重連參數
  reconnectionManager.setMaxAttempts(10);
  reconnectionManager.setDelays(2000, 60000); // 2秒基礎，最大60秒
  
  log.info('Reconnection manager initialized');
}

/**
 * 檢查設備連接狀態
 */
let deviceCheckInterval = null;

async function checkDeviceConnection() {
  if (!deviceManager) return;
  
  try {
    await deviceManager.refreshDevices();
    
    if (!deviceManager.primaryDevice || deviceManager.devices.length === 0) {
      log.warn('Device disconnected, starting reconnection...');
      
      if (reconnectionManager && !reconnectionManager.isReconnecting) {
        reconnectionManager.startReconnect();
        
        // 通知客戶端
        broadcastToClients({
          type: 'connection_lost',
          message: 'Lost connection to emulator, attempting to reconnect...',
          reconnecting: true
        });
      }
    }
  } catch (e) {
    log.error('Device check error:', e);
  }
}

/**
 * 啟動設備監控
 */
function startDeviceMonitoring() {
  // 每10秒檢查一次設備連接狀態
  deviceCheckInterval = setInterval(checkDeviceConnection, 10000);
  log.info('Device monitoring started');
}

/**
 * 停止設備監控
 */
function stopDeviceMonitoring() {
  if (deviceCheckInterval) {
    clearInterval(deviceCheckInterval);
    deviceCheckInterval = null;
  }
}

/**
 * 廣播消息到所有客戶端
 */
function broadcastToClients(data) {
  const message = JSON.stringify(data);
  for (const [clientId, client] of connectedClients) {
    if (client.ws && client.ws.readyState === 1) {
      client.ws.send(message);
    }
  }
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once('error', () => tryPort(port + 1));
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port);
    };
    tryPort(startPort);
  });
}

async function startWebSocketServer() {
  const port = await findAvailablePort(config.websocket.port);
  wsServer = new WebSocketServer({ port });

  wsServer.on('connection', async (ws, req) => {
    const clientId = uuidv4();
    log.info('New client connected:', clientId);

    connectedClients.set(clientId, { ws, pcId: pcId });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        await handleClientMessage(clientId, ws, data);
      } catch (e) {
        log.error('Message error:', e);
      }
    });

    ws.on('close', () => {
      connectedClients.delete(clientId);
      log.info('Client disconnected:', clientId);
      updateTrayMenu();
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      pcId: pcId,
      status: 'connected'
    }));

    updateTrayMenu();
  });

  log.info(`WebSocket server started on port ${port}`);
  return port;
}

async function handleClientMessage(clientId, ws, data) {
  switch (data.type) {
    case 'connect':
      // 客戶端連線請求，包含元數據（如模擬器類型）
      log.info('Client connection request:', data);
      if (data.metadata && data.metadata.emulatorType) {
        const emulatorType = data.metadata.emulatorType;
        log.info('Client requested emulator type:', emulatorType);
        
        // 如果客戶端指定了模擬器類型，嘗試切換連接
        if (deviceManager && emulatorType !== 'unknown') {
          deviceManager.setEmulatorType(emulatorType);
          // 重新整理設備列表
          await deviceManager.refreshDevices();
          
          if (deviceManager.primaryDevice) {
            // 更新 streamer 和 touch handler
            const device = deviceManager.primaryDevice;
            streamer = new Streamer(deviceManager.adbPath, device.id);
            touchHandler = new TouchHandler(deviceManager.adbPath, device.id);
            multiTouchHandler = new MultiTouchHandler(touchHandler);
            
            log.info('Switched to emulator:', device.emulatorName || emulatorType);
            
            // 發送確認消息
            ws.send(JSON.stringify({
              type: 'connected',
              emulatorType: emulatorType,
              deviceId: device.id,
              screenSize: await touchHandler.updateScreenSize()
            }));
          }
        } else {
          ws.send(JSON.stringify({
            type: 'connected',
            emulatorType: 'unknown'
          }));
        }
      } else {
        ws.send(JSON.stringify({
          type: 'connected',
          emulatorType: deviceManager?.primaryDevice?.emulatorType || 'unknown'
        }));
      }
      break;

    case 'offer':
      // WebRTC offer - not using in POC, using WebSocket streaming instead
      log.info('Received WebRTC offer (using WebSocket streaming instead)');
      break;

    case 'ice-candidate':
      log.info('Received ICE candidate');
      break;

    case 'touch':
      // 觸控事件
      if (touchHandler) {
        await touchHandler.handleTouch(data);
      }
      break;

    case 'multi-touch':
      // 多點觸控事件
      if (multiTouchHandler) {
        await multiTouchHandler.handleMultiTouch(data);
      }
      break;

    case 'key':
      // 鍵盤事件
      if (touchHandler) {
        await touchHandler.sendKey(data.key);
      }
      break;

    case 'text':
      // 文字輸入
      if (touchHandler) {
        await touchHandler.sendText(data.text);
      }
      break;

    case 'start-stream':
      // 開始串流
      if (streamer) {
        streamer.addClient(ws);
        await streamer.startStream(ws);
      }
      break;

    case 'stop-stream':
      // 停止串流
      if (streamer) {
        streamer.stopStream();
      }
      break;

    case 'get-stats':
      sendStats(ws);
      break;
      
    case 'get-screen-size':
      // 獲取螢幕大小
      if (touchHandler) {
        ws.send(JSON.stringify({
          type: 'screen-size',
          width: touchHandler.screenWidth,
          height: touchHandler.screenHeight
        }));
      }
      break;

    case 'set-quality':
      // 設定畫質
      if (streamer) {
        streamer.setQuality(data.quality || '720p');
        ws.send(JSON.stringify({
          type: 'quality-changed',
          quality: data.quality
        }));
      }
      break;

    case 'set-fps':
      // 設定幀率
      if (streamer) {
        streamer.setFps(data.fps || 30);
        ws.send(JSON.stringify({
          type: 'fps-changed',
          fps: data.fps
        }));
      }
      break;

    case 'screenshot':
      // 請求截圖
      if (streamer) {
        await streamer.requestScreenshot(ws);
      }
      break;

    // Multi-instance sync handlers
    case 'get-devices':
      // 獲取所有可用設備
      if (deviceManager) {
        await deviceManager.refreshDevices();
        ws.send(JSON.stringify({
          type: 'devices-list',
          devices: deviceManager.devices
        }));
      }
      break;

    case 'get-multi-status':
      // 獲取多開同步狀態
      if (multiInstanceManager) {
        ws.send(JSON.stringify({
          type: 'multi-status',
          status: multiInstanceManager.getStatus()
        }));
      }
      break;

    case 'sync-touch':
      // 執行同步觸控
      if (multiInstanceManager) {
        const result = await multiInstanceManager.executeSyncTouch(data);
        ws.send(JSON.stringify({
          type: 'sync-result',
          result: result
        }));
      }
      break;

    case 'sync-enable':
      // 啟用同步控制
      if (multiInstanceManager) {
        const success = multiInstanceManager.enableSync();
        ws.send(JSON.stringify({
          type: 'sync-enabled',
          success: success
        }));
      }
      break;

    case 'sync-disable':
      // 停用同步控制
      if (multiInstanceManager) {
        multiInstanceManager.disableSync();
        ws.send(JSON.stringify({
          type: 'sync-disabled',
          success: true
        }));
      }
      break;

    case 'select-sync-device':
      // 選擇同步設備
      if (multiInstanceManager && data.deviceId) {
        const success = multiInstanceManager.selectDevice(data.deviceId);
        ws.send(JSON.stringify({
          type: 'device-selection',
          deviceId: data.deviceId,
          success: success
        }));
      }
      break;

    case 'select-all-sync-devices':
      // 選擇全部設備
      if (multiInstanceManager) {
        multiInstanceManager.selectAllDevices();
        ws.send(JSON.stringify({
          type: 'all-devices-selected',
          count: multiInstanceManager.selectedDevices.size
        }));
      }
      break;
  }
}

function sendStats(ws) {
  const stats = {
    type: 'stats',
    latency: Math.floor(Math.random() * 50) + 30,
    fps: 30,
    resolution: '720p',
    connected: connectedClients.size > 0
  };
  ws.send(JSON.stringify(stats));
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: '顯示', click: () => mainWindow.show() },
    { label: 'ID: ' + pcId, enabled: false },
    { type: 'separator' },
    { label: '連線狀態: ' + (connectedClients.size > 0 ? '已連線 (' + connectedClients.size + ')' : '等待中'), enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
}

// IPC handlers
ipcMain.handle('get-pc-id', () => pcId);
ipcMain.handle('get-connected-count', () => connectedClients.size);
ipcMain.handle('get-adb-status', async () => {
  if (!deviceManager) return 'not_connected';
  if (!deviceManager.adbAvailable) return 'not_connected';
  const count = deviceManager.devices?.length ?? 0;
  return count > 0 ? 'connected' : 'no_devices';
});
ipcMain.handle('get-adb-version', () => {
  return deviceManager?.adbVersion ?? '';
});
ipcMain.handle('get-stream-status', () => {
  return streamer?.isStreaming ? 'active' : 'standby';
});
ipcMain.handle('get-local-ip', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '';
});

// Multi-instance handlers
ipcMain.handle('get-devices', async () => {
  if (!deviceManager) return [];
  await deviceManager.refreshDevices();
  return deviceManager.devices;
});

ipcMain.handle('get-multi-instance-status', () => {
  if (!multiInstanceManager) return null;
  return multiInstanceManager.getStatus();
});

ipcMain.handle('select-device', (event, deviceId) => {
  if (!multiInstanceManager) return false;
  return multiInstanceManager.selectDevice(deviceId);
});

ipcMain.handle('deselect-device', (event, deviceId) => {
  if (!multiInstanceManager) return false;
  return multiInstanceManager.deselectDevice(deviceId);
});

ipcMain.handle('toggle-device', (event, deviceId) => {
  if (!multiInstanceManager) return false;
  return multiInstanceManager.toggleDevice(deviceId);
});

ipcMain.handle('select-all-devices', () => {
  if (!multiInstanceManager) return false;
  multiInstanceManager.selectAllDevices();
  return true;
});

ipcMain.handle('clear-device-selection', () => {
  if (!multiInstanceManager) return false;
  multiInstanceManager.clearSelection();
  return true;
});

ipcMain.handle('enable-sync', () => {
  if (!multiInstanceManager) return false;
  return multiInstanceManager.enableSync();
});

ipcMain.handle('disable-sync', () => {
  if (!multiInstanceManager) return false;
  multiInstanceManager.disableSync();
  return true;
});

ipcMain.handle('toggle-sync', () => {
  if (!multiInstanceManager) return false;
  return multiInstanceManager.toggleSync();
});

app.whenReady().then(async () => {
  createWindow();
  createTray();
  
  await connectADB();
  initReconnectionManager();
  startDeviceMonitoring();
  const wsPort = await startWebSocketServer();

  // 啟動 mDNS 服務發現
  if (config.mdns && config.mdns.advertise) {
    mdnsAdvertiser = new MdnsAdvertiser(pcId, wsPort);
    mdnsAdvertiser.start();
    log.info('mDNS advertiser started');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit, minimize to tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (streamer) streamer.stopStream();
  if (wsServer) wsServer.close();
  if (mdnsAdvertiser) mdnsAdvertiser.stop();
  if (reconnectionManager) reconnectionManager.stopReconnect();
  stopDeviceMonitoring();
  log.info('MuRemote PC Client shutting down');
});

log.info('Main process initialized');
