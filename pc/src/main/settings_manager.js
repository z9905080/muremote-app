/**
 * Settings Manager
 * 設定管理、持久化
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

class SettingsManager {
  constructor() {
    this.settings = {};
    this.defaultSettings = {
      // ADB 設定
      adb: {
        host: '127.0.0.1',
        port: 7555,
        autoConnect: true,
      },
      
      // 串流設定
      streaming: {
        quality: '720p',
        fps: 30,
        bitrate: 2000000,
        codec: 'h264',
      },
      
      // 網路設定
      network: {
        wsPort: 8080,
        signalingPort: 8081,
        useStun: true,
        stunServer: 'stun:stun.l.google.com:19302',
      },
      
      // UI 設定
      ui: {
        alwaysOnTop: true,
        minimizeToTray: true,
        startMinimized: false,
        showNotifications: true,
      },
      
      // 進階設定
      advanced: {
        logLevel: 'info',
        autoRestart: true,
        maxReconnectAttempts: 3,
      },
    };
    
    this.settingsPath = null;
  }

  /**
   * 初始化設定管理器
   */
  initialize() {
    try {
      // 嘗試獲取用戶數據目錄
      const userDataPath = app ? app.getPath('userData') : process.cwd();
      this.settingsPath = path.join(userDataPath, 'settings.json');
      
      // 載入設定
      this.load();
      
      log.info('SettingsManager initialized:', this.settingsPath);
    } catch (e) {
      log.error('Failed to initialize settings:', e);
      this.settings = { ...this.defaultSettings };
    }
  }

  /**
   * 載入設定
   */
  load() {
    try {
      if (this.settingsPath && fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const loaded = JSON.parse(data);
        this.settings = this.mergeSettings(this.defaultSettings, loaded);
        log.info('Settings loaded');
      } else {
        this.settings = { ...this.defaultSettings };
        this.save(); // 創建默認設定檔
      }
    } catch (e) {
      log.error('Failed to load settings:', e);
      this.settings = { ...this.defaultSettings };
    }
  }

  /**
   * 保存設定
   */
  save() {
    try {
      if (this.settingsPath) {
        const dir = path.dirname(this.settingsPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
        log.info('Settings saved');
        return true;
      }
    } catch (e) {
      log.error('Failed to save settings:', e);
    }
    return false;
  }

  /**
   * 合併設定
   */
  mergeSettings(defaults, loaded) {
    const result = { ...defaults };
    
    for (const key in loaded) {
      if (typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
        result[key] = this.mergeSettings(defaults[key], loaded[key]);
      } else {
        result[key] = loaded[key];
      }
    }
    
    return result;
  }

  /**
   * 獲取設定
   */
  get(key) {
    const keys = key.split('.');
    let value = this.settings;
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * 設定設定值
   */
  set(key, value) {
    const keys = key.split('.');
    let obj = this.settings;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!obj[k] || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }
    
    obj[keys[keys.length - 1]] = value;
    this.save();
    
    log.info(`Setting updated: ${key} =`, value);
  }

  /**
   * 獲取所有設定
   */
  getAll() {
    return { ...this.settings };
  }

  /**
   * 重置為默認設定
   */
  reset() {
    this.settings = { ...this.defaultSettings };
    this.save();
    log.info('Settings reset to defaults');
  }

  /**
   * 匯入設定
   */
  importSettings(data) {
    try {
      const imported = typeof data === 'string' ? JSON.parse(data) : data;
      this.settings = this.mergeSettings(this.defaultSettings, imported);
      this.save();
      return true;
    } catch (e) {
      log.error('Failed to import settings:', e);
      return false;
    }
  }

  /**
   * 匯出設定
   */
  exportSettings() {
    return JSON.stringify(this.settings, null, 2);
  }
}

module.exports = SettingsManager;
