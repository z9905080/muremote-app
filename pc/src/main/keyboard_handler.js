/**
 * Keyboard Handler
 * 完整鍵盤映射支援
 */

const log = require('electron-log');

class KeyboardHandler {
  constructor(adbClient, deviceId) {
    this.adbClient = adbClient;
    this.deviceId = deviceId;
    
    // Android 鍵碼映射表
    this.keyCodes = {
      // 數字鍵
      '0': 'KEYCODE_0', '1': 'KEYCODE_1', '2': 'KEYCODE_2', '3': 'KEYCODE_3',
      '4': 'KEYCODE_4', '5': 'KEYCODE_5', '6': 'KEYCODE_6', '7': 'KEYCODE_7',
      '8': 'KEYCODE_8', '9': 'KEYCODE_9',
      
      // 字母鍵 (大寫)
      'A': 'KEYCODE_A', 'B': 'KEYCODE_B', 'C': 'KEYCODE_C', 'D': 'KEYCODE_D',
      'E': 'KEYCODE_E', 'F': 'KEYCODE_F', 'G': 'KEYCODE_G', 'H': 'KEYCODE_H',
      'I': 'KEYCODE_I', 'J': 'KEYCODE_J', 'K': 'KEYCODE_K', 'L': 'KEYCODE_L',
      'M': 'KEYCODE_M', 'N': 'KEYCODE_N', 'O': 'KEYCODE_O', 'P': 'KEYCODE_P',
      'Q': 'KEYCODE_Q', 'R': 'KEYCODE_R', 'S': 'KEYCODE_S', 'T': 'KEYCODE_T',
      'U': 'KEYCODE_U', 'V': 'KEYCODE_V', 'W': 'KEYCODE_W', 'X': 'KEYCODE_X',
      'Y': 'KEYCODE_Y', 'Z': 'KEYCODE_Z',
      
      // 功能鍵
      'ENTER': 'KEYCODE_ENTER', 'ESCAPE': 'KEYCODE_ESCAPE',
      'BACKSPACE': 'KEYCODE_DEL', 'TAB': 'KEYCODE_TAB',
      'SPACE': 'KEYCODE_SPACE', 'SHIFT': 'KEYCODE_SHIFT_LEFT',
      'CTRL': 'KEYCODE_CTRL_LEFT', 'ALT': 'KEYCODE_ALT_LEFT',
      
      // 方向鍵
      'UP': 'KEYCODE_DPAD_UP', 'DOWN': 'KEYCODE_DPAD_DOWN',
      'LEFT': 'KEYCODE_DPAD_LEFT', 'RIGHT': 'KEYCODE_DPAD_RIGHT',
      'INSERT': 'KEYCODE_INSERT', 'DELETE': 'KEYCODE_FORWARD_DEL',
      'PAGE_UP': 'KEYCODE_PAGE_UP', 'PAGE_DOWN': 'KEYCODE_PAGE_DOWN',
      'END': 'KEYCODE_MOVE_END', 'HOME': 'KEYCODE_MOVE_END',
      
      // 符號鍵
      '-': 'KEYCODE_MINUS', '=': 'KEYCODE_EQUALS',
      '[': 'KEYCODE_LEFT_BRACKET', ']': 'KEYCODE_RIGHT_BRACKET',
      '\\': 'KEYCODE_BACKSLASH', ';': 'KEYCODE_SEMICOLON',
      "'": 'KEYCODE_APOSTROPHE,', ',': 'KEYCODE_COMMA',
      '.': 'KEYCODE_PERIOD', '/': 'KEYCODE_SLASH',
      '`': 'KEYCODE_GRAVE',
      
      // Android 系統鍵
      'HOME': 'KEYCODE_HOME', 'BACK': 'KEYCODE_BACK',
      'MENU': 'KEYCODE_MENU', 'POWER': 'KEYCODE_POWER',
      'SEARCH': 'KEYCODE_SEARCH', 'APP_SWITCH': 'KEYCODE_APP_SWITCH',
      'RECENT': 'KEYCODE_APP_SWITCH', 'VOLUME_UP': 'KEYCODE_VOLUME_UP',
      'VOLUME_DOWN': 'KEYCODE_VOLUME_DOWN', 'MUTE': 'KEYCODE_VOLUME_MUTE',
      
      // 媒體鍵
      'PLAY': 'KEYCODE_MEDIA_PLAY_PAUSE', 'PAUSE': 'KEYCODE_MEDIA_PAUSE',
      'STOP': 'KEYCODE_MEDIA_STOP', 'NEXT': 'KEYCODE_MEDIA_NEXT',
      'PREV': 'KEYCODE_MEDIA_PREVIOUS', 'REWIND': 'KEYCODE_MEDIA_REWIND',
      'FAST_FORWARD': 'KEYCODE_MEDIA_FAST_FORWARD',
      
      // F1-F12 功能鍵
      'F1': 'KEYCODE_F1', 'F2': 'KEYCODE_F2', 'F3': 'KEYCODE_F3',
      'F4': 'KEYCODE_F4', 'F5': 'KEYCODE_F5', 'F6': 'KEYCODE_F6',
      'F7': 'KEYCODE_F7', 'F8': 'KEYCODE_F8', 'F9': 'KEYCODE_F9',
      'F10': 'KEYCODE_F10', 'F11': 'KEYCODE_F11', 'F12': 'KEYCODE_F12',
      
      // 數字鍵盤
      'NUMPAD_0': 'KEYCODE_NUMPAD_0', 'NUMPAD_1': 'KEYCODE_NUMPAD_1',
      'NUMPAD_2': 'KEYCODE_NUMPAD_2', 'NUMPAD_3': 'KEYCODE_NUMPAD_3',
      'NUMPAD_4': 'KEYCODE_NUMPAD_4', 'NUMPAD_5': 'KEYCODE_NUMPAD_5',
      'NUMPAD_6': 'KEYCODE_NUMPAD_6', 'NUMPAD_7': 'KEYCODE_NUMPAD_7',
      'NUMPAD_8': 'KEYCODE_NUMPAD_8', 'NUMPAD_9': 'KEYCODE_NUMPAD_9',
      'NUMPAD_ADD': 'KEYCODE_NUMPAD_ADD', 'NUMPAD_SUBTRACT': 'KEYCODE_NUMPAD_SUBTRACT',
      'NUMPAD_MULTIPLY': 'KEYCODE_NUMPAD_MULTIPLY', 'NUMPAD_DIVIDE': 'KEYCODE_NUMPAD_DIVIDE',
      'NUMPAD_DOT': 'KEYCODE_NUMPAD_DOT', 'NUMPAD_ENTER': 'KEYCODE_NUMPAD_ENTER',
    };

    // 常用快捷鍵映射 (電腦鍵盤 -> Android 動作)
    this.shortcuts = {
      // Ctrl 組合鍵
      'CTRL+A': 'select_all',
      'CTRL+C': 'copy',
      'CTRL+V': 'paste',
      'CTRL+X': 'cut',
      'CTRL+S': 'save',
      'CTRL+Z': 'undo',
      'CTRL+Y': 'redo',
      'CTRL+F': 'search',
      'CTRL+W': 'close',
      'CTRL+R': 'refresh',
      'CTRL+T': 'new_tab',
      'CTRL+N': 'new',
      'CTRL+P': 'print',
      'CTRL+O': 'open',
      'CTRL+G': 'find_next',
      'CTRL+H': 'replace',
      'CTRL+L': 'focus_url',
      'CTRL+D': 'bookmark',
      'CTRL+SHIFT+T': 'restore_tab',
      'CTRL+SHIFT+W': 'close_all_tabs',
      
      // Alt 組合鍵
      'ALT+TAB': 'switch_app',
      'ALT+F4': 'force_close',
      'ALT+ENTER': 'fullscreen',
      'ALT+SPACE': 'system_menu',
      
      // 遊戲常用快捷鍵
      'W': 'dpad_up',
      'A': 'dpad_left',
      'S': 'dpad_down',
      'D': 'dpad_right',
      'Q': 'inventory',
      'E': 'interact',
      'ESC': 'back',
      'ENTER': 'confirm',
      'SPACE': 'jump',
      'SHIFT': 'sprint',
      'CTRL': 'attack',
    };

    // 自定義鍵映射 (用戶可配置)
    this.customMappings = {};
  }

  /**
   * 發送鍵盤事件
   */
  async sendKey(key) {
    const keyCode = this.keyCodes[key.toUpperCase()] || key;
    
    try {
      await this.adbClient.shell(this.deviceId, `input keyevent ${keyCode}`);
      log.info(`Key sent: ${key} -> ${keyCode}`);
      return true;
    } catch (error) {
      log.error(`Failed to send key ${key}:`, error);
      return false;
    }
  }

  /**
   * 發送文字
   */
  async sendText(text) {
    try {
      // 處理特殊字符
      const escaped = text
        .replace(/ /g, '%s')
        .replace(/'/g, "''")
        .replace(/"/g, '\\"');
      
      await this.adbClient.shell(this.deviceId, `input text "${escaped}"`);
      log.info(`Text sent: ${text}`);
      return true;
    } catch (error) {
      log.error('Failed to send text:', error);
      return false;
    }
  }

  /**
   * 優化發送文字 (分段發送，減少延遲)
   * 適用於發送較長的文字
   */
  async sendTextOptimized(text, chunkSize = 50) {
    try {
      // 對於短文字，直接發送
      if (text.length <= chunkSize) {
        return await this.sendText(text);
      }
      
      // 分段發送長文字
      const chunks = [];
      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
      }
      
      for (const chunk of chunks) {
        await this.sendText(chunk);
        // 短延遲避免緩衝區溢出
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      log.info(`Optimized text sent: ${text.length} chars in ${chunks.length} chunks`);
      return true;
    } catch (error) {
      log.error('Failed to send optimized text:', error);
      return false;
    }
  }

  /**
   * 發送組合鍵
   */
  async sendCombo(keys) {
    // 例如: Ctrl+C
    const modifiers = [];
    const mainKey = keys.pop();
    
    for (const key of keys) {
      const modifier = this.getModifier(key);
      if (modifier) modifiers.push(modifier);
    }
    
    if (modifiers.length > 0 && mainKey) {
      try {
        // 先按下修飾鍵
        for (const mod of modifiers) {
          await this.adbClient.shell(this.deviceId, `input keyevent ${mod}`);
        }
        
        // 按下主鍵
        await this.sendKey(mainKey);
        
        // 放開修飾鍵 (反向順序)
        for (const mod of modifiers.reverse()) {
          const releaseCode = this.getReleaseCode(mod);
          await this.adbClient.shell(this.deviceId, `input keyevent ${releaseCode}`);
        }
        
        return true;
      } catch (error) {
        log.error('Failed to send combo:', error);
        return false;
      }
    }
    
    return false;
  }

  /**
   * 獲取修飾鍵碼
   */
  getModifier(key) {
    const modifiers = {
      'CTRL': 'KEYCODE_CTRL_LEFT',
      'SHIFT': 'KEYCODE_SHIFT_LEFT',
      'ALT': 'KEYCODE_ALT_LEFT',
      'META': 'KEYCODE_META_LEFT',
    };
    return modifiers[key.toUpperCase()];
  }

  /**
   * 獲取釋放鍵碼
   */
  getReleaseCode(keyCode) {
    // 釋放鍵碼 = 按下鍵碼 + 1
    // 例如: KEYCODE_A = 29, KEYCODE_A + 1 = 30 = KEYCODE_A + ACTION_UP
    // 這是一個簡化的實現
    const releaseCodes = {
      'KEYCODE_CTRL_LEFT': '176',
      'KEYCODE_SHIFT_LEFT': '54',
      'KEYCODE_ALT_LEFT': '56',
      'KEYCODE_META_LEFT': '115',
    };
    return releaseCodes[keyCode] || null;
  }

  /**
   * 添加自定義映射
   */
  addMapping(pcKey, androidKey) {
    this.customMappings[pcKey.toUpperCase()] = androidKey;
    log.info(`Added mapping: ${pcKey} -> ${androidKey}`);
  }

  /**
   * 移除自定義映射
   */
  removeMapping(pcKey) {
    delete this.customMappings[pcKey.toUpperCase()];
  }

  /**
   * 獲取所有映射
   */
  getMappings() {
    return { ...this.keyCodes, ...this.customMappings };
  }

  /**
   * 處理鍵盤事件 (從手機端接收)
   */
  async handleKeyboardEvent(data) {
    const { type, key, modifiers, text } = data;

    switch (type) {
      case 'key':
        if (modifiers && modifiers.length > 0) {
          await this.sendCombo([...modifiers, key]);
        } else {
          await this.sendKey(key);
        }
        break;
        
      case 'text':
        await this.sendText(text);
        break;
        
      case 'combo':
        await this.sendCombo(key);
        break;
        
      case 'shortcut':
        await this.handleShortcut(key);
        break;
    }
  }

  /**
   * 處理快捷鍵
   */
  async handleShortcut(shortcut) {
    const action = this.shortcuts[shortcut.toUpperCase()];
    if (!action) {
      log.warn(`Unknown shortcut: ${shortcut}`);
      return false;
    }
    
    // 根據快捷鍵動作發送對應的鍵事件
    switch (action) {
      case 'select_all':
        // Ctrl + A
        await this.sendCombo(['CTRL', 'A']);
        break;
      case 'copy':
        await this.sendCombo(['CTRL', 'C']);
        break;
      case 'paste':
        await this.sendCombo(['CTRL', 'V']);
        break;
      case 'cut':
        await this.sendCombo(['CTRL', 'X']);
        break;
      case 'save':
        await this.sendCombo(['CTRL', 'S']);
        break;
      case 'undo':
        await this.sendCombo(['CTRL', 'Z']);
        break;
      case 'redo':
        await this.sendCombo(['CTRL', 'Y']);
        break;
      case 'search':
        await this.sendCombo(['CTRL', 'F']);
        break;
      case 'refresh':
        await this.sendCombo(['CTRL', 'R']);
        break;
      case 'dpad_up':
        await this.sendKey('UP');
        break;
      case 'dpad_down':
        await this.sendKey('DOWN');
        break;
      case 'dpad_left':
        await this.sendKey('LEFT');
        break;
      case 'dpad_right':
        await this.sendKey('RIGHT');
        break;
      case 'back':
        await this.sendKey('BACK');
        break;
      case 'home':
        await this.sendKey('HOME');
        break;
      case 'confirm':
        await this.sendKey('ENTER');
        break;
      case 'jump':
        await this.sendKey('SPACE');
        break;
      case 'sprint':
        await this.sendKey('SHIFT');
        break;
      case 'attack':
        await this.sendKey('CTRL');
        break;
      default:
        log.warn(`Unhandled action: ${action}`);
        return false;
    }
    
    log.info(`Shortcut executed: ${shortcut} -> ${action}`);
    return true;
  }

  /**
   * 獲取所有可用的快捷鍵
   */
  getShortcuts() {
    return { ...this.shortcuts };
  }
}

module.exports = KeyboardHandler;
