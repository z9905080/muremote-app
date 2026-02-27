/**
 * Emulator Support Manager
 * 多模擬器支援管理
 */

const log = require('electron-log');

// 模擬器配置
const EMULATOR_CONFIGS = {
  mumu: {
    name: 'MuMu 模擬器',
    adbPort: 7555,
    adbPort2: 7556,
    features: ['screenrecord', 'screencap', 'input'],
  },
  ldplayer: {
    name: '雷電模擬器',
    adbPort: 5555,
    adbPort2: 5556,
    features: ['screenrecord', 'screencap', 'input'],
  },
  nox: {
    name: '夜神模擬器',
    adbPort: 21503,
    adbPort2: 21504,
    features: ['screenrecord', 'screencap', 'input'],
  },
  bluestacks: {
    name: 'BlueStacks',
    adbPort: 5555,
    adbPort2: 5556,
    features: ['screenrecord', 'screencap', 'input'],
  },
  leidian: {
    name: '雷電模擬器 (LDPlayer)',
    adbPort: 5555,
    adbPort2: 5556,
    features: ['screenrecord', 'screencap', 'input'],
  }
};

class EmulatorSupportManager {
  constructor() {
    this.supportedEmulators = EMULATOR_CONFIGS;
    this.detectedEmulators = [];
    this.preferredEmulator = null;
  }

  /**
   * 檢測已安裝的模擬器
   */
  async detectEmulators() {
    this.detectedEmulators = [];
    
    for (const [key, config] of Object.entries(this.supportedEmulators)) {
      const isDetected = await this.checkEmulator(key, config);
      if (isDetected) {
        this.detectedEmulators.push({
          id: key,
          name: config.name,
          port: config.adbPort,
        });
        log.info(`Detected emulator: ${config.name}`);
      }
    }

    return this.detectedEmulators;
  }

  /**
   * 檢查特定模擬器
   */
  async checkEmulator(key, config) {
    // 嘗試連接模擬器的 ADB 端口
    const ports = [config.adbPort, config.adbPort2];
    
    for (const port of ports) {
      try {
        // 嘗試連接
        const { exec } = require('child_process');
        
        return new Promise((resolve) => {
          exec(`adb connect 127.0.0.1:${port}`, (error, stdout, stderr) => {
            if (!error && stdout.includes('connected')) {
              resolve(true);
            } else {
              // 檢查是否已經連接
              exec('adb devices', (err, out) => {
                if (out && out.includes(`127.0.0.1:${port}`)) {
                  resolve(true);
                } else {
                  resolve(false);
                }
              });
            }
          });
        });
      } catch (e) {
        log.warn(`Failed to check emulator on port ${port}:`, e.message);
      }
    }
    
    return false;
  }

  /**
   * 獲取支援的模擬器列表
   */
  getSupportedEmulators() {
    return Object.entries(this.supportedEmulators).map(([key, config]) => ({
      id: key,
      name: config.name,
      features: config.features,
    }));
  }

  /**
   * 獲取已檢測的模擬器
   */
  getDetectedEmulators() {
    return this.detectedEmulators;
  }

  /**
   * 設定首選模擬器
   */
  setPreferredEmulator(emulatorId) {
    if (this.supportedEmulators[emulatorId]) {
      this.preferredEmulator = emulatorId;
      log.info(`Preferred emulator set to: ${emulatorId}`);
      return true;
    }
    return false;
  }

  /**
   * 獲取首選模擬器配置
   */
  getPreferredConfig() {
    if (!this.preferredEmulator) {
      // 嘗試自動選擇第一個檢測到的模擬器
      if (this.detectedEmulators.length > 0) {
        this.preferredEmulator = this.detectedEmulators[0].id;
      } else {
        // 默認使用 MuMu
        this.preferredEmulator = 'mumu';
      }
    }
    
    return this.supportedEmulators[this.preferredEmulator];
  }

  /**
   * 獲取 ADB 連接命令
   */
  getADBConnectCommand() {
    const config = this.getPreferredConfig();
    return `adb connect 127.0.0.1:${config.adbPort}`;
  }

  /**
   * 添加自定義模擬器
   */
  addCustomEmulator(id, name, adbPort, features = []) {
    this.supportedEmulators[id] = {
      name,
      adbPort,
      adbPort2: adbPort + 1,
      features: features.length > 0 ? features : ['screenrecord', 'screencap', 'input'],
    };
    log.info(`Added custom emulator: ${name} (${id})`);
  }

  /**
   * 移除模擬器
   */
  removeEmulator(id) {
    if (this.supportedEmulators[id]) {
      delete this.supportedEmulators[id];
      log.info(`Removed emulator: ${id}`);
      return true;
    }
    return false;
  }
}

module.exports = EmulatorSupportManager;
