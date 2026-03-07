import 'dart:math' show sqrt, min;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:provider/provider.dart';
import '../services/streaming_service.dart';

const double _kEdgeStripWidth = 52.0;
const double _kPanelWidth = 240.0;

class StreamingScreen extends StatefulWidget {
  const StreamingScreen({super.key});

  @override
  State<StreamingScreen> createState() => _StreamingScreenState();
}

class _StreamingScreenState extends State<StreamingScreen>
    with SingleTickerProviderStateMixin {
  // Panel
  bool _isPanelOpen = false;
  late AnimationController _panelController;
  late Animation<Offset> _panelAnimation;

  // Orientation tracking
  bool? _lastIsLandscape;

  // Touch tracking (Listener-based, no gesture arena)
  final Map<int, Offset> _activePointers = {};
  bool _isMultiTouchMode = false;
  double? _lastPinchDistance;

  // Video render size (from LayoutBuilder)
  Size _videoSize = Size.zero;

  // Actual video rect inside container (accounts for BoxFit.contain letterboxing)
  Rect _videoRect = Rect.zero;

  @override
  void initState() {
    super.initState();
    _panelController = AnimationController(
      duration: const Duration(milliseconds: 220),
      vsync: this,
    );
    _panelAnimation = Tween<Offset>(
      begin: const Offset(1.0, 0.0),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _panelController, curve: Curves.easeOut));

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final svc = context.read<StreamingService>();
      svc.startStreaming();
      svc.addListener(_onServiceChanged);
    });
  }

  @override
  void dispose() {
    context.read<StreamingService>().removeListener(_onServiceChanged);
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    _panelController.dispose();
    super.dispose();
  }

  // ── Orientation ────────────────────────────────────────────────────────────

  void _onServiceChanged() {
    final svc = context.read<StreamingService>();
    // 優先使用 JPEG 實際解析度，而非 server 回報的 screenSize（可能不一致）
    final w = svc.frameWidth > 0 ? svc.frameWidth : svc.screenWidth;
    final h = svc.frameHeight > 0 ? svc.frameHeight : svc.screenHeight;
    _applyOrientation(w, h);
  }

  void _applyOrientation(int w, int h) {
    if (w <= 0 || h <= 0) return;
    final isLandscape = w > h;
    if (isLandscape == _lastIsLandscape) return;
    _lastIsLandscape = isLandscape;
    SystemChrome.setPreferredOrientations(isLandscape
        ? [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]
        : [DeviceOrientation.portraitUp, DeviceOrientation.portraitDown]);
  }

  // ── Panel ──────────────────────────────────────────────────────────────────

  void _togglePanel() {
    setState(() => _isPanelOpen = !_isPanelOpen);
    _isPanelOpen ? _panelController.forward() : _panelController.reverse();
  }

  void _closePanel() {
    if (!_isPanelOpen) return;
    setState(() => _isPanelOpen = false);
    _panelController.reverse();
  }

  // ── Touch (Listener) ───────────────────────────────────────────────────────

  /// Normalize a touch position to 0-1 range, accounting for BoxFit.contain letterboxing.
  Offset _normalize(Offset pos) {
    if (_videoRect.isEmpty) return Offset.zero;
    return Offset(
      ((pos.dx - _videoRect.left) / _videoRect.width).clamp(0.0, 1.0),
      ((pos.dy - _videoRect.top) / _videoRect.height).clamp(0.0, 1.0),
    );
  }

  List<Map<String, dynamic>> _buildPointerList() {
    return _activePointers.entries.map((e) {
      final n = _normalize(e.value);
      return {'pointerId': e.key, 'x': n.dx, 'y': n.dy};
    }).toList();
  }

  void _handlePinch() {
    if (_activePointers.length < 2) return;
    final pts = _activePointers.values.toList();
    final dx = pts[1].dx - pts[0].dx;
    final dy = pts[1].dy - pts[0].dy;
    final dist = sqrt(dx * dx + dy * dy);
    if (_lastPinchDistance != null) {
      final ratio = dist / _lastPinchDistance!;
      if (ratio > 1.1 || ratio < 0.9) {
        context.read<StreamingService>().sendPinch(_buildPointerList());
        _lastPinchDistance = dist;
      }
    } else {
      _lastPinchDistance = dist;
    }
  }

  void _onPointerDown(PointerDownEvent e) {
    debugPrint(
        '[TOUCH] DOWN pointer=${e.pointer} local=${e.localPosition} videoRect=$_videoRect');
    _closePanel();
    _activePointers[e.pointer] = e.localPosition;
    if (_activePointers.length == 1) {
      _isMultiTouchMode = false;
      final n = _normalize(e.localPosition);
      debugPrint(
          '[TOUCH] sending touchDown normalized=(${n.dx.toStringAsFixed(3)}, ${n.dy.toStringAsFixed(3)})');
      context.read<StreamingService>().touchDown(n.dx, n.dy);
    } else {
      // Second finger: cancel single-touch, enter multi-touch
      if (!_isMultiTouchMode) {
        _isMultiTouchMode = true;
        _lastPinchDistance = null;
        // Lift the first finger before entering pinch mode
        final firstPos = _activePointers.values.first;
        final n = _normalize(firstPos);
        context.read<StreamingService>().touchUp(n.dx, n.dy);
      }
    }
  }

  void _onPointerMove(PointerMoveEvent e) {
    _activePointers[e.pointer] = e.localPosition;
    if (_activePointers.length == 1 && !_isMultiTouchMode) {
      final n = _normalize(e.localPosition);
      context.read<StreamingService>().touchMove(n.dx, n.dy);
    } else if (_activePointers.length >= 2) {
      _handlePinch();
    }
  }

  void _onPointerUp(PointerUpEvent e) {
    final pos = _activePointers[e.pointer] ?? e.localPosition;
    _activePointers.remove(e.pointer);
    if (_activePointers.isEmpty) {
      if (!_isMultiTouchMode) {
        final n = _normalize(pos);
        context.read<StreamingService>().touchUp(n.dx, n.dy);
      }
      _isMultiTouchMode = false;
      _lastPinchDistance = null;
    }
  }

  void _onPointerCancel(PointerCancelEvent e) {
    _activePointers.remove(e.pointer);
    if (_activePointers.isEmpty) {
      _isMultiTouchMode = false;
      _lastPinchDistance = null;
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final svc = context.watch<StreamingService>();

    // 直接在 build() 用 MediaQuery 計算 video 容器尺寸與 letterbox rect，
    // 避免 LayoutBuilder render object 在 hit test chain 中造成問題。
    final media = MediaQuery.of(context);
    _videoSize = Size(
      media.size.width - _kEdgeStripWidth,
      media.size.height,
    );
    final vw =
        (svc.frameWidth > 0 ? svc.frameWidth : svc.screenWidth).toDouble();
    final vh =
        (svc.frameHeight > 0 ? svc.frameHeight : svc.screenHeight).toDouble();
    if (vw > 0 && vh > 0 && !_videoSize.isEmpty) {
      final scale = min(_videoSize.width / vw, _videoSize.height / vh);
      final sw = vw * scale;
      final sh = vh * scale;
      _videoRect = Rect.fromLTWH(
        (_videoSize.width - sw) / 2,
        (_videoSize.height - sh) / 2,
        sw,
        sh,
      );
    } else {
      _videoRect = Rect.fromLTWH(0, 0, _videoSize.width, _videoSize.height);
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // ① Video area — Listener 直接掛在 Positioned 下，無 LayoutBuilder 包裹
          Positioned(
            left: 0,
            top: 0,
            right: _kEdgeStripWidth,
            bottom: 0,
            child: Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: _onPointerDown,
              onPointerMove: _onPointerMove,
              onPointerUp: _onPointerUp,
              onPointerCancel: _onPointerCancel,
              child: Container(
                color: Colors.black,
                child: Center(
                  child: svc.isWebRtcStreaming && svc.remoteRenderer != null
                      ? RTCVideoView(
                          svc.remoteRenderer!,
                          objectFit: RTCVideoViewObjectFit
                              .RTCVideoViewObjectFitContain,
                        )
                      : svc.currentFrame != null
                          ? Image.memory(
                              svc.currentFrame!,
                              fit: BoxFit.contain,
                              gaplessPlayback: true,
                            )
                          : _buildWaitingWidget(svc),
                ),
              ),
            ),
          ),

          // ② Sliding panel
          Positioned(
            right: _kEdgeStripWidth,
            top: 0,
            bottom: 0,
            width: _kPanelWidth,
            child: IgnorePointer(
              ignoring: !_isPanelOpen,
              child: SlideTransition(
                position: _panelAnimation,
                child: _buildControlPanel(svc),
              ),
            ),
          ),

          // ③ Edge strip
          Positioned(
            right: 0,
            top: 0,
            bottom: 0,
            width: _kEdgeStripWidth,
            child: _buildEdgeStrip(svc),
          ),

          // ④ Stats HUD overlay (top-left of video, touch-transparent)
          if (svc.isStreaming &&
              (svc.currentFrame != null || svc.isWebRtcStreaming))
            Positioned(
              left: 8,
              top: 8,
              child: IgnorePointer(child: _buildStatsHud(svc)),
            ),
        ],
      ),
    );
  }

  Widget _buildStatsHud(StreamingService svc) {
    final lat = svc.latency;
    final Color latColor = lat == 0
        ? Colors.white38
        : lat < 50
            ? Colors.greenAccent
            : lat < 100
                ? Colors.yellowAccent
                : Colors.redAccent;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 6,
                height: 6,
                decoration:
                    BoxDecoration(shape: BoxShape.circle, color: latColor),
              ),
              const SizedBox(width: 5),
              Text(
                '${lat}ms',
                style: TextStyle(
                    color: latColor, fontSize: 11, fontWeight: FontWeight.bold),
              ),
              const SizedBox(width: 8),
              Text(
                '${svc.serverFps}fps',
                style: const TextStyle(color: Colors.white60, fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            'mode: ${svc.streamMode}',
            style: const TextStyle(color: Colors.white60, fontSize: 10),
          ),
        ],
      ),
    );
  }

  Widget _buildWaitingWidget(StreamingService svc) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const CircularProgressIndicator(color: Colors.white54),
        const SizedBox(height: 16),
        Text(
          svc.isStreaming ? '等待畫面...' : '正在連線...',
          style: const TextStyle(color: Colors.white70, fontSize: 15),
        ),
        if (svc.isStreaming) ...[
          const SizedBox(height: 8),
          Text(
            '${svc.latency}ms · ${svc.serverFps}fps',
            style: const TextStyle(color: Colors.white38, fontSize: 12),
          ),
          const SizedBox(height: 4),
          Text(
            'mode: ${svc.streamMode}'
            '${svc.streamModeReason.isNotEmpty ? ' (${svc.streamModeReason})' : ''}',
            style: const TextStyle(color: Colors.white38, fontSize: 11),
          ),
        ],
      ],
    );
  }

  // ── Edge strip ─────────────────────────────────────────────────────────────

  Widget _buildEdgeStrip(StreamingService svc) {
    return Container(
      color: const Color(0xFF1A1A1A),
      child: Column(
        children: [
          const SizedBox(height: 8),
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.symmetric(vertical: 6),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: svc.isStreaming ? Colors.greenAccent : Colors.orange,
            ),
          ),
          const SizedBox(height: 4),
          _EdgeButton(
            icon: _isPanelOpen ? Icons.close : Icons.grid_view,
            label: '工具',
            onTap: _togglePanel,
            active: _isPanelOpen,
          ),
          const Spacer(),
          _EdgeButton(
            icon: Icons.arrow_back_ios_new,
            label: '返回',
            onTap: () => svc.sendKey('back'),
          ),
          const SizedBox(height: 4),
          _EdgeButton(
            icon: Icons.circle_outlined,
            label: '首頁',
            onTap: () => svc.sendKey('home'),
          ),
          const SizedBox(height: 4),
          _EdgeButton(
            icon: Icons.square_outlined,
            label: '切換',
            onTap: () => svc.sendKey('menu'),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  // ── Control panel ──────────────────────────────────────────────────────────

  Widget _buildControlPanel(StreamingService svc) {
    final lat = svc.latency;
    final Color latColor = lat == 0
        ? Colors.white54
        : lat < 50
            ? Colors.greenAccent
            : lat < 100
                ? Colors.yellowAccent
                : Colors.redAccent;

    return Container(
      color: const Color(0xCC1C1C1E),
      padding: const EdgeInsets.fromLTRB(12, 48, 12, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.circle, color: Colors.greenAccent, size: 8),
              const SizedBox(width: 6),
              Text(
                svc.isStreaming ? 'LIVE' : '連線中',
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              Text(
                '${lat}ms',
                style: TextStyle(
                    color: latColor, fontSize: 11, fontWeight: FontWeight.bold),
              ),
              const SizedBox(width: 4),
              Text(
                '· ${svc.serverFps}fps',
                style: const TextStyle(color: Colors.white38, fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(svc.resolution,
              style: const TextStyle(color: Colors.white38, fontSize: 11)),
          const SizedBox(height: 12),
          _buildFpsSelector(svc),
          const SizedBox(height: 10),
          _buildQualitySelector(svc),
          const SizedBox(height: 14),
          Expanded(
            child: GridView.count(
              crossAxisCount: 2,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 1.6,
              children: [
                _PanelButton(
                  icon: Icons.keyboard,
                  label: '鍵盤',
                  onTap: () => _showKeyboardDialog(svc),
                ),
                _PanelButton(
                  icon: Icons.keyboard_return,
                  label: '確認鍵',
                  onTap: () => svc.sendKey('enter'),
                ),
                _PanelButton(
                  icon: Icons.volume_up,
                  label: '音量+',
                  onTap: () => svc.sendKey('volume_up'),
                ),
                _PanelButton(
                  icon: Icons.volume_down,
                  label: '音量-',
                  onTap: () => svc.sendKey('volume_down'),
                ),
                _PanelButton(
                  icon: Icons.screenshot_monitor,
                  label: '截圖',
                  onTap: () => _takeScreenshot(svc),
                ),
                _PanelButton(
                  icon: Icons.phonelink_erase,
                  label: '結束串流',
                  onTap: () {
                    svc.stopStreaming();
                    Navigator.pop(context);
                  },
                  danger: true,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFpsSelector(StreamingService svc) {
    const options = [15, 24, 30, 60];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('幀率', style: TextStyle(color: Colors.white38, fontSize: 10)),
        const SizedBox(height: 5),
        Row(
          children: options.asMap().entries.map((entry) {
            final fps = entry.value;
            final isLast = entry.key == options.length - 1;
            final selected = svc.fps == fps;
            return Expanded(
              child: GestureDetector(
                onTap: () => svc.setFps(fps),
                child: Container(
                  margin: isLast
                      ? EdgeInsets.zero
                      : const EdgeInsets.only(right: 5),
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  decoration: BoxDecoration(
                    color:
                        selected ? Colors.blueAccent : const Color(0xFF2C2C2E),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '$fps',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: selected ? Colors.white : Colors.white54,
                      fontSize: 12,
                      fontWeight:
                          selected ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildQualitySelector(StreamingService svc) {
    const options = ['480p', '720p', '1080p'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('畫質', style: TextStyle(color: Colors.white38, fontSize: 10)),
        const SizedBox(height: 5),
        Row(
          children: options.asMap().entries.map((entry) {
            final q = entry.value;
            final isLast = entry.key == options.length - 1;
            final selected = svc.quality == q;
            return Expanded(
              child: GestureDetector(
                onTap: () => svc.setQuality(q),
                child: Container(
                  margin: isLast
                      ? EdgeInsets.zero
                      : const EdgeInsets.only(right: 5),
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  decoration: BoxDecoration(
                    color:
                        selected ? Colors.blueAccent : const Color(0xFF2C2C2E),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    q,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: selected ? Colors.white : Colors.white54,
                      fontSize: 12,
                      fontWeight:
                          selected ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  void _showKeyboardDialog(StreamingService svc) {
    final ctrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF2C2C2E),
        title: const Text('輸入文字', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            hintText: '輸入要發送的文字',
            hintStyle: TextStyle(color: Colors.white38),
            enabledBorder: UnderlineInputBorder(
                borderSide: BorderSide(color: Colors.white24)),
            focusedBorder: UnderlineInputBorder(
                borderSide: BorderSide(color: Colors.blueAccent)),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消', style: TextStyle(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () {
              if (ctrl.text.isNotEmpty) svc.sendText(ctrl.text);
              Navigator.pop(ctx);
            },
            child: const Text('發送', style: TextStyle(color: Colors.blueAccent)),
          ),
        ],
      ),
    );
  }

  Future<void> _takeScreenshot(StreamingService svc) async {
    final data = await svc.requestScreenshot();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(data != null ? '截圖成功' : '截圖失敗'),
      duration: const Duration(seconds: 2),
      backgroundColor:
          data != null ? Colors.green.shade700 : Colors.red.shade700,
    ));
  }
}

// ── Reusable widgets ──────────────────────────────────────────────────────────

class _EdgeButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;

  const _EdgeButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          width: _kEdgeStripWidth,
          height: 52,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon,
                  color: active ? Colors.blueAccent : Colors.white70, size: 20),
              const SizedBox(height: 3),
              Text(
                label,
                style: TextStyle(
                  color: active ? Colors.blueAccent : Colors.white38,
                  fontSize: 9,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PanelButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;

  const _PanelButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.danger = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = danger ? Colors.red.shade400 : Colors.white;
    return Material(
      color: const Color(0xFF2C2C2E),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(height: 5),
              Text(label, style: TextStyle(color: color, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
}
