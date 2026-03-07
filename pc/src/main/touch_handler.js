/**
 * Touch Handler - 觸控事件處理
 *
 * 注入模式（優先順序）：
 *   1. scrcpy 控制通道（推薦）：
 *      二進制協議，持久連線，延遲 < 5ms，支援多點觸控
 *
 *   2. adb shell 回退模式：
 *      每次 touch 呼叫 adb shell input tap/swipe
 *      延遲 80-150ms（需 fork 新程序）
 *
 * 在 main.js 透過 setScrcpyManager() 傳入 ScrcpyManager 後即啟用高效模式。
 */

const { exec } = require('child_process');
const log = require('electron-log');

class TouchHandler {
  constructor(adbPath, deviceId) {
    this.adbPath  = adbPath;
    this.deviceId = deviceId;

    // 由 main.js 注入；存在且 isRunning 時使用 scrcpy 控制通道
    this.scrcpyManager = null;

    this.lastX = 0;
    this.lastY = 0;
    this.isDown = false;

    // 螢幕解析度（從設備取得）
    this.screenWidth  = 1080;
    this.screenHeight = 1920;
  }

  // ─────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────

  /**
   * 由 main.js 在初始化 ScrcpyManager 後呼叫。
   */
  setScrcpyManager(manager) {
    this.scrcpyManager = manager;
    log.info('[TouchHandler] ScrcpyManager 已注入，將使用 scrcpy 控制通道');
  }

  /**
   * 處理觸控事件（單指）。
   * @param {object} data - { action, x, y, pointerId?, endX?, endY?, duration? }
   *                        x, y 為歸一化座標（0-1）
   */
  async handleTouch(data) {
    const { action, x, y, pointerId = 0 } = data;

    const { w, h } = this._effectiveDims();
    const posX = Math.round(x * w);
    const posY = Math.round(y * h);

    try {
      switch (action) {
        case 'down':  await this.touchDown(posX, posY, pointerId);  break;
        case 'move':  await this.touchMove(posX, posY, pointerId);  break;
        case 'up':    await this.touchUp(posX, posY, pointerId);    break;
        case 'tap':   await this.tap(posX, posY);                   break;
        case 'swipe': {
          const ex = Math.round((data.endX ?? x) * w);
          const ey = Math.round((data.endY ?? y) * h);
          await this.swipe(posX, posY, ex, ey, data.duration ?? 300);
          break;
        }
        default:
          log.warn('[TouchHandler] 未知觸控動作：', action);
      }
    } catch (err) {
      log.error('[TouchHandler] 觸控事件錯誤：', err.message);
    }
  }

  /**
   * 按下。
   */
  async touchDown(x, y, pointerId = 0) {
    this.lastX  = x;
    this.lastY  = y;
    this.isDown = true;

    if (this._useScrcpy()) {
      const { w, h } = this._effectiveDims();
      this.scrcpyManager.sendTouchEvent(0, x, y, w, h, pointerId);
    } else {
      await this._adbShell(`input tap ${x} ${y}`);
    }
  }

  /**
   * 移動。
   */
  async touchMove(x, y, pointerId = 0) {
    const dx       = x - this.lastX;
    const dy       = y - this.lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 2) return;  // 微小移動忽略

    if (this._useScrcpy()) {
      const { w, h } = this._effectiveDims();
      this.scrcpyManager.sendTouchEvent(2, x, y, w, h, pointerId);
    } else {
      const duration = Math.max(10, Math.floor(distance / 2));
      await this._adbShell(`input swipe ${this.lastX} ${this.lastY} ${x} ${y} ${duration}`);
    }

    this.lastX = x;
    this.lastY = y;
  }

  /**
   * 放開。
   */
  async touchUp(x, y, pointerId = 0) {
    this.isDown = false;

    if (this._useScrcpy()) {
      const { w, h } = this._effectiveDims();
      this.scrcpyManager.sendTouchEvent(1, x, y, w, h, pointerId);
    }
    // adb shell 回退：swipe 完成後不需要額外的 UP 事件
  }

  /**
   * 點擊（down + up）。
   */
  async tap(x, y) {
    if (this._useScrcpy()) {
      const { w, h } = this._effectiveDims();
      this.scrcpyManager.sendTouchEvent(0, x, y, w, h, 0);
      // 給設備一點反應時間後再發 UP（模擬真實點擊）
      await this._sleep(50);
      this.scrcpyManager.sendTouchEvent(1, x, y, w, h, 0);
    } else {
      await this._adbShell(`input tap ${x} ${y}`);
    }
    log.debug(`[TouchHandler] TAP: ${x}, ${y}`);
  }

  /**
   * 滑動（接受歸一化或像素座標）。
   * @param {number} startX, startY  - 像素座標
   * @param {number} endX, endY      - 像素座標
   * @param {number} duration        - 毫秒
   */
  async swipe(startX, startY, endX, endY, duration = 300) {
    if (this._useScrcpy()) {
      // 分拆成多個 MOVE 事件以模擬平滑滑動
      await this._scrcpySwipe(startX, startY, endX, endY, duration);
    } else {
      await this._adbShell(`input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
    }
    log.debug(`[TouchHandler] SWIPE: ${startX},${startY} -> ${endX},${endY} (${duration}ms)`);
  }

  /**
   * 發送鍵盤事件。
   * @param {string} key - 'back' | 'home' | 'menu' | 'enter' | 'delete' | 數字字串
   */
  async sendKey(key) {
    if (this._useScrcpy()) {
      this.scrcpyManager.sendNamedKey(String(key));
    } else {
      const keyMap = {
        back:   '4',
        home:   '3',
        menu:   '82',
        enter:  '66',
        delete: '67',
        esc:    '4',
      };
      const keyCode = keyMap[key] ?? key;
      await this._adbShell(`input keyevent ${keyCode}`);
    }
    log.debug(`[TouchHandler] KEY: ${key}`);
  }

  /**
   * 發送文字輸入。
   */
  async sendText(text) {
    if (this._useScrcpy()) {
      // scrcpy SET_CLIPBOARD + INJECT_TEXT 較複雜，回退用 adb shell
      // 但先用 adb shell 保持相容性（text 輸入頻率遠低於 touch）
      const escaped = text.replace(/ /g, '%s').replace(/'/g, "\\'");
      await this._adbShell(`input text '${escaped}'`);
    } else {
      const escaped = text.replace(/ /g, '%s');
      await this._adbShell(`input text ${escaped}`);
    }
    log.debug(`[TouchHandler] TEXT: ${text}`);
  }

  /**
   * 從設備取得螢幕解析度並快取。
   * @returns {{ width: number, height: number }}
   */
  async updateScreenSize() {
    return new Promise((resolve) => {
      exec(
        `${this.adbPath} -s ${this.deviceId} shell wm size`,
        { maxBuffer: 512 * 1024 },
        (err, stdout) => {
          if (!err) {
            const match = (stdout || '').match(/(\d+)x(\d+)/);
            if (match) {
              this.screenWidth  = parseInt(match[1], 10);
              this.screenHeight = parseInt(match[2], 10);
              log.info(`[TouchHandler] 螢幕大小：${this.screenWidth}x${this.screenHeight}`);
            }
          } else {
            log.warn('[TouchHandler] 無法取得螢幕大小，使用預設值');
          }
          resolve({ width: this.screenWidth, height: this.screenHeight });
        }
      );
    });
  }

  // ─────────────────────────────────────────
  // 內部實作
  // ─────────────────────────────────────────

  _useScrcpy() {
    return !!(this.scrcpyManager?.isRunning && this.scrcpyManager?.controlSocket);
  }

  /**
   * 返回觸控事件應使用的螢幕尺寸。
   * scrcpy 以 video 流尺寸（max_size 縮放後）作為座標空間，
   * 若傳入與 server 不符的尺寸會觸發 "different device size" 警告並丟棄事件。
   */
  _effectiveDims() {
    if (this._useScrcpy() && this.scrcpyManager.videoWidth > 0) {
      return { w: this.scrcpyManager.videoWidth, h: this.scrcpyManager.videoHeight };
    }
    return { w: this.screenWidth, h: this.screenHeight };
  }

  /**
   * 用 scrcpy 控制通道模擬平滑滑動：
   * DOWN → N × MOVE → UP
   */
  async _scrcpySwipe(x1, y1, x2, y2, durationMs) {
    const STEPS = Math.max(3, Math.round(durationMs / 16));  // ~60fps 步數
    const stepDelay = Math.round(durationMs / STEPS);
    const m = this.scrcpyManager;
    const { w, h } = this._effectiveDims();

    m.sendTouchEvent(0, x1, y1, w, h, 0);  // DOWN

    for (let i = 1; i < STEPS; i++) {
      const t  = i / STEPS;
      const mx = Math.round(x1 + (x2 - x1) * t);
      const my = Math.round(y1 + (y2 - y1) * t);
      m.sendTouchEvent(2, mx, my, w, h, 0);  // MOVE
      await this._sleep(stepDelay);
    }

    m.sendTouchEvent(1, x2, y2, w, h, 0);  // UP
  }

  _adbShell(command) {
    return new Promise((resolve) => {
      exec(
        `${this.adbPath} -s ${this.deviceId} shell ${command}`,
        { maxBuffer: 512 * 1024 },
        (err) => {
          if (err) log.warn('[TouchHandler] adb shell 錯誤：', err.message);
          resolve();
        }
      );
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TouchHandler;
