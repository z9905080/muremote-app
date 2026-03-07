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
const fs   = require('fs');
const path = require('path');
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

    // H.264 關鍵幀快取：保存最新的 SPS / PPS / IDR NAL unit。
    // ffmpeg 啟動時先寫入 SPS+PPS+IDR，讓它能立即解碼第一幀，
    // 避免等到下一個 IDR（最長可能要等幾十秒）才開始顯示畫面。
    this._spsNal = null;  // 最新的 SPS（含 4-byte 起始碼）
    this._ppsNal = null;  // 最新的 PPS（含 4-byte 起始碼）
    this._idrNal = null;  // 最新的 IDR（含 4-byte 起始碼）
  }

  // ─────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────

  /**
   * 由 main.js 在初始化 ScrcpyManager 後呼叫。
   * 立即開始監聽 video-data 以緩存 SPS+PPS+IDR，
   * 這樣客戶端連線時 ffmpeg 能立刻取得關鍵幀資料。
   */
  setScrcpyManager(manager) {
    if (this.scrcpyManager) {
      this.scrcpyManager.removeAllListeners('video-data');
    }
    this.scrcpyManager = manager;

    manager.on('video-data', (chunk) => {
      // 持續偵測並緩存最新的 SPS/PPS NAL units
      this._cacheNalUnits(chunk);

      // 若串流中，將資料餵給 ffmpeg
      if (this.isStreaming && this._ffmpegProc) {
        try { this._ffmpegProc.stdin.write(chunk); } catch (_) {}
      }
    });

    log.info('[Streamer] ScrcpyManager 已注入，將使用 scrcpy 高效串流');
  }

  /**
   * 掃描 H.264 chunk，偵測並緩存最新的 SPS（NAL type 7）與 PPS（NAL type 8）。
   * 這兩個 NAL unit 是 ffmpeg 解碼所必需的 codec 參數（"非環形緩存"方案）。
   * 找到新的 SPS/PPS 時覆蓋舊值，其他 NAL 不影響緩存。
   */
  _cacheNalUnits(chunk) {
    let i = 0;
    while (i <= chunk.length - 5) {  // 至少需要 4 bytes 起始碼 + 1 byte NAL header
      if (chunk[i] === 0x00 && chunk[i+1] === 0x00 &&
          chunk[i+2] === 0x00 && chunk[i+3] === 0x01) {
        const nalType = chunk[i+4] & 0x1F;
        // 找下一個起始碼的位置（即本 NAL 的結束）
        const nextStart = this._findNextStartCode(chunk, i + 4);
        if (nalType === 7) {        // SPS：新 GOP 開始，重置 PPS/IDR
          this._spsNal = chunk.slice(i, nextStart);
          this._ppsNal = null;
          this._idrNal = null;
        } else if (nalType === 8) { // PPS：重置 IDR
          this._ppsNal = chunk.slice(i, nextStart);
          this._idrNal = null;
        } else if (nalType === 5 && this._spsNal && this._ppsNal) { // IDR（在 SPS+PPS 之後）
          this._idrNal = chunk.slice(i, nextStart);
        }
        i = nextStart;
      } else {
        i++;
      }
    }
  }

  /**
   * 從 buf 的 from 位置開始，找下一個 4-byte 起始碼（00 00 00 01）的位置。
   * 找不到時回傳 buf.length（表示到結尾）。
   */
  _findNextStartCode(buf, from) {
    for (let i = from; i <= buf.length - 4; i++) {
      if (buf[i] === 0x00 && buf[i+1] === 0x00 &&
          buf[i+2] === 0x00 && buf[i+3] === 0x01) {
        return i;
      }
    }
    return buf.length;
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

    // 不移除 video-data 監聽：setScrcpyManager 的持久監聽負責緩存關鍵幀，
    // 需要持續運作，等下次客戶端連線時使用。

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
    const ffmpegBin = this._ffmpegPath.replace(/^"|"$/g, '');
    this._ffmpegProc = spawn(ffmpegBin, [
      '-loglevel',        'warning',
      '-probesize',       '32',      // 不探測輸入，立即開始解碼
      '-analyzeduration', '0',       // 無分析延遲
      '-fflags',          'nobuffer',// 關閉輸入緩衝，降低管道累積延遲
      '-flags',           'low_delay',// 低延遲解碼模式，盡快輸出可解碼幀
      '-f',               'h264',    // 輸入格式：raw H.264 Annex B
      '-i',               'pipe:0',  // 從 stdin 讀取
      '-f',               'image2pipe',
      '-vcodec',          'mjpeg',
      '-q:v',             '5',       // JPEG 品質 1-31，值越低越好（5 ≈ 75% 品質）
      'pipe:1',                      // 輸出到 stdout
    ]);

    let _ffmpegFirstOutput = false;
    this._ffmpegProc.stdout.on('data', (chunk) => {
      if (!_ffmpegFirstOutput) {
        _ffmpegFirstOutput = true;
        log.info('[Streamer] ffmpeg 首個輸出，長度：', chunk.length);
      }
      this._ffmpegStdout = Buffer.concat([this._ffmpegStdout, chunk]);
      this._extractAndBroadcastJpegFrames();
    });

    this._ffmpegProc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) log.warn('[ffmpeg]', msg);
    });

    this._ffmpegProc.on('error', (err) => {
      log.error('[Streamer] ffmpeg 錯誤：', err.message);
    });

    this._ffmpegProc.on('exit', (code) => {
      if (this.isStreaming) {
        log.warn('[Streamer] ffmpeg 意外退出，code:', code);
      }
      this._ffmpegProc = null;
    });

    // 先送出緩存的 SPS+PPS+IDR，讓 ffmpeg 能立即解碼第一幀
    if (this._spsNal && this._ppsNal && this._idrNal) {
      const gop = Buffer.concat([this._spsNal, this._ppsNal, this._idrNal]);
      log.info(`[Streamer] 送出緩存 SPS(${this._spsNal.length}B)+PPS(${this._ppsNal.length}B)+IDR(${this._idrNal.length}B)`);
      try { this._ffmpegProc.stdin.write(gop); } catch (_) {}
    } else if (this._spsNal && this._ppsNal) {
      const header = Buffer.concat([this._spsNal, this._ppsNal]);
      log.info(`[Streamer] 送出緩存 SPS+PPS（無 IDR），等待下一個關鍵幀`);
      try { this._ffmpegProc.stdin.write(header); } catch (_) {}
    } else {
      log.warn('[Streamer] 尚無緩存 SPS/PPS，等待 scrcpy 送出關鍵幀');
    }

    // video-data 已由 setScrcpyManager() 統一處理，不需要再次監聽
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
      const chunks  = [];
      // spawn() 不接受帶引號的路徑，需移除 device_manager 加上的引號
      const adbBin  = this.adbPath.replace(/^"|"$/g, '');
      const args    = ['-s', this.deviceId, 'exec-out', 'screencap', '-p'];
      const proc    = spawn(adbBin, args);
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

  /**
   * 偵測可用的 ffmpeg 二進制，優先順序：
   *   1. 內建 ffmpeg-static（打包進安裝包，使用者不需要自行安裝）
   *   2. 系統 PATH 中的 ffmpeg（系統已安裝的版本）
   *
   * 在 Electron 打包後，ffmpeg-static 的二進制位於 app.asar.unpacked/
   * 目錄下（透過 electron-builder asarUnpack 設定），需修正路徑。
   */
  _detectFfmpeg() {
    // 1. 嘗試內建 ffmpeg-static
    try {
      let bundled = require('ffmpeg-static');
      if (bundled) {
        // 打包後路徑修正：app.asar → app.asar.unpacked
        bundled = bundled.replace(
          /\.asar([/\\])/g,
          '.asar.unpacked$1'
        );
        if (fs.existsSync(bundled)) {
          this._ffmpegPath = bundled;
          this._ffmpegChecked = true;
          log.info('[Streamer] 使用內建 ffmpeg：', bundled);
          return;
        }
      }
    } catch (_) {
      // ffmpeg-static 未安裝（開發環境可能尚未 npm install）
    }

    // 2. 回退：偵測系統 PATH 中的 ffmpeg
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    exec(cmd, (err, stdout) => {
      this._ffmpegChecked = true;
      if (!err && stdout.trim()) {
        this._ffmpegPath = stdout.trim().split('\n')[0].trim();
        log.info('[Streamer] 使用系統 ffmpeg：', this._ffmpegPath);
      } else {
        this._ffmpegPath = null;
        log.warn('[Streamer] 未找到 ffmpeg（內建與系統皆無）');
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
