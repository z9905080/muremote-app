import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/webrtc_service.dart';

class ConnectionScreen extends StatefulWidget {
  const ConnectionScreen({super.key});

  @override
  State<ConnectionScreen> createState() => _ConnectionScreenState();
}

class _ConnectionScreenState extends State<ConnectionScreen> {
  final _pcIdController = TextEditingController();
  
  @override
  void dispose() {
    _pcIdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final webrtcService = context.watch<WebRTCService>();

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
                color: webrtcService.isConnected 
                  ? Colors.green.shade50 
                  : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: webrtcService.isConnected 
                    ? Colors.green.shade200 
                    : Colors.grey.shade300,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    webrtcService.isConnected 
                      ? Icons.check_circle 
                      : Icons.circle_outlined,
                    color: webrtcService.isConnected 
                      ? Colors.green 
                      : Colors.grey,
                  ),
                  const SizedBox(width: 12),
                  Text(
                    webrtcService.isConnected ? '已連線' : '未連線',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: webrtcService.isConnected 
                        ? Colors.green.shade700 
                        : Colors.grey.shade700,
                    ),
                  ),
                  const Spacer(),
                  if (webrtcService.isConnected)
                    Text(
                      '${webrtcService.latency}ms',
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 32),

            // PC ID Input
            Text(
              '輸入電腦 ID',
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
            const SizedBox(height: 16),

            // Quick Connect Info
            Text(
              '或從電腦端取得 ID',
              style: TextStyle(color: Colors.grey.shade600),
            ),
            const SizedBox(height: 24),

            // Connect Button
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton.icon(
                onPressed: webrtcService.isConnecting
                  ? null
                  : () {
                      if (_pcIdController.text.isNotEmpty) {
                        webrtcService.connect(_pcIdController.text);
                      }
                    },
                icon: webrtcService.isConnecting
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
                  webrtcService.isConnecting ? '連線中...' : '開始連線',
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

            // Quality Info
            if (webrtcService.isConnected)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildQualityItem('解析度', webrtcService.resolution),
                        _buildQualityItem('幀率', '${webrtcService.fps} fps'),
                        _buildQualityItem('延遲', '${webrtcService.latency}ms'),
                      ],
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildQualityItem(String label, String value) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 16,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: Colors.grey.shade600,
            fontSize: 12,
          ),
        ),
      ],
    );
  }
}
