/**
 * Log Manager
 * 日誌管理和分析
 */

const fs = require('fs');
const path = require('path');
const log = require('electron-log');

class LogManager {
  constructor() {
    this.logDir = null;
    this.maxLogSize = 10 * 1024 * 1024; // 10MB
    this.maxLogFiles = 5;
  }

  /**
   * 初始化日誌管理器
   */
  initialize() {
    const { app } = require('electron');
    this.logDir = path.join(app.getPath('userData'), 'logs');
    
    // 確保日誌目錄存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // 設定 electron-log
    log.transports.file.resolvePathFn = () => {
      return path.join(this.logDir, 'muremote.log');
    };
    
    log.transports.file.maxSize = this.maxLogSize;
    
    log.info('LogManager initialized:', this.logDir);
  }

  /**
   * 獲取日誌文件列表
   */
  getLogFiles() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.endsWith('.log'))
        .map(f => {
          const filePath = path.join(this.logDir, f);
          const stats = fs.statSync(filePath);
          return {
            name: f,
            path: filePath,
            size: stats.size,
            modified: stats.mtime
          };
        })
        .sort((a, b) => b.modified - a.modified);
      
      return files;
    } catch (e) {
      log.error('Failed to get log files:', e);
      return [];
    }
  }

  /**
   * 讀取日誌內容
   */
  readLog(fileName, lines = 100) {
    try {
      const filePath = path.join(this.logDir, fileName);
      
      if (!fs.existsSync(filePath)) {
        return null;
      }

      // 讀取最後 N 行
      const content = fs.readFileSync(filePath, 'utf8');
      const allLines = content.split('\n');
      const lastLines = allLines.slice(-lines);
      
      return lastLines.join('\n');
    } catch (e) {
      log.error('Failed to read log:', e);
      return null;
    }
  }

  /**
   * 讀取當前日誌
   */
  readCurrentLog(lines = 100) {
    return this.readLog('muremote.log', lines);
  }

  /**
   * 搜尋日誌
   */
  searchLog(pattern, fileName = 'muremote.log') {
    try {
      const content = this.readLog(fileName, 10000);
      if (!content) return [];

      const regex = new RegExp(pattern, 'gi');
      const matches = content.match(regex);
      
      return matches ? matches.length : 0;
    } catch (e) {
      log.error('Search failed:', e);
      return [];
    }
  }

  /**
   * 清理舊日誌
   */
  cleanOldLogs() {
    try {
      const files = this.getLogFiles();
      
      if (files.length <= this.maxLogFiles) {
        return { cleaned: 0 };
      }

      let cleaned = 0;
      const toDelete = files.slice(this.maxLogFiles);
      
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        cleaned++;
      }

      log.info(`Cleaned ${cleaned} old log files`);
      return { cleaned, remaining: files.length - cleaned };
    } catch (e) {
      log.error('Failed to clean logs:', e);
      return { cleaned: 0, error: e.message };
    }
  }

  /**
   * 導出日誌
   */
  exportLog(format = 'txt') {
    try {
      const files = this.getLogFiles();
      let exportContent = `MuRemote Log Export\n`;
      exportContent += `Export Time: ${new Date().toISOString()}\n`;
      exportContent += `================================\n\n`;

      for (const file of files) {
        exportContent += `[${file.name}]\n`;
        exportContent += this.readLog(file.name, 500) || '';
        exportContent += '\n\n';
      }

      const exportPath = path.join(
        this.logDir, 
        `muremote-export-${Date.now()}.${format}`
      );

      fs.writeFileSync(exportPath, exportContent);
      
      return { success: true, path: exportPath };
    } catch (e) {
      log.error('Export failed:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * 獲取日誌統計
   */
  getStats() {
    const files = this.getLogFiles();
    let totalSize = 0;
    
    for (const file of files) {
      totalSize += file.size;
    }

    return {
      fileCount: files.length,
      totalSize: totalSize,
      files: files.map(f => ({
        name: f.name,
        size: f.size,
        modified: f.modified
      }))
    };
  }
}

module.exports = LogManager;
