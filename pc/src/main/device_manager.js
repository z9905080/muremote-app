/**
 * MuRemote - ADB Device Manager
 * 負責管理 ADB 連接和設備發現
 * 支持多模擬器：MuMu、夜神、雷電、BlueStacks 等
 */

const { exec } = require('child_process');
const log = require('electron-log');

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
   * 初始化 ADB 連接
   */
  async initialize() {
    log.info('Initializing ADB connection...');
    
    // 檢查 ADB 是否可用
    const adbAvailable = await this.checkAdb();
    if (!adbAvailable) {
      log.error('ADB not found');
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
      exec(`${this.adbPath} version`, (error, stdout, stderr) => {
        if (error) {
          log.error('ADB check failed:', error.message);
          resolve(false);
        } else {
          log.info('ADB version:', stdout.split('\n')[0]);
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
      exec(`${this.adbPath} connect ${host}:${port}`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          log.info(`Connect result: ${stdout}`);
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
    return new Promise((resolve, reject) => {
      exec(`${this.adbPath} devices -l`, (error, stdout, stderr) => {
        if (error) {
          log.error('Failed to get devices:', error.message);
          this.devices = [];
          reject(error);
          return;
        }

        const lines = stdout.split('\n').filter(line => line.trim());
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
      exec(`${this.adbPath} -s ${this.primaryDevice.id} shell "${command}"`, 
        (error, stdout, stderr) => {
          if (error) {
            log.error('Shell error:', error.message);
            reject(error);
          } else {
            resolve(stdout);
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
      exec(`${this.adbPath} kill-server && ${this.adbPath} start-server`, 
        (error, stdout, stderr) => {
          if (error) {
            log.error('ADB restart failed:', error.message);
            reject(error);
          } else {
            log.info('ADB restarted');
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
