/**
 * Network Quality Analyzer
 * 網路品質分析和優化建議
 */

const log = require('electron-log');

class NetworkQualityAnalyzer {
  constructor() {
    this.samples = [];
    this.maxSamples = 30;
    this.pingInterval = 2000; // 2秒 ping 一次
    this.timer = null;
  }

  /**
   * 開始網路品質監控
   */
  start() {
    this.timer = setInterval(() => {
      this.measureQuality();
    }, this.pingInterval);
    
    log.info('Network quality analyzer started');
  }

  /**
   * 停止監控
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('Network quality analyzer stopped');
  }

  /**
   * 測量網路品質
   */
  async measureQuality() {
    const start = Date.now();
    
    try {
      // 簡化的網路測量
      // 實際實現應該發送 ICMP ping 或 HTTP 請求
      const latency = Math.floor(Math.random() * 50) + 20; // 模擬值
      
      const sample = {
        time: Date.now(),
        latency: latency,
        jitter: Math.random() * 10,
        packetLoss: Math.random() < 0.02 ? 1 : 0, // 2% 丟包率
      };

      this.samples.push(sample);
      
      // 修剪舊樣本
      if (this.samples.length > this.maxSamples) {
        this.samples = this.samples.slice(-this.maxSamples);
      }

      return sample;
    } catch (e) {
      log.error('Quality measurement failed:', e);
      return null;
    }
  }

  /**
   * 獲取當前網路品質
   */
  getCurrentQuality() {
    if (this.samples.length === 0) {
      return { quality: 'unknown', latency: 0, jitter: 0, packetLoss: 0 };
    }

    const last = this.samples[this.samples.length - 1];
    return {
      latency: last.latency,
      jitter: last.jitter,
      packetLoss: last.packetLoss,
      quality: this.assessQuality(last.latency, last.jitter, last.packetLoss),
    };
  }

  /**
   * 評估網路品質
   */
  assessQuality(latency, jitter, packetLoss) {
    let score = 100;

    // 延遲扣分
    if (latency > 300) score -= 50;
    else if (latency > 150) score -= 30;
    else if (latency > 100) score -= 15;
    else if (latency > 50) score -= 5;

    // 抖動扣分
    if (jitter > 50) score -= 30;
    else if (jitter > 30) score -= 20;
    else if (jitter > 15) score -= 10;

    // 丟包扣分
    score -= packetLoss * 30;

    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'fair';
    if (score >= 20) return 'poor';
    return 'bad';
  }

  /**
   * 獲取平均品質
   */
  getAverageQuality() {
    if (this.samples.length === 0) {
      return { latency: 0, jitter: 0, packetLoss: 0 };
    }

    const avgLatency = this.samples.reduce((s, m) => s + m.latency, 0) / this.samples.length;
    const avgJitter = this.samples.reduce((s, m) => s + m.jitter, 0) / this.samples.length;
    const avgPacketLoss = this.samples.reduce((s, m) => s + m.packetLoss, 0) / this.samples.length;

    return {
      latency: Math.round(avgLatency),
      jitter: Math.round(avgJitter * 10) / 10,
      packetLoss: Math.round(avgPacketLoss * 100),
      quality: this.assessQuality(avgLatency, avgJitter, avgPacketLoss),
    };
  }

  /**
   * 獲取優化建議
   */
  getOptimizationSuggestions() {
    const quality = this.getCurrentQuality();
    const suggestions = [];

    if (quality.latency > 150) {
      suggestions.push('延遲過高，建議切換到更穩定的網路');
    }

    if (quality.jitter > 30) {
      suggestions.push('網路不穩定，建議使用有線網路');
    }

    if (quality.packetLoss > 5) {
      suggestions.push('存在丟包，建議檢查網路連線');
    }

    if (quality.latency > 100 && quality.quality !== 'excellent') {
      suggestions.push('建議降低串流畫質以改善體驗');
    }

    if (suggestions.length === 0) {
      suggestions.push('網路狀態良好');
    }

    return suggestions;
  }
}

module.exports = NetworkQualityAnalyzer;
