/**
 * Streamer Module - 螢幕串流服務
 * 使用 ADB screenrecord 擷取並通過 WebSocket 傳輸
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');
const log = require('electron-log');

class Streamer {
  constructor(adbClient, deviceId) {
    this.adbClient = adbClient;
    this.deviceId = deviceId;
    this.isStreaming = false;
    this.ffmpegProcess = null;
    this.clients = new Set();
  }

  /**
   * 開始串流
   * @param {WebSocket} ws - WebSocket 客戶端
   */
  async startStream(ws) {
    if (this.isStreaming) {
      this.clients.add(ws);
      return;
    }

    this.isStreaming = true;
    this.clients.add(ws);

    try {
      // 啟動 ADB screenrecord
      // 使用 HTTP 方式傳輸 (更穩定)
      await this.adbClient.shell(this.deviceId, 
        'screenrecord --output-format=h264 --size 720x1280 -'
      ).then(async (stream) => {
        // 通過 ffmpeg 轉碼
        this.startFFmpeg(stream);
      }).catch(async (err) => {
        // 如果上面的方式不行，嘗試其他方式
        log.warn('Primary streaming method failed:', err.message);
        await this.startAlternativeStream();
      });

      log.info('Streaming started');
    } catch (error) {
      log.error('Failed to start stream:', error);
      this.isStreaming = false;
    }
  }

  /**
   * 替代串流方式 - 使用 TCPdump 或其他方法
   */
  async startAlternativeStream() {
    // 嘗試使用 mjpeg 串流
    // 這是一個備選方案
    try {
      // 使用 screencap (截圖方式)
      await this.adbClient.shell(this.deviceId, 
        'while true; do screencap -p; sleep 0.033; done'
      ).then((stream) => {
        this.stream = stream;
        this.pipeToClients(stream);
      });
    } catch (e) {
      log.error('Alternative streaming failed:', e);
    }
  }

  /**
   * 啟動 FFmpeg 轉碼
   */
  startFFmpeg(inputStream) {
    // FFmpeg 命令：將 H.264 轉為可傳輸的格式
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'h264',        // 輸入格式
      '-i', 'pipe:0',     // 從標準輸入讀取
      '-c:v', 'copy',     // 直接複製視訊編碼
      '-f', 'jpeg',       // 輸出 JPEG 幀 (相容性更好)
      '-r', '30',         // 30 fps
      '-'                 // 輸出到標準輸出
    ]);

    ffmpeg.stderr.on('data', (data) => {
      // FFmpeg 診斷輸出
    });

    ffmpeg.stdout.on('data', (data) => {
      // 發送 JPEG 幀給所有客戶端
      this.broadcastFrame(data);
    });

    ffmpeg.on('error', (err) => {
      log.error('FFmpeg error:', err);
    });

    this.ffmpegProcess = ffmpeg;

    // 將 ADB 串流傳給 FFmpeg
    inputStream.pipe(ffmpeg.stdin);
  }

  /**
   * 廣播影片幀給所有客戶端
   */
  broadcastFrame(frameData) {
    const frame = Buffer.concat([
      Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), // JPEG 頭
      Buffer.from([(frameData.length >> 8) & 0xFF, frameData.length & 0xFF]), // 長度
      frameData
    ]);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    }
  }

  /**
   * 停止串流
   */
  stopStream() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill();
      this.ffmpegProcess = null;
    }
    this.isStreaming = false;
    this.clients.clear();
    log.info('Streaming stopped');
  }

  /**
   * 新增客戶端
   */
  addClient(ws) {
    this.clients.add(ws);
    ws.on('close', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) {
        this.stopStream();
      }
    });
  }

  /**
   * 發送控制命令
   */
  sendCommand(command) {
    // 用於同步等控制命令
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(command));
      }
    }
  }
}

module.exports = Streamer;
