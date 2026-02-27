import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/streaming_service.dart';

class StreamingScreen extends StatefulWidget {
  const StreamingScreen({super.key});

  @override
  State<StreamingScreen> createState() => _StreamingScreenState();
}

class _StreamingScreenState extends State<StreamingScreen> {
  bool _showControls = false;

  @override
  void initState() {
    super.initState();
    // 開始串流
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<StreamingService>().startStreaming();
    });
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
        onPanStart: (details) {
          // 記錄起始位置
        },
        onPanUpdate: (details) {
          // 計算觸控位置 (0-1 範圍)
          final x = details.localPosition.dx / MediaQuery.of(context).size.width;
          final y = details.localPosition.dy / MediaQuery.of(context).size.height;
          
          streamingService.sendTouch(x, y, 'move');
        },
        onPanEnd: (details) {
          streamingService.sendTouch(0, 0, 'up');
        },
        onTapDown: (details) {
          final x = details.localPosition.dx / MediaQuery.of(context).size.width;
          final y = details.localPosition.dy / MediaQuery.of(context).size.height;
          
          streamingService.sendTouch(x, y, 'down');
        },
        onTapUp: (details) {
          final x = details.localPosition.dx / MediaQuery.of(context).size.width;
          final y = details.localPosition.dy / MediaQuery.of(context).size.height;
          
          streamingService.tap(x, y);
        },
        child: Stack(
          children: [
            // 遠端畫面
            Center(
              child: streamingService.remoteRenderer != null
                ? RTCVideoView(streamingService.remoteRenderer!)
                : Container(
                    color: Colors.grey[900],
                    child: const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          CircularProgressIndicator(color: Colors.white),
                          SizedBox(height: 16),
                          Text(
                            '等待串流連線...',
                            style: TextStyle(color: Colors.white),
                          ),
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
                        child: Text(
                          streamingService.isStreaming ? 'LIVE' : '連線中',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
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
                    ],
                  ),
                ),
              ),

              // 右側 - 畫質/設定
              Positioned(
                right: 16,
                top: MediaQuery.of(context).size.height * 0.3,
                child: Column(
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
