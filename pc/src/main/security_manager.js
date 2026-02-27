/**
 * Security Manager
 * 安全相關功能
 */

const crypto = require('crypto');
const log = require('electron-log');

class SecurityManager {
  constructor() {
    this.encryptionKey = null;
    this.allowedClients = new Set();
  }

  /**
   * 初始化加密
   */
  initialize(secretKey) {
    // 使用用戶提供的密鑰或生成隨機密鑰
    this.encryptionKey = secretKey || crypto.randomBytes(32).toString('hex');
    log.info('Security manager initialized');
  }

  /**
   * 加密數據
   */
  encrypt(data) {
    try {
      const iv = crypto.randomBytes(16);
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return {
        iv: iv.toString('hex'),
        data: encrypted
      };
    } catch (e) {
      log.error('Encryption failed:', e);
      return null;
    }
  }

  /**
   * 解密數據
   */
  decrypt(encryptedData) {
    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      
      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (e) {
      log.error('Decryption failed:', e);
      return null;
    }
  }

  /**
   * 驗證客戶端
   */
  authenticate(clientId, token) {
    // 簡化的驗證邏輯
    // 實際實現應該連接認證伺服器
    return this.allowedClients.has(clientId);
  }

  /**
   * 添加允許的客戶端
   */
  allowClient(clientId) {
    this.allowedClients.add(clientId);
    log.info(`Client allowed: ${clientId}`);
  }

  /**
   * 移除允許的客戶端
   */
  disallowClient(clientId) {
    this.allowedClients.delete(clientId);
    log.info(`Client disallowed: ${clientId}`);
  }

  /**
   * 獲取允許的客戶端列表
   */
  getAllowedClients() {
    return Array.from(this.allowedClients);
  }

  /**
   * 生成安全令牌
   */
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * 哈希密碼
   */
  hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  }
}

module.exports = SecurityManager;
