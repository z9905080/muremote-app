import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/webrtc_service.dart';
import '../services/streaming_service.dart';

class ConnectionScreen extends StatefulWidget {
  const ConnectionScreen({super.key});

  @override
  State<ConnectionScreen> createState() => _ConnectionScreenState();
}

class _ConnectionScreenState extends State<ConnectionScreen> {
  final _pcIdController = TextEditingController();
  final _ipController = TextEditingController(text: '192.168.1.100');
  
  @override
  void dispose() {
    _pcIdController.dispose();
    _ipController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final streamingService = context.watch<StreamingService>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('連線'),
        backgroundColor: Colors.blue.shade700,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Connection Status
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: streamingService.isConnected 
                  ? Colors.green.shade50 
                  : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: streamingService.isConnected 
                    ? Colors.green.shade200 
                    : Colors.grey.shade300,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    streamingService.isConnected 
                      ? Icons.check_circle 
                      : Icons.circle_outlined,
                    color: streamingService.isConnected 
                      ? Colors.green 
                      : Colors.grey,
                  ),
                  const SizedBox(width: 12),
                  Text(
                    streamingService.isConnected ? '已連線' : '未連線',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: streamingService.isConnected 
                        ? Colors.green.shade700 
                        : Colors.grey.shade700,
                    ),
                  ),
                  const Spacer(),
                  if (streamingService.isConnected)
                    Text(
                      '${streamingService.latency}ms',
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 32),

            // PC IP Input
            Text(
              '電腦 IP 位址',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _ipController,
              decoration: InputDecoration(
                hintText: '例如: 192.168.1.100',
                prefixIcon: const Icon(Icons.wifi),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),

            // PC ID Input (Optional)
            Text(
              '電腦 ID (可選)',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _pcIdController,
              decoration: InputDecoration(
                hintText: '例如: ABC-123-XYZ',
                prefixIcon: const Icon(Icons.computer),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Connect Button
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: streamingService.isConnecting
                  ? null
                  : () async {
                      final ip = _ipController.text.trim();
                      if (ip.isNotEmpty) {
                        await streamingService.connect(
                          _pcIdController.text.trim().isEmpty 
                            ? ip 
                            : _pcIdController.text.trim(),
                          serverUrl: 'ws://$ip:8080',
                        );
                        
                        if (streamingService.isConnected && context.mounted) {
                          // 導航到串流頁面
                          Navigator.pushNamed(context, '/stream');
                        }
                      }
                    },
                icon: streamingService.isConnecting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.link),
                label: Text(
                  streamingService.isConnecting ? '連線中...' : '開始連線',
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue.shade700,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),

            const Spacer(),

            // Instructions
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline, color: Colors.blue.shade700),
                      const SizedBox(width: 8),
                      Text(
                        '連線說明',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: Colors.blue.shade700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Text('1. 確保手機和電腦在同一個 WiFi 網路'),
                  const Text('2. 在電腦上執行 MuRemote PC Client'),
                  const Text('3. 輸入電腦的 IP 位址'),
                  const Text('4. 點擊連線開始遠端控制'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
