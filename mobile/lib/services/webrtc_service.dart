import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

class WebRTCService extends ChangeNotifier {
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  MediaStream? _localStream;
  RTCVideoRenderer? _remoteRenderer;

  bool _isConnected = false;
  bool _isConnecting = false;
  int _latency = 0;
  int _fps = 30;
  String _resolution = '720p';
  String _pcId = '';

  bool get isConnected => _isConnected;
  bool get isConnecting => _isConnecting;
  int get latency => _latency;
  int get fps => _fps;
  String get resolution => _resolution;
  RTCVideoRenderer? get remoteRenderer => _remoteRenderer;

  WebRTCService();

  Future<void> connect(String pcId) async {
    if (_isConnected || _isConnecting) return;

    _isConnecting = true;
    _pcId = pcId;
    notifyListeners();

    try {
      // Initialize remote renderer
      _remoteRenderer = RTCVideoRenderer();
      await _remoteRenderer!.initialize();

      // Create peer connection
      await _createPeerConnection();

      // TODO: Signal with signaling server to connect to PC client
      // For POC, this is where we'd connect to the signaling server

      _isConnecting = false;
      notifyListeners();
    } catch (e) {
      debugPrint('Connection error: $e');
      _isConnecting = false;
      _isConnected = false;
      notifyListeners();
    }
  }

  Future<void> _createPeerConnection() async {
    final config = {
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
        {'urls': 'stun:stun1.l.google.com:19302'},
      ]
    };

    _peerConnection = await createPeerConnection(config);

    _peerConnection!.onIceCandidate = (candidate) {
      // TODO: Send ICE candidate to signaling server
    };

    _peerConnection!.onIceConnectionState = (state) {
      debugPrint('ICE Connection State: $state');
      if (state == IceConnectionState.connected) {
        _isConnected = true;
        notifyListeners();
      } else if (state == IceConnectionState.disconnected ||
          state == IceConnectionState.failed) {
        _isConnected = false;
        notifyListeners();
      }
    };

    _peerConnection!.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        _remoteRenderer?.srcObject = event.streams[0];
      }
    };

    // Create data channel for control commands
    _dataChannel = await _peerConnection!.createDataChannel(
      'control',
      RTCDataChannelInit()..ordered = true,
    );

    _dataChannel!.onMessage = (message) {
      // Handle incoming messages from PC
      _handleControlMessage(message.text);
    };
  }

  void _handleControlMessage(String message) {
    // Parse and handle control messages
    // e.g., stats updates, connection status
    if (message.startsWith('stats:')) {
      // Parse stats: latency=50fps=30
      final parts = message.substring(6).split('&');
      for (var part in parts) {
        final kv = part.split('=');
        if (kv.length == 2) {
          if (kv[0] == 'latency') {
            _latency = int.tryParse(kv[1]) ?? 0;
          } else if (kv[0] == 'fps') {
            _fps = int.tryParse(kv[1]) ?? 30;
          }
        }
      }
      notifyListeners();
    }
  }

  Future<void> disconnect() async {
    _dataChannel?.close();
    _peerConnection?.close();
    _remoteRenderer?.dispose();

    _isConnected = false;
    _isConnecting = false;
    _latency = 0;
    _pcId = '';

    notifyListeners();
  }

  // Send touch control to PC
  void sendTouchEvent(double x, double y, String action) {
    if (!_isConnected || _dataChannel == null) return;

    final message = 'touch:$action:x=$x:y=$y';
    _dataChannel!.send(RTCDataChannelMessage(message));
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}
