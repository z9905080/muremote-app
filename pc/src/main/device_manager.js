/**
 * MuRemote - ADB Device Manager
 * 負責管理 ADB 連接和設備發現
 * 支持多模擬器：MuMu、夜神、雷電、BlueStacks 等
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('electron-log');
const config = require('../config');
const iconv = require('iconv-lite');

// Windows 中文環境下 ADB 輸出為 GBK/CP936，需正確解碼避免亂碼
const EXEC_OPTS = process.platform === 'win32'
  ? { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }
  : {};
function decodeOutput(buf) {
  if (!buf) return '';
  if (Buffer.isBuffer(buf)) {
    try {
      return iconv.decode(buf, 'cp936');
    } catch (e) {
      return buf.toString('utf8');
    }
  }
  return String(buf);
}

/**
 * 模擬器配置定義
 * 包含常見模擬器的連接端口和識別特徵
 */
const EMULATOR_CONFIGS = {
  mumu: {
    name: 'MuMu 模擬器',
    nameZh: 'MuMu 模擬器',
    ports: [7555, 7556, 7557, 7558],  // MuMu 多開端口
    modelPatterns: ['MuMu', 'mumu', 'Netease'],
    productPatterns: ['mumu', 'MuMu'],
  },
  nox: {
    name: 'Nox 夜神模擬器',
    nameZh: '夜神模擬器',
    ports: [21503, 21501, 21502],  // Nox 端口
    modelPatterns: ['Nox', 'nox', '夜神'],
    productPatterns: ['nox', 'Nox'],
  },
  ldplayer: {
    name: 'LDPlayer 雷電模擬器',
    nameZh: '雷電模擬器',
    ports: [5555, 5556, 5557, 5558],  // LDPlayer 端口
    modelPatterns: ['LDPlayer', 'ldplayer', '雷電', 'Lightning'],
    productPatterns: ['ld', 'LDPlayer'],
  },
  bluestacks: {
    name: 'BlueStacks',
    nameZh: 'BlueStacks',
    ports: [5554, 5555, 5556],  // BlueStacks 端口
    modelPatterns: ['BlueStacks', 'bluestacks', 'Bstick'],
    productPatterns: ['bluestacks', 'bstack'],
  },
  genymotion: {
    name: 'Genymotion',
    nameZh: 'Genymotion',
    ports: [5555, 5556, 5557],  // Genymotion 端口
    modelPatterns: ['Genymotion', 'vbox86p'],
    productPatterns: ['genymotion', 'vbox'],
  },
  memu: {
    name: 'Memu 逍遙模擬器',
    nameZh: '逍遙模擬器',
    ports: [21503, 21504, 21505],  // Memu 端口 (與 Nox 類似)
    modelPatterns: ['Memu', 'memu', '逍遙'],
    productPatterns: ['memu', 'Memu'],
  },
  koplayer: {
    name: 'KOPlayer',
    nameZh: 'KOPlayer',
    ports: [5555, 5556],
    modelPatterns: ['KOPlayer', 'koplayer'],
    productPatterns: ['koplayer', 'KO'],
  },
};

class DeviceManager {
  constructor() {
    this.devices = [];
    this.primaryDevice = null;
    this.adbPath = 'adb'; // 可以自定義 ADB 路徑
    this.emulatorType = null; // 手動設置的模擬器類型
    this.adbAvailable = false; // ADB 是否可用
    this.adbVersion = ''; // ADB 版本字串
  }

  /**
   * 獲取所有支持的模擬器配置
   */
  getEmulatorConfigs() {
    return EMULATOR_CONFIGS;
  }

  /**
   * 設置手動選擇的模擬器類型
   * @param {string} type - 模擬器類型 key (如 'mumu', 'nox', 'ldplayer')
   */
  setEmulatorType(type) {
    if (EMULATOR_CONFIGS[type]) {
      this.emulatorType = type;
      log.info(`Manual emulator type set to: ${EMULATOR_CONFIGS[type].nameZh}`);
      return true;
    }
    log.warn(`Unknown emulator type: ${type}`);
    return false;
  }

  /**
   * 取得打包進應用程式的 ADB 路徑 (打包後優先使用)
   */
  getBundledAdbPath() {
    const candidates = [];
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        // 打包後：嘗試多種路徑 (NSIS 安裝後結構可能不同)
        if (process.resourcesPath) {
          candidates.push(path.join(process.resourcesPath, 'adb', 'windows', 'adb.exe'));
        }
        // 備用：從 exe 所在目錄找 resources
        const exeDir = path.dirname(process.execPath);
        candidates.push(path.join(exeDir, 'resources', 'adb', 'windows', 'adb.exe'));
      } else {
        // 開發模式：從專案根目錄找
        candidates.push(path.join(__dirname, '..', '..', 'resources', 'adb', 'windows', 'adb.exe'));
      }
    } catch (e) {
      candidates.push(path.join(__dirname, '..', '..', 'resources', 'adb', 'windows', 'adb.exe'));
    }
    for (const adbPath of candidates) {
      if (fs.existsSync(adbPath)) {
        log.info('Using bundled ADB:', adbPath);
        return adbPath;
      }
    }
    return null;
  }

  /**
   * Windows 上自動偵測 ADB 路徑 (打包 ADB > MuMu > Android SDK 等)
   */
  findAdbPath() {
    if (process.platform !== 'win32') return null;

    // 1. 優先使用打包進來的 ADB
    const bundled = this.getBundledAdbPath();
    if (bundled) return bundled;

    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const programFilesD = (process.env.PROGRAMFILES || 'C:\\Program Files').replace(/^[A-Z]:/, 'D:');
    const candidates = [
      // MuMu 12 (官方路徑: ~\Netease\MuMuPlayer-12.0\shell)
      path.join(os.homedir(), 'Netease', 'MuMuPlayer-12.0', 'shell', 'adb.exe'),
      path.join(programFiles, 'Netease', 'MuMu Player 12', 'emulator', 'nemu', 'adb.exe'),
      path.join(programFiles, 'Netease', 'MuMu Player 12', 'shell', 'adb.exe'),
      path.join(programFiles, 'Netease', 'MuMuPlayer-12.0', 'shell', 'adb.exe'),
      path.join(programFilesD, 'Netease', 'MuMu Player 12', 'shell', 'adb.exe'),
      // MuMu 6
      path.join(programFiles, 'Netease', 'MuMu Player 6', 'emulator', 'nemu', 'adb.exe'),
      path.join(programFiles, 'Netease', 'MuMu 6', 'emulator', 'nemu', 'adb.exe'),
      // 夜神 Nox
      path.join(programFiles, 'Nox', 'bin', 'adb.exe'),
      path.join(programFilesX86, 'Nox', 'bin', 'adb.exe'),
      // 雷電 LDPlayer
      path.join(programFiles, 'LDPlayer', 'LDPlayer9', 'adb.exe'),
      path.join(programFiles, 'LDPlayer', 'LDPlayer4', 'adb.exe'),
      path.join(programFiles, 'LDPlayer', 'adb.exe'),
      // Android SDK
      path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        log.info('Auto-detected ADB path:', p);
        // Windows 路徑含空格時需加引號
        return p.includes(' ') ? `"${p}"` : p;
      }
    }
    return null;
  }

  /**
   * 初始化 ADB 連接
   */
  async initialize() {
    log.info('Initializing ADB connection...');

    // 解析 ADB 路徑：config > 自動偵測(Windows) > 預設 'adb'
    if (config.adb && config.adb.path) {
      const p = config.adb.path.trim().replace(/^"|"$/g, '');
      this.adbPath = p.includes(' ') ? `"${p}"` : p;
      log.info('Using configured ADB path:', this.adbPath);
    } else if (this.adbPath === 'adb') {
      const found = this.findAdbPath();
      if (found) this.adbPath = found;
    }

    // 檢查 ADB 是否可用
    this.adbAvailable = await this.checkAdb();
    if (!this.adbAvailable) {
      log.error('ADB not found. Please install MuMu emulator or set config.adb.path');
      return false;
    }

    // 嘗試連接 MuMu 模擬器
    await this.connectMuMu();
    
    // 獲取設備列表
    await this.refreshDevices();
    
    return this.devices.length > 0;
  }

  /**
   * 檢查 ADB 是否可用
   */
  async checkAdb() {
    return new Promise((resolve) => {
      exec(`${this.adbPath} version`, EXEC_OPTS, (error, stdout, stderr) => {
        const out = decodeOutput(stdout);
        const err = decodeOutput(stderr);
        if (error) {
          log.error('ADB check failed:', err || out || error.message);
          resolve(false);
        } else {
          this.adbVersion = out.split('\n')[0] || 'unknown';
          log.info('ADB version:', this.adbVersion);
          if (out.trim()) log.info('adb version stdout:', out.trim());
          resolve(true);
        }
      });
    });
  }

  /**
   * 連接所有支持的模擬器
   * 根據 EMULATOR_CONFIGS 自動發現並連接
   */
  async connectEmulators() {
    const hosts = ['127.0.0.1', 'localhost'];
    const connectedPorts = new Set();

    // 如果有手動設置的模擬器類型，優先連接該類型
    if (this.emulatorType && EMULATOR_CONFIGS[this.emulatorType]) {
      const config = EMULATOR_CONFIGS[this.emulatorType];
      log.info(`優先連接指定模擬器: ${config.nameZh}`);
      
      for (const host of hosts) {
        for (const port of config.ports) {
          const key = `${host}:${port}`;
          if (!connectedPorts.has(key)) {
            try {
              await this.connectDevice(host, port);
              connectedPorts.add(key);
              log.info(`已連接 ${config.nameZh} ${host}:${port}`);
            } catch (e) {
              // 繼續嘗試下一個
            }
          }
        }
      }
    } else {
      // 自動發現所有支持的模擬器
      for (const [type, config] of Object.entries(EMULATOR_CONFIGS)) {
        for (const host of hosts) {
          for (const port of config.ports) {
            const key = `${host}:${port}`;
            if (!connectedPorts.has(key)) {
              try {
                await this.connectDevice(host, port);
                connectedPorts.add(key);
                log.info(`已連接 ${config.nameZh} ${host}:${port}`);
              } catch (e) {
                // 繼續嘗試下一個
              }
            }
          }
        }
      }
    }
  }

  /**
   * 連接特定模擬器
   * @param {string} type - 模擬器類型
   */
  async connectEmulator(type) {
    if (!EMULATOR_CONFIGS[type]) {
      throw new Error(`不支援的模擬器類型: ${type}`);
    }

    const config = EMULATOR_CONFIGS[type];
    const hosts = ['127.0.0.1', 'localhost'];
    const connectedPorts = new Set();

    for (const host of hosts) {
      for (const port of config.ports) {
        const key = `${host}:${port}`;
        if (!connectedPorts.has(key)) {
          try {
            await this.connectDevice(host, port);
            connectedPorts.add(key);
            log.info(`已連接 ${config.nameZh} ${host}:${port}`);
          } catch (e) {
            // 繼續嘗試下一個
          }
        }
      }
    }
  }

  /**
   * 連接 MuMu 模擬器 (向後兼容)
   */
  async connectMuMu() {
    await this.connectEmulators();
  }

  /**
   * 連接特定設備
   */
  async connectDevice(host, port) {
    return new Promise((resolve, reject) => {
      exec(`${this.adbPath} connect ${host}:${port}`, EXEC_OPTS, (error, stdout, stderr) => {
        const out = decodeOutput(stdout);
        const err = decodeOutput(stderr);
        if (error) {
          const msg = err || out || error.message;
          log.error('Connect failed:', msg);
          reject(new Error(msg));
        } else {
          const result = (out || err).trim();
          log.info('Connect result stdout:', result);
          resolve(true);
        }
      });
    });
  }

  /**
   * 連接自定義端口的設備
   * 用於支援未預設的模擬器
   * @param {string} host - 主機地址
   * @param {number} port - 端口
   * @param {string} name - 設備名稱（可選）
   */
  async connectCustomDevice(host, port, name = '自訂設備') {
    log.info(`連接自訂設備: ${host}:${port} (${name})`);
    await this.connectDevice(host, port);
    await this.refreshDevices();
    
    // 標記為自訂設備
    const device = this.devices.find(d => d.id.includes(port.toString()));
    if (device) {
      device.emulatorType = 'custom';
      device.emulatorName = name;
      device.isEmulator = true;
    }
    
    return device;
  }

  /**
   * 檢測設備類型
   * 根據型號和產品信息判斷模擬器類型
   */
  detectEmulatorType(device) {
    const model = (device.model || '').toLowerCase();
    const product = (device.product || '').toLowerCase();
    const deviceName = (device.device || '').toLowerCase();

    for (const [type, config] of Object.entries(EMULATOR_CONFIGS)) {
      // 檢查型號匹配
      for (const pattern of config.modelPatterns) {
        if (model.includes(pattern.toLowerCase())) {
          return { type, ...config };
        }
      }
      // 檢查產品匹配
      for (const pattern of config.productPatterns) {
        if (product.includes(pattern.toLowerCase())) {
          return { type, ...config };
        }
      }
      // 檢查設備名匹配
      for (const pattern of config.productPatterns) {
        if (deviceName.includes(pattern.toLowerCase())) {
          return { type, ...config };
        }
      }
    }

    return null; // 無法識別，可能是真機
  }

  /**
   * 刷新設備列表
   */
  async refreshDevices() {
    if (!this.adbAvailable) {
      this.devices = [];
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      exec(`${this.adbPath} devices -l`, EXEC_OPTS, (error, stdout, stderr) => {
        const out = decodeOutput(stdout);
        const err = decodeOutput(stderr);
        if (error) {
          log.error('Failed to get devices:', err || out || error.message);
          this.devices = [];
          reject(error);
          return;
        }
        if (out.trim()) log.info('devices stdout:', out.trim());

        const lines = out.split('\n').filter(line => line.trim());
        this.devices = [];

        for (let i = 1; i < lines.length; i++) { // 跳過標題行
          const parts = lines[i].split(/\s+/);
          if (parts.length >= 2) {
            const device = {
              id: parts[0],
              status: parts[1],
              // 解析其他屬性
              product: this.extractProperty(lines[i], 'product:'),
              model: this.extractProperty(lines[i], 'model:'),
              device: this.extractProperty(lines[i], 'device:'),
              transport_id: this.extractProperty(lines[i], 'transport_id:'),
            };
            
            // 檢測模擬器類型
            const emulatorInfo = this.detectEmulatorType(device);
            if (emulatorInfo) {
              device.emulatorType = emulatorInfo.type;
              device.emulatorName = emulatorInfo.nameZh;
              device.isEmulator = true;
              
              // 向後兼容舊的標識
              if (emulatorInfo.type === 'mumu') {
                device.isMuMu = true;
              }
            } else {
              device.emulatorType = 'unknown';
              device.emulatorName = device.model || '未知設備';
              device.isEmulator = false;
            }
            
            this.devices.push(device);
          }
        }

        // 選擇主要設備 (優先選擇手動設置的模擬器類型)
        if (this.emulatorType) {
          this.primaryDevice = this.devices.find(d => d.emulatorType === this.emulatorType) || this.devices[0];
        } else {
          // 優先選擇已知的模擬器
          this.primaryDevice = this.devices.find(d => d.isEmulator) || this.devices[0];
        }
        
        log.info(`找到 ${this.devices.length} 個設備`, 
          this.primaryDevice ? `, 主要: ${this.primaryDevice.emulatorName || this.primaryDevice.id}` : '');
        
        resolve(this.devices);
      });
    });
  }

  /**
   * 提取設備屬性
   */
  extractProperty(line, key) {
    const match = line.match(new RegExp(`${key}(\\S+)`));
    return match ? match[1] : null;
  }

  /**
   * 獲取主要設備
   */
  getPrimaryDevice() {
    return this.primaryDevice;
  }

  /**
   * 執行 ADB Shell 命令
   */
  async shell(command) {
    if (!this.primaryDevice) {
      throw new Error('No device connected');
    }

    return new Promise((resolve, reject) => {
      exec(`${this.adbPath} -s ${this.primaryDevice.id} shell "${command}"`, EXEC_OPTS,
        (error, stdout, stderr) => {
          const out = decodeOutput(stdout);
          const err = decodeOutput(stderr);
          if (error) {
            log.error('Shell error:', err || out || error.message);
            reject(error);
          } else {
            if (out.trim()) log.info('shell stdout:', out.trim());
            resolve(out);
          }
        });
    });
  }

  /**
   * 獲取設備屬性
   */
  async getDeviceProperty(property) {
    try {
      const result = await this.shell(`getprop ${property}`);
      return result.trim();
    } catch (e) {
      return null;
    }
  }

  /**
   * 獲取螢幕解析度
   */
  async getScreenSize() {
    try {
      const result = await this.shell('wm size');
      const match = result.match(/(\d+)x(\d+)/);
      if (match) {
        return {
          width: parseInt(match[1]),
          height: parseInt(match[2])
        };
      }
    } catch (e) {
      log.error('Failed to get screen size:', e);
    }
    return { width: 1080, height: 1920 }; // 默認值
  }

  /**
   * 獲取設備型號
   */
  async getModel() {
    return await this.getDeviceProperty('ro.product.model') || 'Unknown';
  }

  /**
   * 獲取 Android 版本
   */
  async getAndroidVersion() {
    return await this.getDeviceProperty('ro.build.version.release') || 'Unknown';
  }

  /**
   * 重啟 ADB
   */
  async restart() {
    return new Promise((resolve, reject) => {
      exec(`${this.adbPath} kill-server && ${this.adbPath} start-server`, EXEC_OPTS,
        (error, stdout, stderr) => {
          const out = decodeOutput(stdout);
          const err = decodeOutput(stderr);
          if (error) {
            log.error('ADB restart failed:', err || out || error.message);
            reject(error);
          } else {
            log.info('ADB restarted');
            if (out.trim()) log.info('restart stdout:', out.trim());
            resolve(true);
          }
        });
    });
  }

  /**
   * 檢查模擬器是否運行中
   * @param {string} type - 模擬器類型，預設檢查所有
   */
  async isEmulatorRunning(type = null) {
    if (type && EMULATOR_CONFIGS[type]) {
      const config = EMULATOR_CONFIGS[type];
      for (const port of config.ports) {
        try {
          await this.connectDevice('127.0.0.1', port);
        } catch (e) {
          // 繼續檢查下一個端口
        }
      }
    } else {
      // 檢查所有支持的模擬器
      await this.connectEmulators();
    }
    
    await this.refreshDevices();
    
    if (type) {
      return this.devices.some(d => d.emulatorType === type);
    }
    return this.devices.length > 0;
  }

  /**
   * 檢查 MuMu 模擬器是否運行中 (向後兼容)
   */
  async isMuMuRunning() {
    return await this.isEmulatorRunning('mumu');
  }

  /**
   * 獲取設備的詳細信息
   * @param {string} deviceId - 設備 ID
   */
  async getDeviceInfo(deviceId) {
    const device = this.devices.find(d => d.id === deviceId);
    if (!device) {
      return null;
    }

    try {
      const info = {
        ...device,
        screenSize: await this.getScreenSize(),
        model: await this.getModel(),
        androidVersion: await this.getAndroidVersion(),
      };
      return info;
    } catch (e) {
      log.error('Failed to get device info:', e);
      return device;
    }
  }
}

module.exports = DeviceManager;
