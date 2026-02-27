/**
 * mDNS Service Advertisement - 服務廣播模組
 * 在區域網路中廣播 PC Client 服務，供手機端發現
 */

const { spawn } = require('child_process');
const os = require('os');
const log = require('electron-log');

class MdnsAdvertiser {
  constructor(pcId, port = 8080, emulatorType = 'unknown') {
    this.pcId = pcId;
    this.port = port;
    this.emulatorType = emulatorType;
    this.serviceName = `MuRemote-${pcId}`;
    this.process = null;
  }

  /**
   * 設置模擬器類型
   */
  setEmulatorType(type) {
    this.emulatorType = type;
  }

  /**
   * 啟動 mDNS 廣播
   */
  start() {
    try {
      // 方法 1: 使用 avahi (Linux)
      if (process.platform === 'linux') {
        return this.startAvahi();
      }
      
      // 方法 2: 使用 dns-sd (macOS)
      if (process.platform === 'darwin') {
        return this.startDnsSd();
      }

      // 方法 3: 使用 Windows
      if (process.platform === 'win32') {
        return this.startWindows();
      }

      log.warn('mDNS advertisement not supported on this platform');
      return false;
    } catch (error) {
      log.error('Failed to start mDNS advertisement:', error);
      return false;
    }
  }

  /**
   * 使用 Avahi (Linux)
   */
  startAvahi() {
    try {
      // 發布服務
      this.process = spawn('avahi-publish-service', [
        this.serviceName,
        '_muremote._tcp',
        this.port.toString(),
        `pcId=${this.pcId}`,
        `version=1.0`,
        `emulatorType=${this.emulatorType}`
      ]);

      this.process.on('error', (err) => {
        log.error('Avahi error:', err);
      });

      this.process.on('close', (code) => {
        log.info('Avahi closed:', code);
      });

      log.info(`mDNS advertisement started (Avahi) - emulator: ${this.emulatorType}`);
      return true;
    } catch (error) {
      log.error('Avahi start failed:', error);
      return false;
    }
  }

  /**
   * 使用 dns-sd (macOS)
   */
  startDnsSd() {
    try {
      this.process = spawn('dns-sd', [
        '-R',
        this.serviceName,
        '_muremote._tcp',
        'local',
        this.port.toString(),
        'pcId=' + this.pcId,
        'version=1.0',
        'emulatorType=' + this.emulatorType
      ]);

      this.process.on('error', (err) => {
        log.error('dns-sd error:', err);
      });

      log.info(`mDNS advertisement started (dns-sd) - emulator: ${this.emulatorType}`);
      return true;
    } catch (error) {
      log.error('dns-sd start failed:', error);
      return false;
    }
  }

  /**
   * Windows 方案 (需要額外工具)
   */
  startWindows() {
    // Windows 需要使用 bonjour 或類似工具
    // 這裡嘗試使用 Node.js 的 bonjour 庫
    try {
      const { Bonjour } = require('bonjour');
      const bonjour = new Bonjour();
      
      const service = bonjour.publish({
        name: this.serviceName,
        type: 'muremote',
        port: this.port,
        txt: { 
          pcId: this.pcId, 
          version: '1.0',
          emulatorType: this.emulatorType
        }
      });

      this._service = service;
      log.info(`mDNS advertisement started (Bonjour) - emulator: ${this.emulatorType}`);
      return true;
    } catch (error) {
      log.error('Windows mDNS failed:', error);
      return false;
    }
  }

  /**
   * 停止廣播
   */
  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    
    if (this._service) {
      this._service.stop();
      this._service = null;
    }
    
    log.info('mDNS advertisement stopped');
  }
}

module.exports = MdnsAdvertiser;
