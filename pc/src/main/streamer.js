/**
 * Streamer Module - 螢幕串流服務
 * 使用 ADB screencap 截圖迴圈進行串流
 */

const { spawn, exec } = require('child_process');
const WebSocket = require('ws');
const log = require('electron-log');

class Streamer {
  constructor(adbPath, deviceId) {
    this.adbPath = adbPath;   // adb binary 路徑
    this.deviceId = deviceId;
    this.isStreaming = false;
    this.clients = new Set();
    this._captureTimer = null;
    this._currentProc = null;

    this.config = {
      width: 720,
      height: 1280,
      fps: 15,      // screencap 每幀約 100-300ms，最多穩定 10-15fps
      quality: 60,
    };

    this.stats = {
      fps: 0,
      latency: 0,
      framesSent: 0,
      latencySamples: [],
    };

    this.frameCount = 0;
    this.lastFpsTime = Date.now();
  }

  // ─────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────

  async startStream(ws) {
    if (this.isStreaming) {
      this.clients.add(ws);
      return;
    }
    this.isStreaming = true;
    this.clients.add(ws);

    try {
      await this._startScreenshotLoop();
      log.info('Streaming started (screencap loop)');
    } catch (err) {
      log.error('Failed to start stream:', err);
      this.isStreaming = false;
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  stopStream() {
    this.isStreaming = false;

    if (this._captureTimer) {
      clearTimeout(this._captureTimer);
      this._captureTimer = null;
    }
    if (this._currentProc) {
      try { this._currentProc.kill(); } catch (_) {}
      this._currentProc = null;
    }

    this.clients.clear();
    this.stats = { fps: 0, latency: 0, framesSent: 0, latencySamples: [] };
    log.info('Streaming stopped');
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
    log.info('Quality set to:', quality);
  }

  setFps(fps) {
    this.config.fps = Math.min(fps, 15); // screencap 上限約 15fps
    log.info('FPS set to:', this.config.fps);
  }

  async requestScreenshot(ws) {
    try {
      const frame = await this._screencap();
      if (ws && ws.readyState === WebSocket.OPEN && frame.length > 1000) {
        const buf = Buffer.alloc(frame.length + 1);
        buf[0] = 0x02; // 截圖幀
        frame.copy(buf, 1);
        ws.send(buf, { binary: true });
        log.info('Screenshot sent');
      }
    } catch (err) {
      log.error('Screenshot error:', err);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: 'Screenshot failed' }));
      }
    }
  }

  reportLatency(clientTimestamp) {
    const rtt = Date.now() - clientTimestamp;
    const oneWay = Math.round(rtt / 2);
    this.stats.latency = oneWay;
    this.stats.latencySamples.push(oneWay);
    if (this.stats.latencySamples.length > 30) {
      this.stats.latencySamples = this.stats.latencySamples.slice(-30);
    }
  }

  // ─────────────────────────────────────────
  // 內部實作
  // ─────────────────────────────────────────

  /**
   * 截圖迴圈：每隔 interval ms 呼叫一次 adb exec-out screencap -p
   */
  async _startScreenshotLoop() {
    const interval = Math.floor(1000 / this.config.fps);

    const capture = async () => {
      if (!this.isStreaming) return;

      try {
        const frame = await this._screencap();
        if (frame.length > 1000) {
          this._broadcastFrame(frame);
          this._updateStats();
        }
      } catch (err) {
        log.warn('screencap failed:', err.message);
      }

      if (this.isStreaming) {
        this._captureTimer = setTimeout(capture, interval);
      }
    };

    capture();
  }

  /**
   * 執行一次 screencap，回傳 PNG Buffer
   */
  _screencap() {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const args = ['-s', this.deviceId, 'exec-out', 'screencap', '-p'];
      const proc = spawn(this.adbPath, args);
      this._currentProc = proc;

      proc.stdout.on('data', chunk => chunks.push(chunk));
      proc.stdout.on('end', () => {
        this._currentProc = null;
        resolve(Buffer.concat(chunks));
      });
      proc.stderr.on('data', () => {}); // 忽略 stderr
      proc.on('error', (err) => {
        this._currentProc = null;
        reject(err);
      });
    });
  }

  /**
   * 廣播影像幀給所有連線的 client
   * frame 開頭加 0x01 (JPEG/image 幀標記)
   */
  _broadcastFrame(frameData) {
    const buf = Buffer.alloc(frameData.length + 1);
    frameData.copy(buf, 1);
    buf[0] = 0x01;

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(buf, { binary: true });
        } catch (e) {
          log.error('Send error:', e);
        }
      }
    }
    this.stats.framesSent++;
  }

  _updateStats() {
    this.frameCount++;
    const now = Date.now();
    const elapsed = now - this.lastFpsTime;

    if (elapsed >= 1000) {
      this.stats.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFpsTime = now;
      this._broadcastStats();
    }
  }

  _broadcastStats() {
    const msg = JSON.stringify({
      type: 'stats',
      fps: this.stats.fps,
      latency: this.stats.latency,
      resolution: `${this.config.width}x${this.config.height}`,
    });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(msg); } catch (_) {}
      }
    }
  }

  /**
   * 使用 this.adbPath 執行 adb 命令，回傳 { stdout, stderr }
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
