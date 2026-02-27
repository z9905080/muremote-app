/**
 * Screen Capture Module - 螢幕擷取
 * 使用 ADB screencap 進行高速截圖串流
 */

const { spawn, exec } = require('child_process');
const log = require('electron-log');

class ScreenCapture {
  constructor(adbClient, deviceId) {
    this.adbClient = adbClient;
    this.deviceId = deviceId;
    this.isCapturing = false;
    this.captureProcess = null;
    this.clients = new Set();
    
    // 配置
    this.width = 720;
    this.height = 1280;
    this.fps = 15; // 降低 FPS 減少延遲
    this.quality = 70; // JPEG 品質
  }

  /**
   * 開始螢幕擷取
   */
  async startCapture() {
    if (this.isCapturing) return;
    
    this.isCapturing = true;
    log.info('Starting screen capture...');

    try {
      // 使用 ADB screencap + nc 進行串流
      // 這個方法比 screenrecord 更適合即時串流
      await this.startScreencapStream();
    } catch (error) {
      log.error('Screen capture error:', error);
      this.isCapturing = false;
    }
  }

  /**
   * 使用 screencap + nc 串流
   */
  async startScreencapStream() {
    // 建立一個本地 TCP 伺服器來接收截圖
    const net = require('net');
    
    const server = net.createServer((socket) => {
      log.info('Screen capture client connected');
      
      socket.on('data', (data) => {
        // 處理接收到的圖片數據
        this.broadcastFrame(data);
      });
      
      socket.on('close', () => {
        log.info('Screen capture client disconnected');
      });
    });

    // 監聽本地端口用於接收截圖
    const localPort = 5555;
    
    server.listen(localPort, '127.0.0.1', () => {
      log.info(`Screen capture server listening on port ${localPort}`);
      
      // 啟動 ADB screencap 
      this.runScreencapLoop(localPort);
    });
  }

  /**
   * 執行截圖循環
   */
  runScreencapLoop(port) {
    // 使用進行定時器週期性截圖
    const interval = Math.floor(1000 / this.fps);
    
    const captureFrame = async () => {
      if (!this.isCapturing) return;
      
      try {
        // 執行 ADB screencap
        const { exec } = require('child_process');
        
        exec(
          `adb -s ${this.deviceId} shell screencap -p`,
          { maxBuffer: 1024 * 1024 * 2 }, // 2MB buffer
          (error, stdout, stderr) => {
            if (error) {
              log.error('Screencap error:', error.message);
              return;
            }
            
            if (stdout && this.clients.size > 0) {
              // 廣播截圖給所有客戶端
              this.broadcastFrame(Buffer.from(stdout));
            }
          }
        );
      } catch (e) {
        log.error('Capture error:', e);
      }
    };

    // 啟動定時截圖
    this.captureProcess = setInterval(captureFrame, interval);
    
    // 立即執行一次
    captureFrame();
  }

  /**
   * 廣播幀給所有客戶端
   */
  broadcastFrame(frameData) {
    // 添加幀頭 (4 bytes: length)
    const frameLength = Buffer.alloc(4);
    frameLength.writeUInt32BE(frameData.length, 0);
    
    const frame = Buffer.concat([frameLength, frameData]);

    for (const client of this.clients) {
      try {
        if (client.readyState === 'open') {
          client.send(frame);
        }
      } catch (e) {
        log.error('Broadcast error:', e);
      }
    }
  }

  /**
   * 新增客戶端
   */
  addClient(ws) {
    this.clients.add(ws);
    
    ws.on('close', () => {
      this.clients.delete(ws);
      log.info(`Client disconnected. Remaining: ${this.clients.size}`);
    });
    
    ws.on('error', (e) => {
      log.error('Client error:', e);
      this.clients.delete(ws);
    });
  }

  /**
   * 停止擷取
   */
  stopCapture() {
    this.isCapturing = false;
    
    if (this.captureProcess) {
      clearInterval(this.captureProcess);
      this.captureProcess = null;
    }
    
    this.clients.clear();
    log.info('Screen capture stopped');
  }

  /**
   * 更新配置
   */
  updateConfig(config) {
    if (config.width) this.width = config.width;
    if (config.height) this.height = config.height;
    if (config.fps) this.fps = config.fps;
    if (config.quality) this.quality = config.quality;
    
    log.info('Screen capture config updated:', config);
  }
}

module.exports = ScreenCapture;
