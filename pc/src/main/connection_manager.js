/**
 * Connection Manager
 * 連線管理、狀態維護、錯誤處理
 */

const EventEmitter = require('events');
const log = require('electron-log');

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.maxConnections = 5;
    this.heartbeatInterval = 5000; // 5秒心跳
    this.heartbeatTimer = null;
  }

  /**
   * 添加連線
   */
  addConnection(clientId, connection) {
    if (this.connections.size >= this.maxConnections) {
      log.warn('Max connections reached');
      return false;
    }

    this.connections.set(clientId, {
      ...connection,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'connecting'
    });

    this.emit('connection-added', { clientId, connection });
    return true;
  }

  /**
   * 更新連線狀態
   */
  updateStatus(clientId, status, data = {}) {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.status = status;
      conn.lastUpdate = Date.now();
      Object.assign(conn, data);
      
      this.emit('status-updated', { clientId, status, data });
    }
  }

  /**
   * 獲取連線
   */
  getConnection(clientId) {
    return this.connections.get(clientId);
  }

  /**
   * 獲取所有連線
   */
  getAllConnections() {
    return Array.from(this.connections.values());
  }

  /**
   * 移除連線
   */
  removeConnection(clientId) {
    const conn = this.connections.get(clientId);
    if (conn) {
      this.connections.delete(clientId);
      this.emit('connection-removed', { clientId, connection: conn });
    }
  }

  /**
   * 處理心跳
   */
  handleHeartbeat(clientId) {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.lastHeartbeat = Date.now();
      conn.status = 'connected';
    }
  }

  /**
   * 開始心跳檢查
   */
  startHeartbeat() {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = 15000; // 15秒超時

      for (const [clientId, conn] of this.connections) {
        if (now - conn.lastHeartbeat > timeout) {
          log.warn(`Connection ${clientId} timed out`);
          this.removeConnection(clientId);
          this.emit('connection-timeout', { clientId });
        }
      }
    }, this.heartbeatInterval);

    log.info('Heartbeat started');
  }

  /**
   * 停止心跳檢查
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      log.info('Heartbeat stopped');
    }
  }

  /**
   * 獲取統計資訊
   */
  getStats() {
    return {
      total: this.connections.size,
      max: this.maxConnections,
      connections: this.getAllConnections().map(c => ({
        clientId: c.clientId,
        status: c.status,
        connectedAt: c.connectedAt,
        lastHeartbeat: c.lastHeartbeat
      }))
    };
  }
}

module.exports = ConnectionManager;
