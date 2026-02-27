import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;

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
  int _fps = 30;
  String _resolution = '720p';
  String _pcId = '';
  int _screenWidth = 1080;
  int _screenHeight = 1920;

  // Server URL - 應該從設定中獲取
  String _serverUrl = 'ws://192.168.1.100:8080';

  bool get isConnected => _isConnected;
  bool get isConnecting => _isConnecting;
  bool get isStreaming => _isStreaming;
  int get latency => _latency;
  int get fps => _fps;
  String get resolution => _resolution;
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
    // 簡單的 JPEG 檢測
    if (data.length > 4 && data[0] == 0xFF && data[1] == 0xD8) {
      // 這是 JPEG 數據
      // 在實際應用中，這裡應該解碼並顯示
      // 目前先用占位符
    }
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
    notifyListeners();
  }

  /**
   * 發送觸控事件
   */
  void sendTouch(double x, double y, String action) {
    if (!_isConnected) return;

    // 座標已經是 0-1 範圍
    _ws?.add(jsonEncode({
      'type': 'touch',
      'action': action,
      'x': x,
      'y': y
    }));
  }

  /**
   * 點擊
   */
  void tap(double x, double y) {
    sendTouch(x, y, 'tap');
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
   * 斷開連接
   */
  Future<void> disconnect() async {
    await stopStreaming();
    
    _ws?.close();
    _ws = null;
    _isConnected = false;
    _isConnecting = false;
    _pcId = '';

    notifyListeners();
  }

  @override
  void dispose() {
    disconnect();
    _remoteRenderer?.dispose();
    super.dispose();
  }
}
