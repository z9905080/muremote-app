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
      
      // 其他
      'HOME': 'KEYCODE_HOME', 'BACK': 'KEYCODE_BACK',
      'MENU': 'KEYCODE_MENU', 'POWER': 'KEYCODE_POWER',
      'SEARCH': 'KEYCODE_SEARCH',
      
      // 媒體鍵
      'VOLUME_UP': 'KEYCODE_VOLUME_UP',
      'VOLUME_DOWN': 'KEYCODE_VOLUME_DOWN',
      'MUTE': 'KEYCODE_VOLUME_MUTE',
      'PLAY': 'KEYCODE_MEDIA_PLAY_PAUSE',
      'PAUSE': 'KEYCODE_MEDIA_PAUSE',
      'STOP': 'KEYCODE_MEDIA_STOP',
      'NEXT': 'KEYCODE_MEDIA_NEXT',
      'PREV': 'KEYCODE_MEDIA_PREVIOUS',
      
      // 遊戲常用
      'F1': 'KEYCODE_F1', 'F2': 'KEYCODE_F2', 'F3': 'KEYCODE_F3',
      'F4': 'KEYCODE_F4', 'F5': 'KEYCODE_F5', 'F6': 'KEYCODE_F6',
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
    }
  }
}

module.exports = KeyboardHandler;
