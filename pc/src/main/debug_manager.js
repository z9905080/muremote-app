/**
 * Debug Manager
 * 調試工具和診斷功能
 */

const log = require('electron-log');

class DebugManager {
  constructor() {
    this.enabled = process.env.NODE_ENV !== 'production';
    this.debugLogs = [];
    this.maxLogs = 1000;
  }

  /**
   * 記錄調試訊息
   */
  log(category, message, data = null) {
    if (!this.enabled) return;

    const entry = {
      timestamp: new Date().toISOString(),
      category,
      message,
      data
    };

    this.debugLogs.push(entry);

    if (this.debugLogs.length > this.maxLogs) {
      this.debugLogs = this.debugLogs.slice(-this.maxLogs);
    }

    log.debug(`[${category}] ${message}`, data || '');
  }

  /**
   * 記錄 WebSocket 訊息
   */
  logWS(direction, clientId, message) {
    this.log('WS', `${direction} ${clientId}`);
  }

  /**
   * 記錄錯誤
   */
  logError(error, context = {}) {
    this.log('ERROR', error.message || error.toString(), { stack: error.stack, ...context });
  }

  /**
   * 獲取調試日誌
   */
  getLogs(category = null, limit = 100) {
    let logs = this.debugLogs;
    if (category) logs = logs.filter(l => l.category === category);
    return logs.slice(-limit);
  }

  /**
   * 獲取診斷報告
   */
  getDiagnosticReport() {
    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      debugLogs: this.debugLogs.length,
      enabled: this.enabled
    };
  }
}

module.exports = DebugManager;
