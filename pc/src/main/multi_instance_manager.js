/**
 * MuRemote - Multi-Instance Manager
 * 負責多模擬器同步控制
 * 支援同時對多個設備執行相同操作
 */

const EventEmitter = require('events');
const log = require('electron-log');

class MultiInstanceManager extends EventEmitter {
  constructor(deviceManager) {
    super();
    this.deviceManager = deviceManager;
    this.selectedDevices = new Set(); // 選擇要同步控制的設備列表
    this.syncEnabled = false; // 同步控制開關
    this.syncMode = 'all'; // 'all': 全部, 'custom': 自定義選擇
  }

  /**
   * 獲取所有可用設備
   */
  getAvailableDevices() {
    return this.deviceManager.devices;
  }

  /**
   * 獲取已選中的設備列表
   */
  getSelectedDevices() {
    return Array.from(this.selectedDevices);
  }

  /**
   * 選擇要同步控制的設備
   * @param {string} deviceId - 設備 ID
   */
  selectDevice(deviceId) {
    const device = this.deviceManager.devices.find(d => d.id === deviceId);
    if (device) {
      this.selectedDevices.add(deviceId);
      log.info(`設備已選中: ${deviceId} (${device.emulatorName || device.model})`);
      this.emit('device-selected', { deviceId, device });
      return true;
    }
    log.warn(`無法選中設備: ${deviceId} - 設備不存在`);
    return false;
  }

  /**
   * 取消選擇設備
   * @param {string} deviceId - 設備 ID
   */
  deselectDevice(deviceId) {
    if (this.selectedDevices.has(deviceId)) {
      this.selectedDevices.delete(deviceId);
      log.info(`設備已取消選中: ${deviceId}`);
      this.emit('device-deselected', { deviceId });
      return true;
    }
    return false;
  }

  /**
   * 切換設備選中狀態
   * @param {string} deviceId - 設備 ID
   */
  toggleDevice(deviceId) {
    if (this.selectedDevices.has(deviceId)) {
      return this.deselectDevice(deviceId);
    } else {
      return this.selectDevice(deviceId);
    }
  }

  /**
   * 選擇全部設備
   */
  selectAllDevices() {
    this.selectedDevices.clear();
    for (const device of this.deviceManager.devices) {
      this.selectedDevices.add(device.id);
    }
    this.syncMode = 'all';
    log.info(`已選擇全部 ${this.selectedDevices.size} 個設備`);
    this.emit('all-devices-selected', { count: this.selectedDevices.size });
  }

  /**
   * 清除所有選擇
   */
  clearSelection() {
    this.selectedDevices.clear();
    this.syncMode = 'custom';
    log.info('已清除設備選擇');
    this.emit('selection-cleared');
  }

  /**
   * 啟用同步控制
   */
  enableSync() {
    if (this.selectedDevices.size === 0) {
      log.warn('無法啟用同步控制: 沒有選擇任何設備');
      return false;
    }
    this.syncEnabled = true;
    log.info(`同步控制已啟用: ${this.selectedDevices.size} 個設備`);
    this.emit('sync-enabled', { deviceCount: this.selectedDevices.size });
    return true;
  }

  /**
   * 停用同步控制
   */
  disableSync() {
    this.syncEnabled = false;
    log.info('同步控制已停用');
    this.emit('sync-disabled');
  }

  /**
   * 切換同步控制狀態
   */
  toggleSync() {
    if (this.syncEnabled) {
      this.disableSync();
    } else {
      this.enableSync();
    }
    return this.syncEnabled;
  }

  /**
   * 執行同步觸控操作
   * 對所有選中的設備執行相同的觸控操作
   * @param {Object} touchEvent - 觸控事件
   */
  async executeSyncTouch(touchEvent) {
    if (!this.syncEnabled || this.selectedDevices.size === 0) {
      return { success: false, reason: 'Sync not enabled or no devices selected' };
    }

    const results = [];
    const deviceIds = Array.from(this.selectedDevices);

    for (const deviceId of deviceIds) {
      try {
        const result = await this.executeOnDevice(deviceId, touchEvent);
        results.push({ deviceId, success: true, result });
      } catch (error) {
        log.error(`同步觸控失敗 - 設備 ${deviceId}:`, error.message);
        results.push({ deviceId, success: false, error: error.message });
      }
    }

    const allSuccess = results.every(r => r.success);
    return {
      success: allSuccess,
      synced: deviceIds.length,
      results
    };
  }

  /**
   * 在指定設備上執行操作
   * @param {string} deviceId - 設備 ID
   * @param {Object} action - 操作內容
   */
  async executeOnDevice(deviceId, action) {
    const device = this.deviceManager.devices.find(d => d.id === deviceId);
    if (!device) {
      throw new Error(`設備不存在: ${deviceId}`);
    }

    const adbPath = this.deviceManager.adbPath;

    // 根據操作類型執行不同的命令
    switch (action.type) {
      case 'touch':
        return this.executeTouch(deviceId, action, adbPath);
      case 'swipe':
        return this.executeSwipe(deviceId, action, adbPath);
      case 'key':
        return this.executeKey(deviceId, action, adbPath);
      case 'text':
        return this.executeText(deviceId, action, adbPath);
      case 'screenshot':
        return this.executeScreenshot(deviceId, action, adbPath);
      case 'shell':
        return this.executeShell(deviceId, action, adbPath);
      default:
        throw new Error(`未知的操作類型: ${action.type}`);
    }
  }

  /**
   * 執行觸控操作
   */
  executeTouch(deviceId, action, adbPath) {
    return new Promise((resolve, reject) => {
      const { x, y } = action;
      const command = `${adbPath} -s ${deviceId} shell input tap ${x} ${y}`;
      require('child_process').exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * 執行滑動操作
   */
  executeSwipe(deviceId, action, adbPath) {
    return new Promise((resolve, reject) => {
      const { x1, y1, x2, y2, duration } = action;
      const durationMs = duration || 300;
      const command = `${adbPath} -s ${deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`;
      require('child_process').exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * 執行按鍵操作
   */
  executeKey(deviceId, action, adbPath) {
    return new Promise((resolve, reject) => {
      const { key } = action;
      const command = `${adbPath} -s ${deviceId} shell input keyevent ${key}`;
      require('child_process').exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * 執行文字輸入
   */
  executeText(deviceId, action, adbPath) {
    return new Promise((resolve, reject) => {
      const { text } = action;
      // 轉義特殊字符
      const escapedText = text.replace(/["\\]/g, '\\$&');
      const command = `${adbPath} -s ${deviceId} shell input text "${escapedText}"`;
      require('child_process').exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * 執行截圖
   */
  executeScreenshot(deviceId, action, adbPath) {
    return new Promise((resolve, reject) => {
      const remotePath = '/sdcard/sync_screenshot.png';
      const localPath = action.localPath || './sync_screenshot.png';

      // 先在設備上截圖
      require('child_process').exec(
        `${adbPath} -s ${deviceId} shell screencap -p ${remotePath}`,
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          // 拉取到本地
          require('child_process').exec(
            `${adbPath} -s ${deviceId} pull ${remotePath} ${localPath}`,
            (error2, stdout2, stderr2) => {
              if (error2) {
                reject(error2);
              } else {
                resolve({ localPath });
              }
            }
          );
        }
      );
    });
  }

  /**
   * 執行 Shell 命令
   */
  executeShell(deviceId, action, adbPath) {
    return new Promise((resolve, reject) => {
      const { command } = action;
      const fullCommand = `${adbPath} -s ${deviceId} shell "${command}"`;
      require('child_process').exec(fullCommand, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * 執行同步操作（批量）
   * @param {Array} actions - 操作陣列
   */
  async executeBatch(actions) {
    if (!this.syncEnabled || this.selectedDevices.size === 0) {
      return { success: false, reason: 'Sync not enabled or no devices selected' };
    }

    const results = [];
    for (const action of actions) {
      const result = await this.executeSyncTouch(action);
      results.push(result);
    }
    return { success: true, results };
  }

  /**
   * 獲取同步狀態
   */
  getStatus() {
    return {
      syncEnabled: this.syncEnabled,
      syncMode: this.syncMode,
      selectedCount: this.selectedDevices.size,
      selectedDevices: Array.from(this.selectedDevices),
      availableDevices: this.deviceManager.devices.length
    };
  }

  /**
   * 刷新設備列表並更新選擇
   */
  async refreshDevices() {
    await this.deviceManager.refreshDevices();
    
    // 移除已斷開的設備
    const validDevices = new Set(this.deviceManager.devices.map(d => d.id));
    for (const deviceId of this.selectedDevices) {
      if (!validDevices.has(deviceId)) {
        this.selectedDevices.delete(deviceId);
        log.info(`設備已移除: ${deviceId}`);
      }
    }
    
    this.emit('devices-refreshed', { 
      available: this.deviceManager.devices.length,
      selected: this.selectedDevices.size 
    });
  }
}

module.exports = MultiInstanceManager;
