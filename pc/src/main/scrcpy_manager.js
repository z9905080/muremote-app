/**
 * ScrcpyManager - scrcpy-server 整合模組
 *
 * 用途：
 *   取代 adb screencap 的低效截圖迴圈，改用 scrcpy-server 的
 *   MediaCodec H.264 硬體編碼串流 (30-60 FPS, ~30ms 延遲)。
 *
 * 架構：
 *   1. 將 scrcpy-server.jar 推送到模擬器
 *   2. adb forward tcp:27183 → 模擬器 localabstract:scrcpy
 *   3. 啟動 scrcpy-server（在模擬器內監聽 abstract socket）
 *   4. PC 端連接兩個 socket：
 *      - 第一個連接 → 影像 socket (H.264 NAL 流)
 *      - 第二個連接 → 控制 socket (二進制觸控/按鍵協議)
 *
 * 觸控協議 (INJECT_TOUCH_EVENT)：
 *   [uint8:2][uint8:action][int64be:pointerId][int32be:x][int32be:y]
 *   [uint16be:screenW][uint16be:screenH][uint16be:pressure]
 *   [uint32be:actionButton][uint32be:buttons]
 *   = 32 bytes total，延遲 < 5ms
 */

const { spawn, exec } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const log = require('electron-log');

const SCRCPY_PORT = 27183;
const SCRCPY_DEVICE_PATH = '/data/local/tmp/scrcpy-server.jar';
const SCRCPY_SERVER_VERSION = '2.4';

// Android MotionEvent 動作常數
const AMOTION_ACTION_DOWN = 0;
const AMOTION_ACTION_UP   = 1;
const AMOTION_ACTION_MOVE = 2;

// Android KeyEvent 動作常數
const AKEY_ACTION_DOWN = 0;
const AKEY_ACTION_UP   = 1;

// 常用 Android KEYCODE 對照表
const ANDROID_KEYCODES = {
  back:   4,
  home:   3,
  menu:   82,
  enter:  66,
  delete: 67,
  esc:    4,
  '4':    4,
  '3':    3,
  '82':   82,
  '66':   66,
  '67':   67,
};

class ScrcpyManager extends EventEmitter {
  constructor(adbPath, deviceId) {
    super();
    this.adbPath   = adbPath;
    this.deviceId  = deviceId;
    this.isRunning = false;

    this.serverProcess  = null;
    this.videoSocket    = null;
    this.controlSocket  = null;

    // 解析自影像 socket 的設備資訊
    this.deviceName  = '';
    this.videoWidth  = 0;
    this.videoHeight = 0;

    // 連接狀態標誌
    this._videoReady   = false;
    this._controlReady = false;
  }

  // ─────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────

  /**
   * 啟動 scrcpy-server 並建立兩個 socket 連接。
   * @param {object} options
   * @param {number} options.maxSize   - 最大畫面邊長 (預設 1280)
   * @param {number} options.maxFps    - 最大幀率 (預設 30)
   * @param {number} options.bitRate   - 影像位元率 bps (預設 4000000)
   * @returns {Promise<boolean>} 成功返回 true，失敗返回 false
   */
  async start({ maxSize = 1280, maxFps = 30, bitRate = 4000000 } = {}) {
    if (this.isRunning) return true;

    const jarPath = this._findJar();
    if (!jarPath) {
      log.warn('[ScrcpyManager] scrcpy-server.jar 不存在，請先執行 download-scrcpy 腳本');
      return false;
    }

    try {
      // 1. 推送 JAR 到模擬器
      await this._exec(`-s ${this.deviceId} push "${jarPath}" ${SCRCPY_DEVICE_PATH}`);
      log.info('[ScrcpyManager] scrcpy-server.jar 已推送');

      // 2. 建立 ADB forward
      await this._exec(`-s ${this.deviceId} forward tcp:${SCRCPY_PORT} localabstract:scrcpy`);
      log.info(`[ScrcpyManager] ADB forward 已設定 tcp:${SCRCPY_PORT}`);

      // 3. 在模擬器內啟動 scrcpy-server
      this._startServer({ maxSize, maxFps, bitRate });

      // 4. 等待 server 就緒（監聽 abstract socket）
      await this._sleep(1200);

      // 5. 連接影像 socket（先連）
      await this._connectVideoSocket();

      // 6. 連接控制 socket（後連）
      await this._connectControlSocket();

      this.isRunning = true;
      log.info(`[ScrcpyManager] 就緒：${this.deviceName} ${this.videoWidth}x${this.videoHeight}`);
      this.emit('ready', {
        deviceName: this.deviceName,
        width:  this.videoWidth,
        height: this.videoHeight,
      });
      return true;

    } catch (err) {
      log.error('[ScrcpyManager] 啟動失敗：', err.message);
      this.stop();
      return false;
    }
  }

  /**
   * 停止 scrcpy-server 並清理所有資源。
   */
  stop() {
    this.isRunning = false;

    if (this.videoSocket) {
      try { this.videoSocket.destroy(); } catch (_) {}
      this.videoSocket = null;
    }
    if (this.controlSocket) {
      try { this.controlSocket.destroy(); } catch (_) {}
      this.controlSocket = null;
    }
    if (this.serverProcess) {
      try { this.serverProcess.kill(); } catch (_) {}
      this.serverProcess = null;
    }

    // 移除 ADB forward
    this._exec(`-s ${this.deviceId} forward --remove tcp:${SCRCPY_PORT}`).catch(() => {});

    this.emit('closed');
    log.info('[ScrcpyManager] 已停止');
  }

  /**
   * 注入觸控事件（單指）。
   * @param {number} action  - 0=DOWN, 1=UP, 2=MOVE
   * @param {number} x       - 螢幕像素 X
   * @param {number} y       - 螢幕像素 Y
   * @param {number} screenW - 螢幕寬度（用於 scrcpy 內部座標換算）
   * @param {number} screenH - 螢幕高度
   * @param {number} [pointerId=0] - 觸控點 ID（多指時需不同 ID）
   * @returns {boolean}
   */
  sendTouchEvent(action, x, y, screenW, screenH, pointerId = 0) {
    if (!this.controlSocket || !this.isRunning) return false;

    // INJECT_TOUCH_EVENT = type 2
    // Layout: [uint8 type][uint8 action][int64be pointerId]
    //         [int32be x][int32be y][uint16be w][uint16be h]
    //         [uint16be pressure][uint32be actionButton][uint32be buttons]
    // Total  = 1 + 1 + 8 + 4 + 4 + 2 + 2 + 2 + 4 + 4 = 32 bytes
    const buf = Buffer.allocUnsafe(32);
    let o = 0;

    buf.writeUInt8(2, o); o += 1;  // INJECT_TOUCH_EVENT
    buf.writeUInt8(action, o); o += 1;
    buf.writeBigInt64BE(BigInt(pointerId), o); o += 8;
    buf.writeInt32BE(Math.round(x), o); o += 4;
    buf.writeInt32BE(Math.round(y), o); o += 4;
    buf.writeUInt16BE(screenW, o); o += 2;
    buf.writeUInt16BE(screenH, o); o += 2;
    // pressure: 0 for UP, 0xFFFF for DOWN/MOVE
    buf.writeUInt16BE(action === AMOTION_ACTION_UP ? 0 : 0xFFFF, o); o += 2;
    buf.writeUInt32BE(0, o); o += 4;  // actionButton (0 = not a mouse button)
    buf.writeUInt32BE(0, o);          // buttons

    return this._writeControl(buf);
  }

  /**
   * 注入鍵盤事件。
   * @param {number} keyCode - Android KEYCODE
   * @returns {boolean}
   */
  sendKeyEvent(keyCode) {
    if (!this.controlSocket || !this.isRunning) return false;

    // 發送 DOWN 後立刻發送 UP（模擬按下再放開）
    // INJECT_KEYCODE = type 0
    // Layout: [uint8 type][uint8 action][int32be keyCode][int32be repeat][int32be metaState]
    // Total  = 1 + 1 + 4 + 4 + 4 = 14 bytes
    const makeKeyBuf = (action) => {
      const b = Buffer.allocUnsafe(14);
      let o = 0;
      b.writeUInt8(0, o); o += 1;      // INJECT_KEYCODE
      b.writeUInt8(action, o); o += 1;
      b.writeInt32BE(keyCode, o); o += 4;
      b.writeInt32BE(0, o); o += 4;    // repeat
      b.writeInt32BE(0, o);            // metaState
      return b;
    };

    const ok1 = this._writeControl(makeKeyBuf(AKEY_ACTION_DOWN));
    const ok2 = this._writeControl(makeKeyBuf(AKEY_ACTION_UP));
    return ok1 && ok2;
  }

  /**
   * 透過 Android keyCode 名稱發送按鍵。
   * @param {string} keyName - 如 'back', 'home', 'menu', 'enter', 'delete'
   */
  sendNamedKey(keyName) {
    const keyCode = ANDROID_KEYCODES[keyName] ?? parseInt(keyName, 10);
    if (isNaN(keyCode)) {
      log.warn('[ScrcpyManager] 未知按鍵名稱:', keyName);
      return false;
    }
    return this.sendKeyEvent(keyCode);
  }

  // ─────────────────────────────────────────
  // 內部實作
  // ─────────────────────────────────────────

  _findJar() {
    const candidates = [];
    try {
      const { app } = require('electron');
      if (app.isPackaged && process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'scrcpy', 'scrcpy-server.jar'));
      }
    } catch (_) {}
    // 開發模式路徑
    candidates.push(path.join(__dirname, '..', '..', 'resources', 'scrcpy', 'scrcpy-server.jar'));

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  _startServer({ maxSize, maxFps, bitRate }) {
    // adb shell 中用空格分隔所有參數
    const shellCmd = [
      `CLASSPATH=${SCRCPY_DEVICE_PATH}`,
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      SCRCPY_SERVER_VERSION,
      'log_level=info',
      'video=true',
      'audio=false',
      'control=true',
      'tunnel_forward=true',
      'send_device_meta=true',
      'send_frame_meta=false',
      'send_dummy_byte=false',
      `max_size=${maxSize}`,
      `max_fps=${maxFps}`,
      `video_bit_rate=${bitRate}`,
      'video_codec=h264',
      'cleanup=true',
      'stay_awake=false',
    ].join(' ');

    // 使用 spawn 讓 server 在背景執行
    this.serverProcess = spawn(
      this.adbPath,
      ['-s', this.deviceId, 'shell', shellCmd],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    this.serverProcess.stdout.on('data', (d) => log.debug('[scrcpy-server stdout]', d.toString().trim()));
    this.serverProcess.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) log.info('[scrcpy-server]', msg);
    });

    this.serverProcess.on('exit', (code) => {
      log.warn('[ScrcpyManager] server 已退出，code:', code);
      if (this.isRunning) {
        this.isRunning = false;
        this.emit('closed');
      }
    });

    this.serverProcess.on('error', (err) => {
      log.error('[ScrcpyManager] server 程序錯誤:', err.message);
    });
  }

  _connectVideoSocket() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(SCRCPY_PORT, '127.0.0.1');
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('影像 socket 連接逾時'));
      }, 8000);

      // scrcpy 2.x: send_device_meta=true 時，header = 64(name) + 4(w) + 4(h) = 72 bytes
      const HEADER_SIZE = 72;
      let headerBuf = Buffer.alloc(0);
      let headerDone = false;

      socket.on('connect', () => log.info('[ScrcpyManager] 影像 socket 已連接'));

      socket.on('data', (chunk) => {
        if (headerDone) {
          // 直接發送 H.264 資料
          this.emit('video-data', chunk);
          return;
        }

        headerBuf = Buffer.concat([headerBuf, chunk]);
        if (headerBuf.length >= HEADER_SIZE) {
          clearTimeout(timeout);
          headerDone = true;

          this.deviceName  = headerBuf.slice(0, 64).toString('utf8').replace(/\0/g, '');
          this.videoWidth  = headerBuf.readUInt32BE(64);
          this.videoHeight = headerBuf.readUInt32BE(68);

          log.info(`[ScrcpyManager] 設備：${this.deviceName} ${this.videoWidth}x${this.videoHeight}`);

          // header 之後的部分就是 H.264 資料
          const rest = headerBuf.slice(HEADER_SIZE);
          if (rest.length > 0) this.emit('video-data', rest);

          resolve();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        if (!headerDone) reject(err);
        else {
          log.error('[ScrcpyManager] 影像 socket 錯誤:', err.message);
          this.emit('error', err);
        }
      });

      socket.on('close', () => {
        if (!headerDone) return;
        log.info('[ScrcpyManager] 影像 socket 已關閉');
        this.videoSocket = null;
        if (this.isRunning) {
          this.isRunning = false;
          this.emit('closed');
        }
      });

      this.videoSocket = socket;
    });
  }

  _connectControlSocket() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(SCRCPY_PORT, '127.0.0.1');
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('控制 socket 連接逾時'));
      }, 8000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        this.controlSocket = socket;
        log.info('[ScrcpyManager] 控制 socket 已連接');
        resolve();
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      socket.on('close', () => {
        log.warn('[ScrcpyManager] 控制 socket 已關閉');
        this.controlSocket = null;
      });
    });
  }

  _writeControl(buf) {
    try {
      this.controlSocket.write(buf);
      return true;
    } catch (err) {
      log.error('[ScrcpyManager] 控制 socket 寫入錯誤:', err.message);
      this.controlSocket = null;
      return false;
    }
  }

  _exec(args) {
    return new Promise((resolve, reject) => {
      exec(`${this.adbPath} ${args}`, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || stdout || err.message));
        else resolve({ stdout, stderr });
      });
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ScrcpyManager;
