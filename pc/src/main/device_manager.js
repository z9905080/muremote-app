/**
 * MuRemote - ADB Device Manager
 * 負責管理 ADB 連接和設備發現
 */

const { exec } = require('child_process');
const log = require('electron-log');

class DeviceManager {
  constructor() {
    this.devices = [];
    this.primaryDevice = null;
    this.adbPath = 'adb'; // 可以自定義 ADB 路徑
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
   * 連接 MuMu 模擬器
   */
  async connectMuMu() {
    const muMuPorts = [
      { host: '127.0.0.1', port: 7555 },   // MuMu 模擬器默認端口
      { host: '127.0.0.1', port: 7556 },   // MuMu 模擬器 2
      { host: '127.0.0.1', port: 21503 },  // 夜神模擬器
      { host: '127.0.0.1', port: 5555 },   // 雷電模擬器
    ];

    for (const muMu of muMuPorts) {
      try {
        await this.connectDevice(muMu.host, muMu.port);
        log.info(`Connected to ${muMu.host}:${muMu.port}`);
      } catch (e) {
        // 繼續嘗試下一個
      }
    }
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
            
            // 檢測是否是 MuMu 模擬器
            if (device.model && device.model.includes('MuMu')) {
              device.isMuMu = true;
            }
            
            this.devices.push(device);
          }
        }

        // 選擇主要設備 (優先選擇 MuMu)
        this.primaryDevice = this.devices.find(d => d.isMuMu) || this.devices[0];
        
        log.info(`Found ${this.devices.length} device(s)`, 
          this.primaryDevice ? `, primary: ${this.primaryDevice.id}` : '');
        
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
   */
  async isMuMuRunning() {
    // 嘗試連接 MuMu
    await this.connectDevice('127.0.0.1', 7555);
    await this.refreshDevices();
    return this.devices.some(d => d.id.includes('7555'));
  }
}

module.exports = DeviceManager;
