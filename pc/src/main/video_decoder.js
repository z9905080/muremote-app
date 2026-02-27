/**
 * Video Decoder Module
 * 負責解碼視訊串流並轉換為圖片
 */

const log = require('electron-log');

class VideoDecoder {
  constructor() {
    this.isDecoding = false;
    this.frameBuffer = [];
    this.maxBufferSize = 3;
    this.onFrame = null;
  }

  /**
   * 設置幀回調
   */
  setFrameCallback(callback) {
    this.onFrame = callback;
  }

  /**
   * 解碼 JPEG 幀
   */
  decodeJpegFrame(jpegData) {
    try {
      // JPEG 解碼需要使用 external decoder
      // 這裡返回原始數據，實際解碼在客戶端進行
      return jpegData;
    } catch (e) {
      log.error('JPEG decode error:', e);
      return null;
    }
  }

  /**
   * 解碼 H.264 幀
   */
  decodeH264Frame(frameData) {
    // H.264 解碼需要 libavcodec
    // 這是一個佔位實現
    log.warn('H.264 decoding not implemented in Node.js');
    return null;
  }

  /**
   * 處理接收到的數據
   */
  processData(data) {
    // 檢測數據類型
    if (this.isJpeg(data)) {
      return this.decodeJpegFrame(data);
    } else if (this.isH264(data)) {
      return this.decodeH264Frame(data);
    }
    
    return null;
  }

  /**
   * 檢測是否為 JPEG
   */
  isJpeg(data) {
    if (!data || data.length < 2) return false;
    // JPEG 以 FF D8 開始
    return data[0] === 0xFF && data[1] === 0xD8;
  }

  /**
   * 檢測是否為 H.264
   */
  isH264(data) {
    if (!data || data.length < 4) return false;
    // H.264 NAL 單元
    const header = data.slice(0, 4).toString('hex');
    return header.startsWith('00000001') || header.startsWith('000001');
  }

  /**
   * 提取 JPEG 幀
   */
  extractJpegFrames(data) {
    const frames = [];
    let start = 0;
    
    for (let i = 0; i < data.length - 1; i++) {
      // 尋找 JPEG 開始標記
      if (data[i] === 0xFF && data[i + 1] === 0xD8) {
        start = i;
      }
      // 尋找 JPEG 結束標記
      if (data[i] === 0xFF && data[i + 1] === 0xD9) {
        const frame = data.slice(start, i + 2);
        frames.push(frame);
        start = i + 2;
      }
    }
    
    return frames;
  }

  /**
   * 開始解碼
   */
  start() {
    this.isDecoding = true;
    log.info('Video decoder started');
  }

  /**
   * 停止解碼
   */
  stop() {
    this.isDecoding = false;
    this.frameBuffer = [];
    log.info('Video decoder stopped');
  }
}

module.exports = VideoDecoder;
