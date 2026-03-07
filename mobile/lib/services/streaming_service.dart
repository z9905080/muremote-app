import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;

// 簡易日誌函數
void log(String message) {
  debugPrint('[StreamingService] $message');
}

class StreamingService extends ChangeNotifier {
  WebSocket? _ws;
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  RTCVideoRenderer? _remoteRenderer;
  MediaStream? _remoteStream;

  bool _isConnected = false;
  bool _isConnecting = false;
  bool _isStreaming = false;
  bool _isWebRtcStreaming = false;
  String _streamMode = 'unknown';
  String _streamModeReason = '';
  int _latency = 0;
  int _fps = 0;
  String _resolution = '720p';
  String _quality = '720p';
  String _pcId = '';
  int _screenWidth = 1080;
  int _screenHeight = 1920;

  // 影片幀緩衝
  ui.Image? _currentFrame;
  final List<Uint8List> _frameBuffer = [];
  bool _isDecoding = false;

  // 當前幀圖片 (用於顯示)
  Uint8List? _currentJpegData;

  // Server URL - 應該從設定中獲取
  String _serverUrl = 'ws://192.168.1.100:12000';

  // 幀率設定
  int _setFps = 30;

  // 延遲量測
  Timer? _pingTimer;

  // 重連機制
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 5;
  static const int _reconnectDelaySeconds = 3;

  bool get isConnected => _isConnected;
  bool get isConnecting => _isConnecting;
  bool get isStreaming => _isStreaming;
  int get latency => _latency;
  int get fps => _setFps;
  int get serverFps => _fps;
  String get resolution => _resolution;
  Uint8List? get currentFrame => _currentJpegData;
  int get screenWidth => _screenWidth;
  int get screenHeight => _screenHeight;
  String get quality => _quality;
  String get serverUrl => _serverUrl;
  bool get isWebRtcStreaming => _isWebRtcStreaming;
  String get streamMode => _streamMode;
  String get streamModeReason => _streamModeReason;
  RTCVideoRenderer? get remoteRenderer => _remoteRenderer;

  StreamingService() {
    _initRenderer();
  }

  Future<void> _initRenderer() async {
    _remoteRenderer = RTCVideoRenderer();
    await _remoteRenderer!.initialize();
  }

  /**
   * 連線到 PC Client
   * @param pcId - 電腦 ID
   * @param serverUrl - WebSocket 伺服器 URL (可選)
   * @param metadata - 連線元數據，包含模擬器類型等 (可選)
   */
  Future<void> connect(String pcId,
      {String? serverUrl, Map<String, dynamic>? metadata}) async {
    if (_isConnected || _isConnecting) return;

    _isConnecting = true;
    _pcId = pcId;
    if (serverUrl != null) _serverUrl = serverUrl;
    notifyListeners();

    try {
      // 連接 WebSocket
      _ws = await WebSocket.connect(_serverUrl);

      _ws!.listen(
        (message) => _handleMessage(message),
        onError: (error) {
          debugPrint('WebSocket error: $error');
          _disposePeerConnection();
          _isConnected = false;
          _isConnecting = false;
          notifyListeners();
          _scheduleReconnect();
        },
        onDone: () {
          debugPrint('WebSocket closed');
          _disposePeerConnection();
          _isConnected = false;
          _isStreaming = false;
          _isWebRtcStreaming = false;
          notifyListeners();
          _scheduleReconnect();
        },
      );

      // 等待歡迎消息
      await Future.delayed(const Duration(milliseconds: 500));

      // 發送連線請求，包含元數據（如模擬器類型）
      _ws?.add(jsonEncode({
        'type': 'connect',
        'pcId': pcId,
        if (metadata != null) 'metadata': metadata,
      }));

      _isConnected = true;
      _isConnecting = false;
      notifyListeners();

      debugPrint('Connected to PC: $pcId');
    } catch (e) {
      debugPrint('Connection error: $e');
      _isConnecting = false;
      _isConnected = false;
      notifyListeners();
    }
  }

  /**
   * 處理 WebSocket 消息
   */
  void _handleMessage(dynamic message) {
    if (message is String) {
      try {
        final data = jsonDecode(message);
        debugPrint('[StreamingService] 收到文字訊息 type=${data['type']} data=$data');

        switch (data['type']) {
          case 'welcome':
            debugPrint('[StreamingService] 歡迎訊息：pcId=${data['pcId']}');
            break;
          case 'connected':
            debugPrint(
                '[StreamingService] 連線確認：emulatorType=${data['emulatorType']} screenSize=${data['screenSize']}');
            final size = data['screenSize'];
            if (size != null) {
              _screenWidth = (size['width'] as num?)?.toInt() ?? _screenWidth;
              _screenHeight =
                  (size['height'] as num?)?.toInt() ?? _screenHeight;
              debugPrint(
                  '[StreamingService] 螢幕大小已更新：${_screenWidth}x$_screenHeight');
              notifyListeners();
            }
            break;
          case 'pong':
            final ts = data['timestamp'] as int?;
            if (ts != null) {
              _latency =
                  ((DateTime.now().millisecondsSinceEpoch - ts) / 2).round();
              notifyListeners();
            }
            break;
          case 'stats':
            _fps = (data['fps'] as num?)?.toInt() ?? _fps;
            _resolution = data['resolution'] ?? _resolution;
            notifyListeners();
            break;
          case 'stream-mode':
            _streamMode = (data['mode'] ?? 'unknown').toString();
            _streamModeReason = (data['reason'] ?? '').toString();
            _isWebRtcStreaming = _streamMode == 'webrtc';
            debugPrint(
                '[StreamingService] stream mode=$_streamMode reason=$_streamModeReason');
            notifyListeners();
            break;
          case 'webrtc-offer':
            _handleWebRtcOffer(data['sdp']);
            break;
          case 'webrtc-ice-candidate':
            _handleWebRtcIceCandidate(data['candidate']);
            break;
          case 'screen-size':
            _screenWidth = data['width'] ?? 1080;
            _screenHeight = data['height'] ?? 1920;
            debugPrint(
                '[StreamingService] screen-size 更新：${_screenWidth}x$_screenHeight');
            notifyListeners();
            break;
          case 'error':
            debugPrint('[StreamingService] ❌ Server 錯誤：${data['message']}');
            break;
          default:
            debugPrint('[StreamingService] ⚠️ 未處理的訊息類型：${data['type']}');
        }
      } catch (e) {
        debugPrint('[StreamingService] ❌ JSON 解析失敗：$e  raw=$message');
      }
    } else if (message is List<int>) {
      // 二進制消息 - 影片幀
      debugPrint('[StreamingService] 收到 binary 幀，長度=${message.length}');
      _handleVideoFrame(Uint8List.fromList(message));
    } else {
      debugPrint('[StreamingService] ⚠️ 未知訊息類型：${message.runtimeType}');
    }
  }

  /**
   * 處理影片幀
   */
  void _handleVideoFrame(Uint8List data) {
    if (data.isEmpty) {
      debugPrint('[StreamingService] ⚠️ 收到空的 binary 幀');
      return;
    }

    final frameType = data[0];
    debugPrint(
        '[StreamingService] 幀類型=0x${frameType.toRadixString(16).padLeft(2, '0')} 長度=${data.length}');

    if (frameType == 0x01) {
      final jpegData = data.sublist(1);
      _displayJpegFrame(jpegData);
    } else if (frameType == 0x02) {
      final jpegData = data.sublist(1);
      _displayJpegFrame(jpegData);
      _handleScreenshot(jpegData);
    } else if (data.length > 4) {
      debugPrint(
          '[StreamingService] ⚠️ 未知幀類型 0x${frameType.toRadixString(16)}，嘗試長度前綴解析');
      try {
        final length =
            (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
        debugPrint(
            '[StreamingService] 長度前綴解析：宣告長度=$length 實際長度=${data.length}');
        if (data.length >= length + 4) {
          _displayJpegFrame(data.sublist(4, 4 + length));
        } else {
          debugPrint('[StreamingService] ❌ 長度前綴不符，改用原始資料');
          _displayJpegFrame(data);
        }
      } catch (e) {
        debugPrint('[StreamingService] ❌ 長度前綴解析失敗：$e');
        _displayJpegFrame(data);
      }
    } else {
      debugPrint(
          '[StreamingService] ❌ 無法識別的幀格式，首4bytes=${data.take(4).map((b) => '0x${b.toRadixString(16).padLeft(2, '0')}').join(' ')}');
    }
  }

  /**
   * 顯示影像幀 (支援 JPEG / PNG)
   */
  void _displayJpegFrame(Uint8List frameData) {
    if (frameData.length < 4) {
      debugPrint('[StreamingService] ❌ 幀資料過短：${frameData.length} bytes');
      return;
    }

    final isJpeg = frameData[0] == 0xFF && frameData[1] == 0xD8;
    final isPng = frameData[0] == 0x89 && frameData[1] == 0x50;

    if (!isJpeg && !isPng) {
      debugPrint(
          '[StreamingService] ⚠️ 幀不是 JPEG/PNG，首2bytes=0x${frameData[0].toRadixString(16)} 0x${frameData[1].toRadixString(16)}，嘗試搜尋 JPEG 標記');
      bool found = false;
      for (int i = 0; i < frameData.length - 1; i++) {
        if (frameData[i] == 0xFF && frameData[i + 1] == 0xD8) {
          frameData = frameData.sublist(i);
          debugPrint('[StreamingService] 在 offset=$i 找到 JPEG 標記');
          found = true;
          break;
        }
      }
      if (!found) {
        debugPrint('[StreamingService] ❌ 找不到 JPEG 標記，丟棄此幀');
        return;
      }
    }

    debugPrint(
        '[StreamingService] ✅ 顯示幀 ${isJpeg ? 'JPEG' : isPng ? 'PNG' : 'JPEG(搜尋)'} ${frameData.length} bytes');
    _currentJpegData = frameData;
    // 從 JPEG header 讀取實際解析度（用於自動旋轉）
    final dims = _readJpegDimensions(frameData);
    if (dims != null) {
      _frameWidth = dims[0];
      _frameHeight = dims[1];
    }
    notifyListeners();
  }

  int _frameWidth = 0;
  int _frameHeight = 0;
  int get frameWidth => _frameWidth;
  int get frameHeight => _frameHeight;

  /// 從 JPEG SOF marker 讀取實際寬高
  List<int>? _readJpegDimensions(Uint8List data) {
    for (int i = 0; i < data.length - 8; i++) {
      if (data[i] == 0xFF &&
          (data[i + 1] == 0xC0 || data[i + 1] == 0xC1 || data[i + 1] == 0xC2)) {
        final h = (data[i + 5] << 8) | data[i + 6];
        final w = (data[i + 7] << 8) | data[i + 8];
        if (w > 0 && h > 0) return [w, h];
      }
    }
    return null;
  }

  /**
   * 開始串流
   */
  Future<void> startStreaming() async {
    debugPrint(
        '[StreamingService] startStreaming() called, isConnected=$_isConnected, isStreaming=$_isStreaming');
    if (!_isConnected || _isStreaming) return;

    debugPrint('[StreamingService] 送出 start-stream');
    _ws?.add(jsonEncode({'type': 'start-stream'}));

    _isStreaming = true;
    _isWebRtcStreaming = false;
    _streamMode = 'starting';
    _streamModeReason = '';
    notifyListeners();

    // 請求螢幕大小
    _ws?.add(jsonEncode({'type': 'get-screen-size'}));

    // 啟動 ping 計時器，每 2 秒量測一次延遲
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (_isConnected) {
        _ws?.add(jsonEncode({
          'type': 'ping',
          'timestamp': DateTime.now().millisecondsSinceEpoch,
        }));
      }
    });
  }

  /**
   * 停止串流
   */
  Future<void> stopStreaming() async {
    if (!_isStreaming) return;

    _pingTimer?.cancel();
    _pingTimer = null;

    _ws?.add(jsonEncode({'type': 'stop-stream'}));
    await _disposePeerConnection();

    _isStreaming = false;
    _isWebRtcStreaming = false;
    _streamMode = 'stopped';
    _streamModeReason = '';
    _currentJpegData = null;
    _latency = 0;
    notifyListeners();
  }

  /**
   * 發送觸控事件
   * @param x, y 歸一化座標 (0-1)
   * @param action 動作: tap, down, move, up
   */
  void sendTouch(double x, double y, String action) {
    if (!_isConnected) {
      debugPrint(
          '[StreamingService] sendTouch SKIPPED (not connected) action=$action x=$x y=$y');
      return;
    }

    debugPrint(
        '[StreamingService] sendTouch action=$action x=${x.toStringAsFixed(3)} y=${y.toStringAsFixed(3)}');
    // 座標已經是 0-1 範圍
    _ws?.add(jsonEncode({
      'type': 'touch',
      'action': action,
      'x': x,
      'y': y,
      'timestamp': DateTime.now().millisecondsSinceEpoch
    }));
  }

  /**
   * 點擊
   */
  void tap(double x, double y) {
    sendTouch(x, y, 'tap');
  }

  /**
   * 按下
   */
  void touchDown(double x, double y) {
    sendTouch(x, y, 'down');
  }

  /**
   * 移動
   */
  void touchMove(double x, double y) {
    sendTouch(x, y, 'move');
  }

  /**
   * 鬆開
   */
  void touchUp(double x, double y) {
    sendTouch(x, y, 'up');
  }

  /**
   * 滑動
   */
  void swipe(double startX, double startY, double endX, double endY,
      {int duration = 300}) {
    if (!_isConnected) return;

    _ws?.add(jsonEncode({
      'type': 'touch',
      'action': 'swipe',
      'x': startX,
      'y': startY,
      'endX': endX,
      'endY': endY,
      'duration': duration
    }));
  }

  /**
   * 發送鍵盤事件
   */
  void sendKey(String key) {
    if (!_isConnected) return;

    _ws?.add(jsonEncode({'type': 'key', 'key': key}));
  }

  /**
   * 發送文字
   */
  void sendText(String text) {
    if (!_isConnected) return;

    _ws?.add(jsonEncode({'type': 'text', 'text': text}));
  }

  /**
   * 處理截圖回調
   */
  Uint8List? _lastScreenshot;

  void _handleScreenshot(Uint8List jpegData) {
    _lastScreenshot = jpegData;
    _screenshotCompleter?.complete(jpegData);
    _screenshotCompleter = null;
  }

  Completer<Uint8List?>? _screenshotCompleter;

  /**
   * 請求截圖
   */
  Future<Uint8List?> requestScreenshot() async {
    if (!_isConnected) return null;

    _screenshotCompleter = Completer<Uint8List?>();

    _ws?.add(jsonEncode({'type': 'screenshot'}));

    // 5秒超時
    return _screenshotCompleter!.future.timeout(const Duration(seconds: 5),
        onTimeout: () {
      _screenshotCompleter = null;
      return null;
    });
  }

  /**
   * 設定畫質
   * @param quality - '480p' | '720p' | '1080p' | '4K'
   */
  Future<void> setQuality(String quality) async {
    if (!_isConnected) return;

    _quality = quality;
    _ws?.add(jsonEncode({'type': 'set-quality', 'quality': quality}));

    notifyListeners();
    log('Quality changed to: $quality');
  }

  /**
   * 設定幀率
   * @param fps - 24 | 30 | 60
   */
  Future<void> setFps(int fps) async {
    if (!_isConnected) return;

    _setFps = fps;
    _ws?.add(jsonEncode({'type': 'set-fps', 'fps': fps}));

    notifyListeners();
  }

  /**
   * 設定伺服器位址
   * @param url - WebSocket 伺服器位址 (例如: ws://192.168.1.100:8080)
   */
  void setServerUrl(String url) {
    if (url.isEmpty) return;

    // 確保 URL 格式正確
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = 'ws://$url';
    }

    _serverUrl = url;
    notifyListeners();
    log('Server URL set to: $_serverUrl');
  }

  /**
   * 斷開連接
   */
  Future<void> disconnect() async {
    _cancelReconnect();
    _pingTimer?.cancel();
    _pingTimer = null;
    await stopStreaming();

    _ws?.close();
    _ws = null;
    await _disposePeerConnection();
    _isConnected = false;
    _isConnecting = false;
    _streamMode = 'disconnected';
    _streamModeReason = '';
    _pcId = '';
    _currentJpegData = null;

    notifyListeners();
  }

  /**
   * 排程重連
   */
  void _scheduleReconnect() {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      log('Max reconnection attempts reached');
      return;
    }

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(
      Duration(seconds: _reconnectDelaySeconds * (_reconnectAttempts + 1)),
      () {
        _reconnectAttempts++;
        log('Reconnecting... attempt $_reconnectAttempts/$_maxReconnectAttempts');
        if (_pcId.isNotEmpty) {
          connect(_pcId, serverUrl: _serverUrl).then((_) {
            // 重連成功後重新開始串流
            if (_isConnected && !_isStreaming) {
              startStreaming();
            }
          });
        }
      },
    );
  }

  /**
   * 取消重連
   */
  void _cancelReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconnectAttempts = 0;
  }

  /**
   * 發送多點觸控事件
   * @param pointers - 觸控點列表 [{pointerId, x, y}]
   * @param action - 動作: pointer-down, pointer-move, pointer-up, pinch, rotate
   */
  void sendMultiTouch(List<Map<String, dynamic>> pointers, String action) {
    if (!_isConnected) return;

    _ws?.add(jsonEncode({
      'type': 'multi-touch',
      'action': action,
      'pointers': pointers,
      'timestamp': DateTime.now().millisecondsSinceEpoch
    }));
  }

  /**
   * 發送縮放手勢
   */
  void sendPinch(List<Map<String, dynamic>> pointers) {
    sendMultiTouch(pointers, 'pinch');
  }

  @override
  void dispose() {
    disconnect();
    _remoteRenderer?.dispose();
    super.dispose();
  }

  Future<void> _handleWebRtcOffer(dynamic sdp) async {
    try {
      final pc = await _ensurePeerConnection();
      final remoteSdp = _parseSessionDescription(sdp);
      if (remoteSdp == null) {
        debugPrint('[StreamingService] ❌ invalid webrtc offer payload');
        return;
      }

      await pc.setRemoteDescription(remoteSdp);
      final answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      _ws?.add(jsonEncode({
        'type': 'webrtc-answer',
        'sdp': answer.toMap(),
      }));
      debugPrint('[StreamingService] ✅ webrtc answer sent');
    } catch (e) {
      debugPrint('[StreamingService] ❌ handle webrtc offer failed: $e');
    }
  }

  Future<void> _handleWebRtcIceCandidate(dynamic candidate) async {
    try {
      if (_peerConnection == null || candidate == null) return;
      final c = _parseIceCandidate(candidate);
      if (c == null) return;
      await _peerConnection!.addCandidate(c);
    } catch (e) {
      debugPrint('[StreamingService] ⚠️ add remote ICE candidate failed: $e');
    }
  }

  Future<RTCPeerConnection> _ensurePeerConnection() async {
    if (_peerConnection != null) return _peerConnection!;

    _peerConnection = await createPeerConnection({
      'sdpSemantics': 'unified-plan',
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
        {'urls': 'stun:stun1.l.google.com:19302'},
      ],
    });

    _peerConnection!.onIceCandidate = (RTCIceCandidate candidate) {
      _ws?.add(jsonEncode({
        'type': 'webrtc-ice-candidate',
        'candidate': candidate.toMap(),
      }));
    };

    _peerConnection!.onTrack = (RTCTrackEvent event) {
      if (event.streams.isNotEmpty) {
        _remoteRenderer?.srcObject = event.streams.first;
        _isWebRtcStreaming = true;
        notifyListeners();
      } else if (event.track != null) {
        createLocalMediaStream('remote').then((stream) {
          stream.addTrack(event.track);
          _remoteRenderer?.srcObject = stream;
          _isWebRtcStreaming = true;
          notifyListeners();
        });
      }
    };

    _peerConnection!.onIceConnectionState = (RTCIceConnectionState state) {
      if (state == RTCIceConnectionState.RTCIceConnectionStateConnected ||
          state == RTCIceConnectionState.RTCIceConnectionStateCompleted) {
        _isWebRtcStreaming = true;
      } else if (state ==
              RTCIceConnectionState.RTCIceConnectionStateDisconnected ||
          state == RTCIceConnectionState.RTCIceConnectionStateClosed ||
          state == RTCIceConnectionState.RTCIceConnectionStateFailed) {
        _isWebRtcStreaming = false;
      }
      notifyListeners();
    };

    return _peerConnection!;
  }

  RTCSessionDescription? _parseSessionDescription(dynamic raw) {
    if (raw is RTCSessionDescription) return raw;
    if (raw is Map) {
      final sdp = raw['sdp']?.toString();
      final t = raw['type']?.toString();
      if (sdp != null && t != null) {
        return RTCSessionDescription(sdp, t);
      }
    }
    return null;
  }

  RTCIceCandidate? _parseIceCandidate(dynamic raw) {
    if (raw is RTCIceCandidate) return raw;
    if (raw is Map) {
      final candidate = raw['candidate']?.toString();
      if (candidate == null || candidate.isEmpty) return null;
      final sdpMid = raw['sdpMid']?.toString();
      final sdpMLineIndex = (raw['sdpMLineIndex'] as num?)?.toInt();
      return RTCIceCandidate(candidate, sdpMid, sdpMLineIndex);
    }
    return null;
  }

  Future<void> _disposePeerConnection() async {
    try {
      await _peerConnection?.close();
    } catch (_) {}
    _peerConnection = null;
    _remoteRenderer?.srcObject = null;
    _isWebRtcStreaming = false;
  }
}
