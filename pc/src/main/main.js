const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { AdbClient } = require('adbkit');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const log = require('electron-log');
const Streamer = require('./streamer');
const TouchHandler = require('./touch_handler');
const MultiTouchHandler = require('./multi_touch_handler');
const MdnsAdvertiser = require('./mdns_advertiser');
const config = require('../config');

log.transports.file.level = 'info';
log.info('MuRemote PC Client starting...');

let mainWindow = null;
let tray = null;
let adbClient = null;
let wsServer = null;
let streamer = null;
let touchHandler = null;
let multiTouchHandler = null;
let mdnsAdvertiser = null;
let connectedClients = new Map();
let pcId = uuidv4().substring(0, 8).toUpperCase();

// ADB connection settings
const ADB_HOST = '127.0.0.1';
const ADB_PORT = 7555; // MuMu default ADB port

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'src/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    resizable: false,
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
    adbClient = AdbClient.createClient({ host: ADB_HOST, port: ADB_PORT });
    
    const devices = await adbClient.listDevices();
    log.info('ADB devices:', devices.length);

    if (devices.length > 0) {
      const device = devices[0];
      
      // 初始化 Streamer 和 TouchHandler
      streamer = new Streamer(adbClient, device.id);
      touchHandler = new TouchHandler(adbClient, device.id);
      multiTouchHandler = new MultiTouchHandler(touchHandler);
      
      // 獲取螢幕大小
      await touchHandler.updateScreenSize();
      
      log.info('Connected to device:', device.id);
    }

    return true;
  } catch (error) {
    log.error('ADB connection error:', error);
    return false;
  }
}

function startWebSocketServer() {
  wsServer = new WebSocketServer({ port: 8080 });

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

  log.info('WebSocket server started on port 8080');
}

async function handleClientMessage(clientId, ws, data) {
  switch (data.type) {
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
  if (!adbClient) return 'not_connected';
  try {
    const devices = await adbClient.listDevices();
    return devices.length > 0 ? 'connected' : 'no_devices';
  } catch (e) {
    return 'error';
  }
});

app.whenReady().then(async () => {
  createWindow();
  createTray();
  
  await connectADB();
  startWebSocketServer();

  // 啟動 mDNS 服務發現
  if (config.mdns && config.mdns.advertise) {
    mdnsAdvertiser = new MdnsAdvertiser(pcId, config.websocket.port);
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
  log.info('MuRemote PC Client shutting down');
});

log.info('Main process initialized');
