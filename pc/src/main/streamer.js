/**
 * Streamer Module - 螢幕串流服務
 *
 * 串流模式（優先順序）：
 *   1. scrcpy 模式（推薦）：
 *      scrcpy-server → H.264 (MediaCodec) → ffmpeg → JPEG → WebSocket
 *      效果：30-60 FPS, ~50ms 延遲
 *
 *   2. screencap 回退模式：
 *      adb exec-out screencap -p → PNG → WebSocket
 *      效果：~2-5 FPS, ~440ms 延遲（原始方案）
 *
 * 在 main.js 透過 setScrcpyManager() 將 ScrcpyManager 傳入後即啟用高效模式。
 */

const { spawn, exec } = require('child_process');
const WebSocket = require('ws');
const log = require('electron-log');

class Streamer {
  constructor(adbPath, deviceId) {
    this.adbPath   = adbPath;
    this.deviceId  = deviceId;
    this.isStreaming = false;
    this.clients   = new Set();

    // 由 main.js 注入；存在時使用 scrcpy 高效模式
    this.scrcpyManager = null;

    // screencap 回退模式的計時器 / 程序
    this._captureTimer  = null;
    this._currentProc   = null;

    // ffmpeg 相關（scrcpy 模式）
    this._ffmpegProc   = null;
    this._h264Buffer   = Buffer.alloc(0);  // scrcpy video-data 的暫存
    this._ffmpegStdout = Buffer.alloc(0);  // ffmpeg stdout 的 JPEG 累積緩衝

    this.config = {
      width:   720,
      height:  1280,
      fps:     30,
      quality: 60,
    };

    this.stats = {
      fps: 0,
      latency: 0,
      framesSent: 0,
      latencySamples: [],
    };

    this.frameCount  = 0;
    this.lastFpsTime = Date.now();

    // 偵測 ffmpeg 是否可用（非同步，結果快取）
    this._ffmpegPath = null;
    this._ffmpegChecked = false;
    this._detectFfmpeg();
  }

  // ─────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────

  /**
   * 由 main.js 在初始化 ScrcpyManager 後呼叫。
   */
  setScrcpyManager(manager) {
    this.scrcpyManager = manager;
    log.info('[Streamer] ScrcpyManager 已注入，將使用 scrcpy 高效串流');
  }

  async startStream(ws) {
    if (this.isStreaming) {
      this.clients.add(ws);
      return;
    }
    this.isStreaming = true;
    this.clients.add(ws);

    try {
      if (this.scrcpyManager?.isRunning && this._ffmpegPath) {
        log.info('[Streamer] 使用 scrcpy + ffmpeg 串流模式');
        await this._startScrcpyStream();
      } else {
        if (this.scrcpyManager?.isRunning && !this._ffmpegPath) {
          log.warn('[Streamer] scrcpy 已就緒但找不到 ffmpeg，回退至 screencap 模式');
          log.warn('[Streamer] 安裝 ffmpeg 可獲得 30fps 體驗：https://ffmpeg.org/download.html');
        }
        log.info('[Streamer] 使用 screencap 回退模式');
        await this._startScreenshotLoop();
      }
    } catch (err) {
      log.error('[Streamer] 串流啟動失敗：', err.message);
      this.isStreaming = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    }
  }

  stopStream() {
    this.isStreaming = false;

    // 停止 screencap 回退模式
    if (this._captureTimer) {
      clearTimeout(this._captureTimer);
      this._captureTimer = null;
    }
    if (this._currentProc) {
      try { this._currentProc.kill(); } catch (_) {}
      this._currentProc = null;
    }

    // 停止 ffmpeg 程序
    this._stopFfmpeg();

    // 移除 scrcpy video-data 監聽
    if (this.scrcpyManager) {
      this.scrcpyManager.removeAllListeners('video-data');
    }

    this.clients.clear();
    this.stats = { fps: 0, latency: 0, framesSent: 0, latencySamples: [] };
    log.info('[Streamer] 串流已停止');
  }

  addClient(ws) {
    this.clients.add(ws);
    ws.on('close', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) this.stopStream();
    });
    ws.on('error', () => this.clients.delete(ws));
  }

  setQuality(quality) {
    const map = {
      '480p':  { width: 480,  height: 854,  quality: 50 },
      '720p':  { width: 720,  height: 1280, quality: 60 },
      '1080p': { width: 1080, height: 1920, quality: 70 },
      '4K':    { width: 2160, height: 3840, quality: 80 },
    };
    if (map[quality]) Object.assign(this.config, map[quality]);
    log.info('[Streamer] 畫質設定：', quality);
  }

  setFps(fps) {
    // scrcpy 模式不受此限制；screencap 模式上限仍為 15fps
    this.config.fps = this.scrcpyManager?.isRunning ? fps : Math.min(fps, 15);
    log.info('[Streamer] FPS 設定：', this.config.fps);
  }

  async requestScreenshot(ws) {
    try {
      const frame = await this._screencap();
      if (ws && ws.readyState === WebSocket.OPEN && frame.length > 1000) {
        const buf = Buffer.alloc(frame.length + 1);
        buf[0] = 0x02;  // 截圖幀標記
        frame.copy(buf, 1);
        ws.send(buf, { binary: true });
        log.info('[Streamer] 截圖已發送');
      }
    } catch (err) {
      log.error('[Streamer] 截圖失敗：', err.message);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: '截圖失敗' }));
      }
    }
  }

  reportLatency(clientTimestamp) {
    const rtt    = Date.now() - clientTimestamp;
    const oneWay = Math.round(rtt / 2);
    this.stats.latency = oneWay;
    this.stats.latencySamples.push(oneWay);
    if (this.stats.latencySamples.length > 30) {
      this.stats.latencySamples = this.stats.latencySamples.slice(-30);
    }
  }

  // ─────────────────────────────────────────
  // scrcpy + ffmpeg 高效串流
  // ─────────────────────────────────────────

  async _startScrcpyStream() {
    // 啟動 ffmpeg：stdin 接收 H.264，stdout 輸出連續 JPEG 幀
    this._ffmpegProc = spawn(this._ffmpegPath, [
      '-loglevel', 'quiet',
      '-f',        'h264',      // 輸入格式：raw H.264 Annex B
      '-i',        'pipe:0',    // 從 stdin 讀取
      '-vf',       `fps=${this.config.fps}`,
      '-f',        'image2pipe',
      '-vcodec',   'mjpeg',
      '-q:v',      '5',         // JPEG 品質 1-31，值越低越好（5 ≈ 75% 品質）
      'pipe:1',                 // 輸出到 stdout
    ]);

    this._ffmpegProc.stdout.on('data', (chunk) => {
      this._ffmpegStdout = Buffer.concat([this._ffmpegStdout, chunk]);
      this._extractAndBroadcastJpegFrames();
    });

    this._ffmpegProc.stderr.on('data', () => {});  // 已用 -loglevel quiet 抑制輸出

    this._ffmpegProc.on('error', (err) => {
      log.error('[Streamer] ffmpeg 錯誤：', err.message);
    });

    this._ffmpegProc.on('exit', (code) => {
      if (this.isStreaming) {
        log.warn('[Streamer] ffmpeg 意外退出，code:', code);
      }
      this._ffmpegProc = null;
    });

    // 監聽 scrcpy 的 H.264 資料，直接寫入 ffmpeg stdin
    this.scrcpyManager.on('video-data', (chunk) => {
      if (!this.isStreaming || !this._ffmpegProc) return;
      try {
        this._ffmpegProc.stdin.write(chunk);
      } catch (_) {}
    });

    log.info('[Streamer] scrcpy + ffmpeg 管道已建立');
  }

  /**
   * 從 ffmpeg stdout 緩衝中提取完整 JPEG 幀並廣播。
   * JPEG 起始標記：FF D8；結束標記：FF D9
   */
  _extractAndBroadcastJpegFrames() {
    const buf = this._ffmpegStdout;
    let pos    = 0;

    while (pos < buf.length - 1) {
      // 尋找 JPEG 起始
      if (buf[pos] !== 0xFF || buf[pos + 1] !== 0xD8) {
        pos++;
        continue;
      }

      // 尋找 JPEG 結束 (FF D9)
      let end = pos + 2;
      let found = false;
      while (end < buf.length - 1) {
        if (buf[end] === 0xFF && buf[end + 1] === 0xD9) {
          end += 2;  // 包含 EOI
          found = true;
          break;
        }
        end++;
      }

      if (!found) break;  // 幀不完整，等待更多資料

      const frame = buf.slice(pos, end);
      this._broadcastFrame(frame);
      pos = end;
    }

    // 保留未完成的部分
    this._ffmpegStdout = pos > 0 ? buf.slice(pos) : buf;
  }

  _stopFfmpeg() {
    if (this._ffmpegProc) {
      try {
        this._ffmpegProc.stdin.end();
        this._ffmpegProc.kill();
      } catch (_) {}
      this._ffmpegProc = null;
    }
    this._ffmpegStdout = Buffer.alloc(0);
  }

  // ─────────────────────────────────────────
  // screencap 回退模式
  // ─────────────────────────────────────────

  async _startScreenshotLoop() {
    const interval = Math.floor(1000 / Math.min(this.config.fps, 15));

    const capture = async () => {
      if (!this.isStreaming) return;

      try {
        const frame = await this._screencap();
        if (frame.length > 1000) {
          this._broadcastFrame(frame);
          this._updateStats();
        }
      } catch (err) {
        log.warn('[Streamer] screencap 失敗：', err.message);
      }

      if (this.isStreaming) {
        this._captureTimer = setTimeout(capture, interval);
      }
    };

    capture();
  }

  _screencap() {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const args   = ['-s', this.deviceId, 'exec-out', 'screencap', '-p'];
      const proc   = spawn(this.adbPath, args);
      this._currentProc = proc;

      proc.stdout.on('data', chunk => chunks.push(chunk));
      proc.stdout.on('end', () => {
        this._currentProc = null;
        resolve(Buffer.concat(chunks));
      });
      proc.stderr.on('data', () => {});
      proc.on('error', (err) => {
        this._currentProc = null;
        reject(err);
      });
    });
  }

  // ─────────────────────────────────────────
  // 廣播 / 統計
  // ─────────────────────────────────────────

  /**
   * 廣播單幀給所有客戶端。
   * 幀格式：[0x01][...JPEG/PNG data...]
   */
  _broadcastFrame(frameData) {
    const buf = Buffer.allocUnsafe(frameData.length + 1);
    buf[0] = 0x01;  // 影像幀標記
    frameData.copy(buf, 1);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(buf, { binary: true });
        } catch (err) {
          log.error('[Streamer] 傳送錯誤：', err.message);
        }
      }
    }

    this.stats.framesSent++;
    this._updateStats();
  }

  _updateStats() {
    this.frameCount++;
    const now     = Date.now();
    const elapsed = now - this.lastFpsTime;

    if (elapsed >= 1000) {
      this.stats.fps   = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount  = 0;
      this.lastFpsTime = now;
      this._broadcastStats();
    }
  }

  _broadcastStats() {
    const mode = (this.scrcpyManager?.isRunning && this._ffmpegPath)
      ? 'scrcpy+ffmpeg'
      : 'screencap';

    const msg = JSON.stringify({
      type:       'stats',
      fps:        this.stats.fps,
      latency:    this.stats.latency,
      resolution: `${this.config.width}x${this.config.height}`,
      streamMode: mode,
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(msg); } catch (_) {}
      }
    }
  }

  // ─────────────────────────────────────────
  // ffmpeg 偵測
  // ─────────────────────────────────────────

  _detectFfmpeg() {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    exec(cmd, (err, stdout) => {
      this._ffmpegChecked = true;
      if (!err && stdout.trim()) {
        // 取第一行（Windows where 可能回傳多行）
        this._ffmpegPath = stdout.trim().split('\n')[0].trim();
        log.info('[Streamer] 偵測到 ffmpeg：', this._ffmpegPath);
      } else {
        this._ffmpegPath = null;
        log.warn('[Streamer] 未偵測到 ffmpeg，scrcpy 影像需要 ffmpeg 才能解碼');
        log.warn('[Streamer] 下載：https://ffmpeg.org/download.html');
      }
    });
  }

  /**
   * 供 main.js 查詢目前串流是否使用 scrcpy 高效模式。
   */
  get streamMode() {
    return (this.scrcpyManager?.isRunning && this._ffmpegPath)
      ? 'scrcpy'
      : 'screencap';
  }

  /**
   * 執行 adb 命令（回傳 Promise）
   */
  _execAdb(command) {
    return new Promise((resolve, reject) => {
      exec(
        `"${this.adbPath}" ${command}`,
        { maxBuffer: 1024 * 1024 * 10 },
        (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        }
      );
    });
  }
}

module.exports = Streamer;
