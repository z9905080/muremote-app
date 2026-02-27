/**
 * Streamer Module - 螢幕串流服務 (優化版)
 * 使用 ADB scrcpy 協議或 FFmpeg 進行低延遲串流
 */

const { spawn, exec } = require('child_process');
const WebSocket = require('ws');
const log = require('electron-log');
const fs = require('fs');
const path = require('path');

class Streamer {
  constructor(adbClient, deviceId) {
    this.adbClient = adbClient;
    this.deviceId = deviceId;
    this.isStreaming = false;
    this.ffmpegProcess = null;
    this.clients = new Set();
    
    // 配置 - 預設為低延遲優化
    this.config = {
      width: 720,
      height: 1280,
      fps: 30,
      bitrate: '2M',
      quality: 60  // 稍微降低質量以換取更低延遲
    };
    
    this.stats = {
      fps: 0,
      latency: 0,
      framesSent: 0,
      avgLatency: 0,
      latencySamples: []
    };
    
    this.frameTimestamps = new Map();
    
    this.frameCount = 0;
    this.lastFpsTime = Date.now();
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
      // 嘗試使用 scrcpy 協議 (最低延遲)
      const scrcpyAvailable = await this.checkScrcpy();
      
      if (scrcpyAvailable) {
        await this.startScrcpyStream();
      } else {
        // 備用: 使用 FFmpeg + ADB
        await this.startFFmpegStream();
      }

      log.info('Streaming started successfully');
    } catch (error) {
      log.error('Failed to start stream:', error);
      this.isStreaming = false;
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  }

  /**
   * 檢查 scrcpy 是否可用
   */
  async checkScrcpy() {
    return new Promise((resolve) => {
      exec('which scrcpy', (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * 使用 scrcpy 進行串流 (首選方案)
   * scrcpy 提供最低延遲的螢幕投射
   */
  async startScrcpyStream() {
    return new Promise((resolve, reject) => {
      // 使用 scrcpy 的內建 HTTP 伺服器
      // 這個方法可以獲得最低延遲
      const scrcpyArgs = [
        '-s', this.deviceId,
        '--window-title', 'MuRemote Stream',
        '--push-target', '/sdcard/Download/',
        // 優化參數 - 降低延遲
        '--max-fps', this.config.fps.toString(),
        '-b', this.config.bitrate,
        '--max-size', this.config.width.toString(),
        // 禁用不需要的功能以減少延遲
        '--turn-screen-off',
        '--always-on-top',
        // 延遲優化參數
        '--buffer-ms', '0',
        '--no-key-repeat',
        '--no-clipboard-autosync',
        '--no-power-on'
      ];

      log.info('Starting scrcpy with args:', scrcpyArgs);
      
      this.ffmpegProcess = spawn('scrcpy', scrcpyArgs);

      this.ffmpegProcess.on('error', (err) => {
        log.error('Scrcpy error:', err);
        reject(err);
      });

      this.ffmpegProcess.on('close', (code) => {
        log.info('Scrcpy closed with code:', code);
        this.isStreaming = false;
      });

      // 等待 scrcpy 啟動
      setTimeout(() => {
        resolve();
      }, 1000);
    });
  }

  /**
   * 使用 FFmpeg + ADB screenrecord 串流 (備用方案)
   */
  async startFFmpegStream() {
    return new Promise(async (resolve, reject) => {
      try {
        // 首先獲取設備的實際解析度
        const { stdout: sizeOutput } = await this.execAdb(
          `shell wm size`
        );
        const [width, height] = sizeOutput.trim().split(': ')[1].split('x');
        
        // 計算目標解析度 (維持比例)
        const targetWidth = Math.min(parseInt(width), this.config.width);
        const targetHeight = Math.min(parseInt(height), this.config.height);
        
        log.info(`Target resolution: ${targetWidth}x${targetHeight}`);

        // 使用 ADB screenrecord 擷取
        const adbCommand = [
          '-s', this.deviceId,
          'shell', 'screenrecord',
          '--output-format', 'h264',
          '--size', `${targetWidth}x${targetHeight}`,
          '--bit-rate', this.config.bitrate,
          '--max-time', '60',
          '-'
        ].join(' ');

        log.info('ADB command:', adbCommand);

        // 啟動 FFmpeg 進行轉碼和傳輸
        // 延遲優化: 使用更快速的編碼參數
        const ffmpegTranscode = spawn('ffmpeg', [
          '-fflags', 'nobuffer',        // 禁用輸入緩衝
          '-flags', 'low_delay',        // 低延遲模式
          '-analyzeduration', '500K',   // 減少分析時間
          '-probesize', '500K',
          '-f', 'h264',                 // 輸入格式 H.264
          '-i', 'pipe:0',               // 從標準輸入
          '-c:v', 'libx264',            // 重編碼
          '-preset', 'ultrafast',       // 快速編碼
          '-tune', 'zerolatency',
          '-g', '15',                   // GOP size (更短的GOP)
          '-keyint_min', '15',
          '-sc_threshold', '0',         // 禁用場景切換檢測
          '-bf', '0',                   // 不使用 B 幀 (減少延遲)
          '-an',                        // 無音訊
          '-c:v', 'mjpeg',              // 輸出 MJPEG (兼容性更好)
          '-q:v', this.config.quality.toString(),
          '-f', 'jpeg',
          '-r', this.config.fps.toString(),
          '-thread_queue_size', '64',   // 線程隊列大小優化
          '-'                           // 輸出到標準輸出
        ]);

        // 處理 FFmpeg 輸出
        let frameBuffer = Buffer.alloc(0);
        
        ffmpegTranscode.stdout.on('data', (data) => {
          frameBuffer = Buffer.concat([frameBuffer, data]);
          
          // 尋找 JPEG 幀邊界
          let startIndex = 0;
          while (true) {
            const jpegStart = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]), startIndex);
            if (jpegStart === -1) break;
            
            const jpegEnd = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), jpegStart + 2);
            if (jpegEnd === -1) break;
            
            const jpegFrame = frameBuffer.slice(jpegStart, jpegEnd + 2);
            this.broadcastFrame(jpegFrame);
            
            // 更新統計
            this.updateStats();
            
            // 優化緩衝區
            frameBuffer = frameBuffer.slice(jpegEnd + 2);
            startIndex = 0;
          }
        });

        ffmpegTranscode.stderr.on('data', (data) => {
          // FFmpeg 診斷信息
          // log.info('FFmpeg:', data.toString());
        });

        ffmpegTranscode.on('error', (err) => {
          log.error('FFmpeg error:', err);
          reject(err);
        });

        ffmpeg.on('error', (err) => {
          log.error('ADB screenrecord error:', err);
          reject(err);
        });

        this.ffmpegProcess = ffmpeg;
        
        // 連接 ADB 輸出到 FFmpeg 輸入
        ffmpeg.stdout.pipe(ffmpegTranscode.stdin);

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 執行 ADB 命令
   */
  execAdb(command) {
    return new Promise((resolve, reject) => {
      exec(`adb ${command}`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * 廣播影片幀給所有客戶端
   */
  broadcastFrame(frameData) {
    // 添加 JPEG 幀標記
    const frame = Buffer.alloc(frameData.length + 1);
    frameData.copy(frame, 1);
    frame[0] = 0x01; // 幀類型: JPEG
    
    // 記錄幀發送時間
    const frameId = Date.now() + Math.random();
    const sendTime = Date.now();

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(frame, { binary: true });
          // 追蹤此客戶端的幀發送時間
          this.frameTimestamps.set(client.id || 'default', sendTime);
        } catch (e) {
          log.error('Send error:', e);
        }
      }
    }
    
    this.stats.framesSent++;
  }

  /**
   * 更新統計信息
   */
  updateStats() {
    this.frameCount++;
    const now = Date.now();
    const elapsed = now - this.lastFpsTime;
    
    if (elapsed >= 1000) {
      this.stats.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFpsTime = now;
      
      // 計算平均延遲 (如果有樣本)
      if (this.stats.latencySamples.length > 0) {
        const sum = this.stats.latencySamples.reduce((a, b) => a + b, 0);
        this.stats.avgLatency = Math.round(sum / this.stats.latencySamples.length);
        // 保持最新 10 個樣本
        this.stats.latencySamples = this.stats.latencySamples.slice(-10);
      }
      
      // 廣播統計信息
      this.broadcastStats();
    }
  }

  /**
   * 廣播統計信息
   */
  broadcastStats() {
    const stats = {
      type: 'stats',
      fps: this.stats.fps,
      latency: this.stats.latency,
      avgLatency: this.stats.avgLatency,
      resolution: `${this.config.width}x${this.config.height}`
    };
    
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(stats));
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
    
    // 重置統計
    this.stats = { fps: 0, latency: 0, framesSent: 0, avgLatency: 0, latencySamples: [] };
    this.frameTimestamps.clear();
    
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
    
    ws.on('error', (e) => {
      log.error('Client error:', e);
      this.clients.delete(ws);
    });
  }

  /**
   * 更新配置
   * @param {Object} config - { width, height, fps, bitrate, quality }
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
    log.info('Stream config updated:', this.config);
  }

  /**
   * 設定畫質
   * @param {string} quality - '720p' | '1080p'
   */
  setQuality(quality) {
    if (quality === '1080p') {
      this.config.width = 1080;
      this.config.height = 1920;
      this.config.bitrate = '3M'; // 降低位元率以減少延遲
    } else if (quality === '480p') {
      this.config.width = 480;
      this.config.height = 854;
      this.config.bitrate = '1M';
    } else {
      this.config.width = 720;
      this.config.height = 1280;
      this.config.bitrate = '2M';
    }
    log.info('Quality set to:', quality);
  }

  /**
   * 設定幀率
   * @param {number} fps - 24 | 30 | 60
   */
  setFps(fps) {
    this.config.fps = fps;
    log.info('FPS set to:', fps);
  }

  /**
   * 發送控制命令
   */
  sendCommand(command) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(command));
      }
    }
  }

  /**
   * 請求截圖
   * @param {WebSocket} ws - 客戶端 WebSocket
   */
  async requestScreenshot(ws) {
    try {
      // 使用 ADB shell screencap
      const stream = await this.adbClient.shell(this.deviceId, 'screencap -p');
      const chunks = [];
      
      await new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      
      const screenshotData = Buffer.concat(chunks);
      
      // 發送截圖數據 (JPEG 格式)
      if (ws && ws.readyState === WebSocket.OPEN) {
        // 添加幀類型標記: 0x02 = screenshot
        const frame = Buffer.alloc(screenshotData.length + 1);
        frame[0] = 0x02; // 截圖幀
        screenshotData.copy(frame, 1);
        ws.send(frame, { binary: true });
      }
      
      log.info('Screenshot sent');
    } catch (error) {
      log.error('Screenshot error:', error);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: 'Screenshot failed' }));
      }
    }
  }
  /**
   * 接收客戶端的延遲回饋
   * 客戶端應該定期發送 { type: 'latencyAck', timestamp: <client_timestamp> }
   * @param {number} clientTimestamp - 客戶端發送時的時間戳
   */
  reportLatency(clientTimestamp) {
    const now = Date.now();
    const rtt = now - clientTimestamp; // 往返延遲
    
    // 單程延遲約為 RTT 的一半
    const oneWayLatency = Math.round(rtt / 2);
    this.stats.latency = oneWayLatency;
    this.stats.latencySamples.push(oneWayLatency);
    
    // 保持最新 30 個樣本
    if (this.stats.latencySamples.length > 30) {
      this.stats.latencySamples = this.stats.latencySamples.slice(-30);
    }
    
    log.debug('Latency reported:', oneWayLatency, 'ms');
  }
}

module.exports = Streamer;
