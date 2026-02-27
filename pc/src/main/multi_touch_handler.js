/**
 * Multi-touch Handler
 * 支援多點觸控手勢
 */

const log = require('electron-log');

class MultiTouchHandler {
  constructor(touchHandler) {
    this.touchHandler = touchHandler;
    this.activePointers = new Map(); // pointerId -> { x, y, startX, startY }
    this.maxPointers = 5;
  }

  /**
   * 處理多點觸控事件
   */
  async handleMultiTouch(data) {
    const { pointers, action } = data;

    switch (action) {
      case 'pointer-down':
        await this.handlePointerDown(pointers);
        break;
      case 'pointer-move':
        await this.handlePointerMove(pointers);
        break;
      case 'pointer-up':
        await this.handlePointerUp(pointers);
        break;
      case 'pinch':
        await this.handlePinch(pointers);
        break;
      case 'rotate':
        await this.handleRotate(pointers);
        break;
    }
  }

  /**
   * 處理手指按下
   */
  async handlePointerDown(pointers) {
    for (const pointer of pointers) {
      const { pointerId, x, y } = pointer;
      
      if (this.activePointers.size < this.maxPointers) {
        this.activePointers.set(pointerId, {
          x, y,
          startX: x,
          startY: y
        });
        
        // 記錄為按下狀態
        await this.touchHandler.touchDown(x, y);
      }
    }
  }

  /**
   * 處理手指移動
   */
  async handlePointerMove(pointers) {
    for (const pointer of pointers) {
      const { pointerId, x, y } = pointer;
      const activePointer = this.activePointers.get(pointerId);
      
      if (activePointer) {
        // 計算移動距離
        const dx = x - activePointer.x;
        const dy = y - activePointer.y;
        
        // 移動超過閾值才觸發
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          await this.touchHandler.touchMove(x, y);
          activePointer.x = x;
          activePointer.y = y;
        }
      }
    }
  }

  /**
   * 處理手指放開
   */
  async handlePointerUp(pointers) {
    for (const pointer of pointers) {
      const { pointerId, x, y } = pointer;
      
      if (this.activePointers.has(pointerId)) {
        await this.touchHandler.touchUp(x, y);
        this.activePointers.delete(pointerId);
      }
    }
  }

  /**
   * 處理縮放手勢 (雙指)
   */
  async handlePinch(pointers) {
    if (pointers.length < 2) return;

    const p1 = pointers[0];
    const p2 = pointers[1];

    // 計算兩指距離
    const distance = this.calculateDistance(p1, p2);
    
    // 記錄初始距離用於計算比例
    if (!this.pinchStartDistance) {
      this.pinchStartDistance = distance;
      this.pinchStartTime = Date.now();
      return;
    }

    const scale = distance / this.pinchStartDistance;
    const duration = Date.now() - this.pinchStartTime;

    // 縮放動作
    if (scale > 1.2) {
      // 放大
      log.info('Pinch zoom in');
      await this.touchHandler.sendKey('KEYCODE_VOLUME_UP');
    } else if (scale < 0.8) {
      // 縮小
      log.info('Pinch zoom out');
      await this.touchHandler.sendKey('KEYCODE_VOLUME_DOWN');
    }

    // 重置
    if (duration > 500) {
      this.pinchStartDistance = distance;
      this.pinchStartTime = Date.now();
    }
  }

  /**
   * 處理旋轉手勢
   */
  async handleRotate(pointers) {
    if (pointers.length < 2) return;

    const p1 = pointers[0];
    const p2 = pointers[1];

    // 計算角度
    const angle = this.calculateAngle(p1, p2);
    
    if (!this.lastAngle) {
      this.lastAngle = angle;
      return;
    }

    const deltaAngle = angle - this.lastAngle;
    
    // 旋轉動作 (需要遊戲支援)
    log.info('Rotation:', deltaAngle);
    
    this.lastAngle = angle;
  }

  /**
   * 計算兩點距離
   */
  calculateDistance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 計算角度
   */
  calculateAngle(p1, p2) {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
  }

  /**
   * 清除所有觸控點
   */
  clear() {
    this.activePointers.clear();
    this.pinchStartDistance = null;
    this.lastAngle = null;
  }
}

module.exports = MultiTouchHandler;
