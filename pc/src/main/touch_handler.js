/**
 * Touch Handler - 觸控事件處理
 * 處理手機端的觸控事件並轉換為 ADB 命令
 */

const log = require('electron-log');

class TouchHandler {
  constructor(adbClient, deviceId) {
    this.adbClient = adbClient;
    this.deviceId = deviceId;
    this.lastX = 0;
    this.lastY = 0;
    this.isDown = false;
    
    // 螢幕解析度 (預設，實際應該從設備獲取)
    this.screenWidth = 1080;
    this.screenHeight = 1920;
  }

  /**
   * 處理觸控事件
   * @param {Object} data - 觸控數據 { action, x, y, pointerId }
   */
  async handleTouch(data) {
    const { action, x, y, pointerId = 0 } = data;
    
    // 轉換座標 (0-1 範圍 -> 實際像素)
    const posX = Math.floor(x * this.screenWidth);
    const posY = Math.floor(y * this.screenHeight);

    try {
      switch (action) {
        case 'down':
          await this.touchDown(posX, posY);
          break;
        case 'move':
          await this.touchMove(posX, posY);
          break;
        case 'up':
          await this.touchUp(posX, posY);
          break;
        case 'tap':
          await this.tap(posX, posY);
          break;
        case 'swipe':
          await this.swipe(x, y, data.endX, data.endY, data.duration || 300);
          break;
        case 'pinch':
          // 支援縮放 (進階功能)
          await this.handlePinch(data);
          break;
        default:
          log.warn('Unknown touch action:', action);
      }
    } catch (error) {
      log.error('Touch event error:', error);
    }
  }

  /**
   * 按下
   */
  async touchDown(x, y) {
    this.lastX = x;
    this.lastY = y;
    this.isDown = true;
    
    // 使用 input tap 模擬觸控按下
    await this.adbClient.shell(this.deviceId, `input tap ${x} ${y}`);
    log.info(`Touch DOWN: ${x}, ${y}`);
  }

  /**
   * 移動
   */
  async touchMove(x, y) {
    // 計算滑動路徑
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 只有移動距離夠大才發送
    if (distance > 5) {
      // 使用 swipe 模擬滑動
      const duration = Math.max(10, Math.floor(distance / 2));
      await this.adbClient.shell(this.deviceId, 
        `input swipe ${this.lastX} ${this.lastY} ${x} ${y} ${duration}`
      );
      this.lastX = x;
      this.lastY = y;
    }
  }

  /**
   * 放開
   */
  async touchUp(x, y) {
    this.isDown = false;
    // 放開不需要特別動作，因為 swipe 已經完成
    log.info(`Touch UP: ${x}, ${y}`);
  }

  /**
   * 點擊
   */
  async tap(x, y) {
    await this.adbClient.shell(this.deviceId, `input tap ${x} ${y}`);
    log.info(`TAP: ${x}, ${y}`);
  }

  /**
   * 滑動
   */
  async swipe(startX, startY, endX, endY, duration = 300) {
    const sx = Math.floor(startX * this.screenWidth);
    const sy = Math.floor(startY * this.screenHeight);
    const ex = Math.floor(endX * this.screenWidth);
    const ey = Math.floor(endY * this.screenHeight);
    
    await this.adbClient.shell(this.deviceId, 
      `input swipe ${sx} ${sy} ${ex} ${ey} ${duration}`
    );
    log.info(`SWIPE: ${sx},${sy} -> ${ex},${ey} (${duration}ms)`);
  }

  /**
   * 處理雙指縮放
   */
  async handlePinch(data) {
    // 雙指縮放需要更複雜的 ADB 命令
    // 這是一個進階功能，POC 階段可以跳過
    log.info('Pinch gesture detected (not implemented in POC)');
  }

  /**
   * 發送鍵盤事件
   */
  async sendKey(key) {
    const keyMap = {
      'back': '4',      // 返回
      'home': '3',      // 首頁
      'menu': '82',     // 選單
      'enter': '66',    // 確定
      'delete': '67',   // 刪除
      'esc': '4',       // ESC
    };

    const keyCode = keyMap[key] || key;
    await this.adbClient.shell(this.deviceId, `input keyevent ${keyCode}`);
    log.info(`KEY: ${key} (${keyCode})`);
  }

  /**
   * 發送文字
   */
  async sendText(text) {
    // 文字需要特殊處理
    const escaped = text.replace(/ /g, '%s');
    await this.adbClient.shell(this.deviceId, `input text ${escaped}`);
    log.info(`TEXT: ${text}`);
  }

  /**
   * 設定螢幕解析度
   */
  async updateScreenSize() {
    try {
      // 獲取實際螢幕大小
      const result = await this.adbClient.shell(this.deviceId, 
        'wm size'
      );
      const match = result.match(/(\d+)x(\d+)/);
      if (match) {
        this.screenWidth = parseInt(match[1]);
        this.screenHeight = parseInt(match[2]);
        log.info(`Screen size: ${this.screenWidth}x${this.screenHeight}`);
      }
    } catch (e) {
      log.warn('Could not get screen size, using defaults');
    }
  }
}

module.exports = TouchHandler;
