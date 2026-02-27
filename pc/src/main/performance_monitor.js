/**
 * Performance Monitor
 * 效能監控和優化
 */

const os = require('os');
const log = require('electron-log');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      cpu: [],
      memory: [],
      network: [],
      frameRate: [],
      latency: [],
    };
    this.maxHistory = 60; // 保留 60 筆資料
    this.monitorInterval = 1000; // 1秒採樣一次
    this.timer = null;
  }

  /**
   * 開始監控
   */
  start() {
    this.timer = setInterval(() => {
      this.collectMetrics();
    }, this.monitorInterval);
    
    log.info('Performance monitor started');
  }

  /**
   * 停止監控
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('Performance monitor stopped');
  }

  /**
   * 收集效能數據
   */
  collectMetrics() {
    // CPU 使用率
    const cpuUsage = this.getCpuUsage();
    this.metrics.cpu.push({
      time: Date.now(),
      value: cpuUsage
    });

    // 記憶體使用
    const memUsage = this.getMemoryUsage();
    this.metrics.memory.push({
      time: Date.now(),
      value: memUsage
    });

    // 限制歷史資料數量
    this.pruneMetrics();
  }

  /**
   * 獲取 CPU 使用率
   */
  getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - (100 * idle / total);

    return Math.round(usage);
  }

  /**
   * 獲取記憶體使用率
   */
  getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return Math.round((used / total) * 100);
  }

  /**
   * 記錄幀率
   */
  recordFrameRate(fps) {
    this.metrics.frameRate.push({
      time: Date.now(),
      value: fps
    });
    this.pruneMetrics();
  }

  /**
   * 記錄延遲
   */
  recordLatency(latency) {
    this.metrics.latency.push({
      time: Date.now(),
      value: latency
    });
    this.pruneMetrics();
  }

  /**
   * 修剪歷史資料
   */
  pruneMetrics() {
    for (const key in this.metrics) {
      if (this.metrics[key].length > this.maxHistory) {
        this.metrics[key] = this.metrics[key].slice(-this.maxHistory);
      }
    }
  }

  /**
   * 獲取當前效能狀態
   */
  getCurrentStatus() {
    const lastCpu = this.metrics.cpu[this.metrics.cpu.length - 1];
    const lastMem = this.metrics.memory[this.metrics.memory.length - 1];
    const lastFps = this.metrics.frameRate[this.metrics.frameRate.length - 1];
    const lastLatency = this.metrics.latency[this.metrics.latency.length - 1];

    return {
      cpu: lastCpu ? lastCpu.value : 0,
      memory: lastMem ? lastMem.value : 0,
      frameRate: lastFps ? lastFps.value : 0,
      latency: lastLatency ? lastLatency.value : 0,
    };
  }

  /**
   * 獲取平均效能數據
   */
  getAverages() {
    return {
      cpu: this.average(this.metrics.cpu),
      memory: this.average(this.metrics.memory),
      frameRate: this.average(this.metrics.frameRate),
      latency: this.average(this.metrics.latency),
    };
  }

  /**
   * 計算平均值
   */
  average(arr) {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((acc, m) => acc + m.value, 0);
    return Math.round(sum / arr.length);
  }

  /**
   * 獲取歷史數據
   */
  getHistory(type, duration = 60000) {
    const cutoff = Date.now() - duration;
    return this.metrics[type] ? 
      this.metrics[type].filter(m => m.time > cutoff) : [];
  }

  /**
   * 獲取所有指標
   */
  getAllMetrics() {
    return { ...this.metrics };
  }
}

module.exports = PerformanceMonitor;
