const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const log = require('electron-log/main');

const execAsync = promisify(exec);

class WebRTCBridge {
  constructor({ stunServers = [] } = {}) {
    this.stunServers = stunServers;
    this.sessions = new Map(); // clientId -> { ws, pc, source, track }

    this.scrcpyManager = null;
    this._onVideoData = null;

    this._wrtc = null;
    this._supported = this._tryLoadWrtc();

    this._ffmpegPath = null;
    this._ffmpegChecked = false;
    this._decoderProc = null;
    this._decoderStdout = Buffer.alloc(0);
    this._frameWidth = 0;
    this._frameHeight = 0;
    this._frameSize = 0;
  }

  _tryLoadWrtc() {
    try {
      // Optional dependency: if unavailable, caller should fallback to legacy mode.
      this._wrtc = require('wrtc');
      if (!this._wrtc?.nonstandard?.RTCVideoSource) {
        log.warn('[WebRTCBridge] wrtc loaded but RTCVideoSource is unavailable');
        return false;
      }
      log.info('[WebRTCBridge] wrtc loaded');
      return true;
    } catch (e) {
      log.warn('[WebRTCBridge] wrtc unavailable, fallback to WebSocket JPEG mode:', e.message);
      return false;
    }
  }

  isSupported() {
    return this._supported;
  }

  setScrcpyManager(manager) {
    if (this.scrcpyManager && this._onVideoData) {
      this.scrcpyManager.removeListener('video-data', this._onVideoData);
    }

    this.scrcpyManager = manager;
    this._onVideoData = (chunk) => {
      if (!this._decoderProc || !chunk || chunk.length === 0) return;
      try {
        this._decoderProc.stdin.write(chunk);
      } catch (_) {}
    };

    if (this.scrcpyManager) {
      this.scrcpyManager.on('video-data', this._onVideoData);
    }
  }

  async startSession(clientId, ws) {
    if (!this._supported || !this.scrcpyManager?.isRunning) {
      return false;
    }

    try {
      await this._ensureDecoderRunning();
      if (!this._decoderProc || this._frameSize <= 0) {
        return false;
      }

      const pc = new this._wrtc.RTCPeerConnection({
        iceServers: this.stunServers.map((urls) => ({ urls })),
      });

      const source = new this._wrtc.nonstandard.RTCVideoSource();
      const track = source.createTrack();
      pc.addTrack(track);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        this._send(ws, {
          type: 'webrtc-ice-candidate',
          candidate: event.candidate,
        });
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed' || st === 'disconnected') {
          this.stopSession(clientId);
        }
      };

      this.sessions.set(clientId, { ws, pc, source, track });

      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);
      this._send(ws, {
        type: 'webrtc-offer',
        sdp: pc.localDescription,
      });

      log.info(`[WebRTCBridge] WebRTC offer sent to client=${clientId}`);
      return true;
    } catch (e) {
      log.error('[WebRTCBridge] startSession failed:', e.message);
      this.stopSession(clientId);
      return false;
    }
  }

  async handleAnswer(clientId, sdp) {
    const s = this.sessions.get(clientId);
    if (!s || !sdp) return;
    try {
      await s.pc.setRemoteDescription(new this._wrtc.RTCSessionDescription(sdp));
    } catch (e) {
      log.warn(`[WebRTCBridge] setRemoteDescription(answer) failed client=${clientId}:`, e.message);
    }
  }

  async handleIceCandidate(clientId, candidate) {
    const s = this.sessions.get(clientId);
    if (!s || !candidate) return;
    try {
      await s.pc.addIceCandidate(new this._wrtc.RTCIceCandidate(candidate));
    } catch (e) {
      log.warn(`[WebRTCBridge] addIceCandidate failed client=${clientId}:`, e.message);
    }
  }

  stopSession(clientId) {
    const s = this.sessions.get(clientId);
    if (!s) return;
    try { s.track.stop(); } catch (_) {}
    try { s.pc.close(); } catch (_) {}
    this.sessions.delete(clientId);
    if (this.sessions.size === 0) {
      this._stopDecoder();
    }
  }

  stopAll() {
    for (const [clientId] of this.sessions) {
      this.stopSession(clientId);
    }

    if (this.scrcpyManager && this._onVideoData) {
      this.scrcpyManager.removeListener('video-data', this._onVideoData);
    }
    this.scrcpyManager = null;
    this._onVideoData = null;
    this._stopDecoder();
  }

  _send(ws, payload) {
    try {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
      }
    } catch (_) {}
  }

  async _ensureDecoderRunning() {
    if (this._decoderProc) return;

    if (!this.scrcpyManager?.videoWidth || !this.scrcpyManager?.videoHeight) {
      throw new Error('scrcpy video size is unavailable');
    }

    const ffmpegPath = await this._detectFfmpeg();
    if (!ffmpegPath) throw new Error('ffmpeg not found');

    this._frameWidth = this.scrcpyManager.videoWidth;
    this._frameHeight = this.scrcpyManager.videoHeight;
    this._frameSize = Math.floor(this._frameWidth * this._frameHeight * 1.5);

    this._decoderProc = spawn(ffmpegPath.replace(/^"|"$/g, ''), [
      '-loglevel', 'warning',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-f', 'h264',
      '-i', 'pipe:0',
      '-an',
      '-f', 'rawvideo',
      '-pix_fmt', 'yuv420p',
      'pipe:1',
    ]);

    this._decoderProc.stdout.on('data', (chunk) => {
      this._decoderStdout = Buffer.concat([this._decoderStdout, chunk]);
      this._drainRawFrames();
    });

    this._decoderProc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) log.warn('[webrtc ffmpeg]', msg);
    });

    this._decoderProc.on('exit', (code) => {
      if (this.sessions.size > 0) {
        log.warn('[WebRTCBridge] decoder exited unexpectedly code=', code);
      }
      this._decoderProc = null;
      this._decoderStdout = Buffer.alloc(0);
    });

    this._decoderProc.on('error', (err) => {
      log.error('[WebRTCBridge] decoder error:', err.message);
    });

    log.info(`[WebRTCBridge] decoder started ${this._frameWidth}x${this._frameHeight}`);
  }

  _drainRawFrames() {
    if (this._frameSize <= 0 || this.sessions.size === 0) return;

    while (this._decoderStdout.length >= this._frameSize) {
      const frame = this._decoderStdout.subarray(0, this._frameSize);
      this._decoderStdout = this._decoderStdout.subarray(this._frameSize);

      for (const [, s] of this.sessions) {
        try {
          s.source.onFrame({
            width: this._frameWidth,
            height: this._frameHeight,
            data: new Uint8ClampedArray(frame),
          });
        } catch (_) {}
      }
    }
  }

  _stopDecoder() {
    if (!this._decoderProc) return;
    try {
      this._decoderProc.stdin.end();
      this._decoderProc.kill();
    } catch (_) {}
    this._decoderProc = null;
    this._decoderStdout = Buffer.alloc(0);
  }

  async _detectFfmpeg() {
    if (this._ffmpegChecked) return this._ffmpegPath;

    this._ffmpegChecked = true;
    try {
      const bundled = require('ffmpeg-static');
      if (bundled) {
        this._ffmpegPath = bundled;
        return this._ffmpegPath;
      }
    } catch (_) {}

    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    try {
      const { stdout } = await execAsync(cmd, { windowsHide: true });
      this._ffmpegPath = stdout.trim().split('\n')[0].trim() || null;
    } catch (_) {
      this._ffmpegPath = null;
    }
    return this._ffmpegPath;
  }
}

module.exports = WebRTCBridge;
