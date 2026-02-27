import 'dart:async';
import 'dart:convert';
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
  String _serverUrl = 'ws://192.168.1.100:8080';
  
  // 幀率設定
  int _setFps = 30;

  bool get isConnected => _isConnected;
  bool get isConnecting => _isConnecting;
  bool get isStreaming => _isStreaming;
  int get latency => _latency;
  int get fps => _setFps;
  String get resolution => _resolution;
  Uint8List? get currentFrame => _currentJpegData;
  int get screenWidth => _screenWidth;
  int get screenHeight => _screenHeight;
  String get quality => _quality;
  String get serverUrl => _serverUrl;

  StreamingService() {
    _initRenderer();
  }

  Future<void> _initRenderer() async {
    _remoteRenderer = RTCVideoRenderer();
    await _remoteRenderer!.initialize();
  }

  /**
   * 連線到 PC Client
   */
  Future<void> connect(String pcId, {String? serverUrl}) async {
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
          _isConnected = false;
          _isConnecting = false;
          notifyListeners();
        },
        onDone: () {
          debugPrint('WebSocket closed');
          _isConnected = false;
          _isStreaming = false;
          notifyListeners();
        },
      );

      // 等待歡迎消息
      await Future.delayed(const Duration(milliseconds: 500));

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
        
        switch (data['type']) {
          case 'welcome':
            debugPrint('Welcome: ${data}');
            break;
          case 'stats':
            _latency = data['latency'] ?? 0;
            _fps = data['fps'] ?? 30;
            _resolution = data['resolution'] ?? '720p';
            notifyListeners();
            break;
          case 'screen-size':
            _screenWidth = data['width'] ?? 1080;
            _screenHeight = data['height'] ?? 1920;
            notifyListeners();
            break;
          case 'error':
            debugPrint('Server error: ${data['message']}');
            break;
        }
      } catch (e) {
        debugPrint('JSON parse error: $e');
      }
    } else if (message is List<int>) {
      // 二進制消息 - 影片幀
      _handleVideoFrame(Uint8List.fromList(message));
    }
  }

  /**
   * 處理影片幀
   */
  void _handleVideoFrame(Uint8List data) {
    // 檢查幀類型
    if (data.isEmpty) return;
    
    final frameType = data[0];
    
    if (frameType == 0x01) {
      // JPEG 影片幀
      final jpegData = data.sublist(1);
      _displayJpegFrame(jpegData);
    } else if (frameType == 0x02) {
      // 截圖幀
      final jpegData = data.sublist(1);
      _displayJpegFrame(jpegData);
      // 觸發截圖回調
      _handleScreenshot(jpegData);
    } else if (data.length > 4) {
      // 可能是長度前綴的幀
      // 嘗試解析長度
      try {
        final length = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
        if (data.length >= length + 4) {
          final frameData = data.sublist(4, 4 + length);
          _displayJpegFrame(frameData);
        }
      } catch (e) {
        // 嘗試作為原始 JPEG 處理
        _displayJpegFrame(data);
      }
    }
  }

  /**
   * 顯示 JPEG 幀
   */
  void _displayJpegFrame(Uint8List jpegData) {
    // 簡單檢查 JPEG 魔數
    if (jpegData.length < 2 || jpegData[0] != 0xFF || jpegData[1] != 0xD8) {
      // 嘗試尋找 JPEG 開始標記
      for (int i = 0; i < jpegData.length - 1; i++) {
        if (jpegData[i] == 0xFF && jpegData[i+1] == 0xD8) {
          jpegData = jpegData.sublist(i);
          break;
        }
      }
    }
    
    _currentJpegData = jpegData;
    notifyListeners();
  }

  /**
   * 開始串流
   */
  Future<void> startStreaming() async {
    if (!_isConnected || _isStreaming) return;

    _ws?.add(jsonEncode({
      'type': 'start-stream'
    }));

    _isStreaming = true;
    notifyListeners();

    // 請求螢幕大小
    _ws?.add(jsonEncode({
      'type': 'get-screen-size'
    }));
  }

  /**
   * 停止串流
   */
  Future<void> stopStreaming() async {
    if (!_isStreaming) return;

    _ws?.add(jsonEncode({
      'type': 'stop-stream'
    }));

    _isStreaming = false;
    _currentJpegData = null;
    notifyListeners();
  }

  /**
   * 發送觸控事件
   * @param x, y 歸一化座標 (0-1)
   * @param action 動作: tap, down, move, up
   */
  void sendTouch(double x, double y, String action) {
    if (!_isConnected) return;

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
  void swipe(double startX, double startY, double endX, double endY, {int duration = 300}) {
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

    _ws?.add(jsonEncode({
      'type': 'key',
      'key': key
    }));
  }

  /**
   * 發送文字
   */
  void sendText(String text) {
    if (!_isConnected) return;

    _ws?.add(jsonEncode({
      'type': 'text',
      'text': text
    }));
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
    
    _ws?.add(jsonEncode({
      'type': 'screenshot'
    }));

    // 5秒超時
    return _screenshotCompleter!.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () {
        _screenshotCompleter = null;
        return null;
      }
    );
  }

  /**
   * 設定畫質
   * @param quality - '480p' | '720p' | '1080p'
   */
  Future<void> setQuality(String quality) async {
    if (!_isConnected) return;
    
    _quality = quality;
    _ws?.add(jsonEncode({
      'type': 'set-quality',
      'quality': quality
    }));
    
    notifyListeners();
    log.info('Quality changed to: $quality');
  }

  /**
   * 設定幀率
   * @param fps - 24 | 30 | 60
   */
  Future<void> setFps(int fps) async {
    if (!_isConnected) return;
    
    _setFps = fps;
    _ws?.add(jsonEncode({
      'type': 'set-fps',
      'fps': fps
    }));
    
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
    log.info('Server URL set to: $_serverUrl');
  }

  /**
   * 斷開連接
   */
  Future<void> disconnect() async {
    await stopStreaming();
    
    _ws?.close();
    _ws = null;
    _isConnected = false;
    _isConnecting = false;
    _pcId = '';
    _currentJpegData = null;

    notifyListeners();
  }

  @override
  void dispose() {
    disconnect();
    _remoteRenderer?.dispose();
    super.dispose();
  }
}
