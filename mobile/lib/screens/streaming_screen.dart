import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/streaming_service.dart';

class StreamingScreen extends StatefulWidget {
  const StreamingScreen({super.key});

  @override
  State<StreamingScreen> createState() => _StreamingScreenState();
}

class _StreamingScreenState extends State<StreamingScreen> {
  bool _showControls = true;
  Offset? _lastTouchPosition;
  bool _isLongPress = false;
  
  // 多點觸控追蹤
  final Map<int, Offset> _activePointers = {};
  double? _initialPinchDistance;

  @override
  void initState() {
    super.initState();
    // 開始串流
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<StreamingService>().startStreaming();
    });
  }

  void _handlePanStart(DragStartDetails details) {
    _lastTouchPosition = details.localPosition;
    final streamingService = context.read<StreamingService>();
    
    // 計算觸控位置 (0-1 範圍)
    final x = details.localPosition.dx / MediaQuery.of(context).size.width;
    final y = details.localPosition.dy / MediaQuery.of(context).size.height;
    
    streamingService.touchDown(x, y);
  }

  void _handlePanUpdate(DragUpdateDetails details) {
    final streamingService = context.read<StreamingService>();
    
    // 計算觸控位置 (0-1 範圍)
    final x = details.localPosition.dx / MediaQuery.of(context).size.width;
    final y = details.localPosition.dy / MediaQuery.of(context).size.height;
    
    streamingService.touchMove(x, y);
    _lastTouchPosition = details.localPosition;
  }

  void _handlePanEnd(DragEndDetails details) {
    final streamingService = context.read<StreamingService>();
    streamingService.touchUp(0, 0);
    _lastTouchPosition = null;
    _activePointers.clear();
  }

  void _handleScaleStart(ScaleStartDetails details) {
    if (details.pointerCount >= 2) {
      _initialPinchDistance = _calculatePinchDistance(details);
    }
  }

  void _handleScaleUpdate(ScaleUpdateDetails details) {
    if (details.pointerCount >= 2 && _initialPinchDistance != null) {
      final currentDistance = _calculatePinchDistance(details);
      final scale = currentDistance / _initialPinchDistance!;
      
      // 檢測縮放手勢
      if (scale > 1.2 || scale < 0.8) {
        final streamingService = context.read<StreamingService>();
        
        // 構建多點觸控數據
        final pointers = details.focalPointDetails?.pointerPositions?.entries.map((e) => {
          'pointerId': e.key,
          'x': e.value.dx / MediaQuery.of(context).size.width,
          'y': e.value.dy / MediaQuery.of(context).size.height,
        }).toList() ?? [];
        
        if (pointers.length >= 2) {
          streamingService.sendPinch(pointers);
        }
        
        // 重置初始距離
        _initialPinchDistance = currentDistance;
      }
    }
  }

  double _calculatePinchDistance(ScaleUpdateDetails details) {
    // 簡單的兩指距離計算
    final focalPoint = details.focalPoint;
    // 使用 localFocalPoint 計算兩指距離
    // 這是一個簡化的實現
    return details.scale;
  }

  void _handleScaleEnd(ScaleEndDetails details) {
    _initialPinchDistance = null;
  }

  void _handleTapDown(TapDownDetails details) {
    final streamingService = context.read<StreamingService>();
    
    // 計算觸控位置 (0-1 範圍)
    final x = details.localPosition.dx / MediaQuery.of(context).size.width;
    final y = details.localPosition.dy / MediaQuery.of(context).size.height;
    
    streamingService.touchDown(x, y);
  }

  void _handleTapUp(TapUpDetails details) {
    final streamingService = context.read<StreamingService>();
    
    // 計算觸控位置 (0-1 範圍)
    final x = details.localPosition.dx / MediaQuery.of(context).size.width;
    final y = details.localPosition.dy / MediaQuery.of(context).size.height;
    
    streamingService.tap(x, y);
  }

  @override
  Widget build(BuildContext context) {
    final streamingService = context.watch<StreamingService>();

    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onTap: () {
          setState(() {
            _showControls = !_showControls;
          });
        },
        onPanStart: _handlePanStart,
        onPanUpdate: _handlePanUpdate,
        onPanEnd: _handlePanEnd,
        onScaleStart: _handleScaleStart,
        onScaleUpdate: _handleScaleUpdate,
        onScaleEnd: _handleScaleEnd,
        onTapDown: _handleTapDown,
        onTapUp: _handleTapUp,
        child: Stack(
          children: [
            // 遠端畫面 - 使用 JPEG 幀顯示
            Center(
              child: streamingService.currentFrame != null
                ? Image.memory(
                    streamingService.currentFrame!,
                    fit: BoxFit.contain,
                    gaplessPlayback: true, // 流暢播放
                  )
                : Container(
                    color: Colors.grey[900],
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const CircularProgressIndicator(color: Colors.white),
                          const SizedBox(height: 16),
                          Text(
                            streamingService.isStreaming 
                              ? '等待畫面...' 
                              : '正在連線...',
                            style: const TextStyle(color: Colors.white),
                          ),
                          if (streamingService.isStreaming) ...[
                            const SizedBox(height: 8),
                            Text(
                              '延遲: ${streamingService.latency}ms | FPS: ${streamingService.fps}',
                              style: TextStyle(
                                color: Colors.white.withOpacity(0.7),
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
            ),

            // 控制項 (點擊顯示/隱藏)
            if (_showControls) ...[
              // 頂部欄
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: Container(
                  padding: EdgeInsets.only(
                    top: MediaQuery.of(context).padding.top + 8,
                    bottom: 8,
                    left: 16,
                    right: 16,
                  ),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.black.withOpacity(0.7),
                        Colors.transparent,
                      ],
                    ),
                  ),
                  child: Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.arrow_back, color: Colors.white),
                        onPressed: () {
                          streamingService.stopStreaming();
                          Navigator.pop(context);
                        },
                      ),
                      const Spacer(),
                      // 狀態指示
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: streamingService.isStreaming
                            ? Colors.green
                            : Colors.orange,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (streamingService.isStreaming)
                              Container(
                                width: 8,
                                height: 8,
                                margin: const EdgeInsets.only(right: 6),
                                decoration: const BoxDecoration(
                                  color: Colors.white,
                                  shape: BoxShape.circle,
                                ),
                              ),
                            Text(
                              streamingService.isStreaming ? 'LIVE' : '連線中',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // 底部欄 - 快捷鍵
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: Container(
                  padding: EdgeInsets.only(
                    bottom: MediaQuery.of(context).padding.bottom + 8,
                    top: 24,
                    left: 16,
                    right: 16,
                  ),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: [
                        Colors.black.withOpacity(0.7),
                        Colors.transparent,
                      ],
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      _buildQuickButton(
                        icon: Icons.arrow_back,
                        label: '返回',
                        onTap: () => streamingService.sendKey('back'),
                      ),
                      _buildQuickButton(
                        icon: Icons.home,
                        label: '首頁',
                        onTap: () => streamingService.sendKey('home'),
                      ),
                      _buildQuickButton(
                        icon: Icons.menu,
                        label: '選單',
                        onTap: () => streamingService.sendKey('menu'),
                      ),
                      _buildQuickButton(
                        icon: Icons.refresh,
                        label: '重新整理',
                        onTap: () => streamingService.sendKey('enter'),
                      ),
                      _buildQuickButton(
                        icon: Icons.keyboard,
                        label: '輸入',
                        onTap: () => _showKeyboardDialog(context, streamingService),
                      ),
                    ],
                  ),
                ),
              ),

              // 右側 - 狀態資訊
              Positioned(
                right: 16,
                top: MediaQuery.of(context).size.height * 0.25,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    _buildSideButton(
                      icon: Icons.high_quality,
                      label: '${streamingService.resolution}',
                    ),
                    const SizedBox(height: 8),
                    _buildSideButton(
                      icon: Icons.speed,
                      label: '${streamingService.fps}fps',
                    ),
                    const SizedBox(height: 8),
                    _buildSideButton(
                      icon: Icons.network_latency,
                      label: '${streamingService.latency}ms',
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  void _showKeyboardDialog(BuildContext context, StreamingService service) {
    final controller = TextEditingController();
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('輸入文字'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: '輸入要發送的文字',
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              if (controller.text.isNotEmpty) {
                service.sendText(controller.text);
              }
              Navigator.pop(context);
            },
            child: const Text('發送'),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: Colors.white, size: 24),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSideButton({
    required IconData icon,
    required String label,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.5),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 16),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
