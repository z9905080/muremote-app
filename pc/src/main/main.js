const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { AdbClient } = require('adbkit');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const log = require('electron-log');

log.transports.file.level = 'info';
log.info('MuRemote PC Client starting...');

let mainWindow = null;
let tray = null;
let adbClient = null;
let wsServer = null;
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
      // Create a simple colored icon if file doesn't exist
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
    
    // Try to list devices
    const devices = await adbClient.listDevices();
    log.info('ADB devices:', devices.length);

    // Try to connect to MuMu if not already connected
    try {
      await adbClient.connect('127.0.0.1:7555');
      log.info('Connected to MuMu emulator');
    } catch (e) {
      log.warn('Could not connect to MuMu:', e.message);
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
        await handleClientMessage(clientId, data);
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

async function handleClientMessage(clientId, data) {
  const client = connectedClients.get(clientId);
  if (!client) return;

  switch (data.type) {
    case 'offer':
      // Handle WebRTC offer from mobile
      log.info('Received WebRTC offer');
      // TODO: Implement WebRTC signaling
      break;

    case 'ice-candidate':
      // Handle ICE candidate exchange
      log.info('Received ICE candidate');
      break;

    case 'touch':
      await handleTouchInput(data);
      break;

    case 'get-stats':
      sendStats(client.ws);
      break;
  }
}

async function handleTouchInput(data) {
  if (!adbClient) return;

  try {
    const devices = await adbClient.listDevices();
    if (devices.length === 0) return;

    const device = devices[0];
    const { action, x, y } = data;

    // Convert coordinates based on screen resolution
    // TODO: Get actual screen resolution from device
    const screenWidth = 1080;
    const screenHeight = 1920;

    const adbX = Math.floor(x * screenWidth);
    const adbY = Math.floor(y * screenHeight);

    let adbAction;
    switch (action) {
      case 'down':
        adbAction = 'down';
        break;
      case 'up':
        adbAction = 'up';
        break;
      case 'move':
        adbAction = 'move';
        break;
      default:
        return;
    }

    // Send touch event via ADB
    await adbClient.shell(device.id, 
      `input tap ${adbX} ${adbY}`
    );

    log.info(`Touch: ${action} at ${adbX}, ${adbY}`);
  } catch (e) {
    log.error('Touch input error:', e);
  }
}

function sendStats(ws) {
  const stats = {
    type: 'stats',
    latency: Math.floor(Math.random() * 50) + 30, // Simulated
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
  
  // Connect to ADB
  await connectADB();
  
  // Start WebSocket server
  startWebSocketServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit, minimize to tray
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (wsServer) wsServer.close();
  log.info('MuRemote PC Client shutting down');
});

log.info('Main process initialized');
