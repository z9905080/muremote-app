/**
 * MuRemote PC Client - 配置文件
 */

module.exports = {
  // ADB 配置
  adb: {
    host: '127.0.0.1',
    port: 7555,  // MuMu 模擬器預設端口
    timeout: 5000,
  },

  // WebSocket 服務器配置
  websocket: {
    port: 8080,
    host: '0.0.0.0',
  },

  // 串流配置
  streaming: {
    // 螢幕解析度
    width: 720,
    height: 1280,
    // 幀率
    fps: 30,
    // 位元率 (bps)
    bitrate: 2000000,
    // 串流格式
    format: 'h264',
  },

  // 日誌配置
  log: {
    level: 'info',
    file: 'muremote.log',
    maxSize: 10 * 1024 * 1024, // 10MB
  },

  // 自動重連配置
  reconnect: {
    enabled: true,
    maxAttempts: 3,
    delay: 2000,
  },

  // STUN 服務器 (用於 P2P 連線)
  stun: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
  ],
};
