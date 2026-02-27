/**
 * Reconnection Manager
 * 斷線重連機制
 */

const log = require('electron-log');

class ReconnectionManager {
  constructor() {
    this.maxAttempts = 5;
    this.baseDelay = 1000; // 1秒
    this.maxDelay = 30000; // 30秒
    this.attempts = 0;
    this.isReconnecting = false;
    this.timer = null;
    this.onReconnect = null;
  }

  /**
   * 設置重連回調
   */
  setReconnectCallback(callback) {
    this.onReconnect = callback;
  }

  /**
   * 開始重連
   */
  startReconnect() {
    if (this.isReconnecting) {
      log.info('Already reconnecting...');
      return;
    }

    this.isReconnecting = true;
    this.attempts = 0;
    
    this.scheduleReconnect();
    
    log.info('Reconnection started');
  }

  /**
   * 安排重連
   */
  scheduleReconnect() {
    if (this.attempts >= this.maxAttempts) {
      log.warn('Max reconnection attempts reached');
      this.stopReconnect();
      return;
    }

    this.attempts++;
    
    // 指數退避算法
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.attempts - 1),
      this.maxDelay
    );

    log.info(`Reconnection attempt ${this.attempts}/${this.maxAttempts} in ${delay}ms`);

    this.timer = setTimeout(async () => {
      if (this.onReconnect) {
        try {
          const success = await this.onReconnect();
          if (success) {
            log.info('Reconnection successful');
            this.stopReconnect();
          } else {
            this.scheduleReconnect();
          }
        } catch (e) {
          log.error('Reconnection error:', e);
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * 停止重連
   */
  stopReconnect() {
    this.isReconnecting = false;
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    log.info('Reconnection stopped');
  }

  /**
   * 重置重連計數
   */
  reset() {
    this.attempts = 0;
    this.isReconnecting = false;
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    log.info('Reconnection reset');
  }

  /**
   * 獲取重連狀態
   */
  getStatus() {
    return {
      isReconnecting: this.isReconnecting,
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
      progress: `${this.attempts}/${this.maxAttempts}`
    };
  }

  /**
   * 設置最大重連次數
   */
  setMaxAttempts(max) {
    this.maxAttempts = max;
  }

  /**
   * 設置重連延遲
   */
  setDelays(base, max) {
    this.baseDelay = base;
    this.maxDelay = max;
  }
}

module.exports = ReconnectionManager;
