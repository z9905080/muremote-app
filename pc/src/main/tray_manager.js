/**
 * Tray Manager
 * 系統匣圖標管理
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const log = require('electron-log');

class TrayManager {
  constructor(mainWindow) {
    this.tray = null;
    this.mainWindow = mainWindow;
    this.connectionStatus = 'disconnected';
    this.streamingStatus = false;
  }

  /**
   * 建立系統匣
   */
  create() {
    try {
      // 創建一個簡單的圖標
      const icon = this.createDefaultIcon();
      
      this.tray = new Tray(icon);
      this.tray.setToolTip('MuRemote - 遠端控制');
      
      this.updateMenu();
      
      // 點擊顯示視窗
      this.tray.on('click', () => {
        if (this.mainWindow) {
          if (this.mainWindow.isVisible()) {
            this.mainWindow.hide();
          } else {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      });

      log.info('Tray created');
    } catch (e) {
      log.error('Failed to create tray:', e);
    }
  }

  /**
   * 創建默認圖標
   */
  createDefaultIcon() {
    // 創建一個 16x16 的簡單圖標
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    
    // 填充藍色背景
    for (let i = 0; i < size * size; i++) {
      canvas[i * 4] = 102;     // R
      canvas[i * 4 + 1] = 126; // G
      canvas[i * 4 + 2] = 230; // B
      canvas[i * 4 + 3] = 255; // A
    }
    
    return nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size
    });
  }

  /**
   * 更新選單
   */
  updateMenu() {
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: 'MuRemote', 
        enabled: false 
      },
      { type: 'separator' },
      {
        label: `連線狀態: ${this.getConnectionStatusText()}`,
        enabled: false
      },
      {
        label: `串流: ${this.streamingStatus ? '進行中' : '待機'}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: '顯示',
        click: () => {
          this.mainWindow?.show();
          this.mainWindow?.focus();
        }
      },
      {
        label: '隱藏',
        click: () => {
          this.mainWindow?.hide();
        }
      },
      { type: 'separator' },
      {
        label: '設定',
        click: () => {
          this.mainWindow?.show();
          this.mainWindow?.webContents.send('navigate', '/settings');
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    this.tray?.setContextMenu(contextMenu);
  }

  /**
   * 獲取連線狀態文字
   */
  getConnectionStatusText() {
    switch (this.connectionStatus) {
      case 'connected': return '已連線';
      case 'connecting': return '連線中...';
      case 'error': return '連線錯誤';
      default: return '未連線';
    }
  }

  /**
   * 更新連線狀態
   */
  updateConnectionStatus(status) {
    this.connectionStatus = status;
    this.updateMenu();
    
    // 更新 tooltip
    this.tray?.setToolTip(`MuRemote - ${this.getConnectionStatusText()}`);
  }

  /**
   * 更新串流狀態
   */
  updateStreamingStatus(isStreaming) {
    this.streamingStatus = isStreaming;
    this.updateMenu();
  }

  /**
   * 顯示通知
   */
  showNotification(title, body) {
    if (this.tray) {
      // Electron 的通知需要另外的模組
      // 這裡只更新 tooltip
      this.tray.setToolTip(`${title}: ${body}`);
    }
  }

  /**
   * 銷毀
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
