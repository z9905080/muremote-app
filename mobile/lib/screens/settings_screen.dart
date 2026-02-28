import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/streaming_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final authService = context.watch<AuthService>();
    final streamingService = context.watch<StreamingService>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('設定'),
        backgroundColor: Colors.blue.shade700,
      ),
      body: ListView(
        children: [
          // Account Section
          _buildSectionHeader('帳號'),
          ListTile(
            leading: const Icon(Icons.person),
            title: const Text('登入狀態'),
            subtitle: Text(authService.isLoggedIn 
              ? authService.userEmail 
              : '未登入'),
          ),
          if (authService.isLoggedIn)
            ListTile(
              leading: const Icon(Icons.logout, color: Colors.red),
              title: const Text('登出', style: TextStyle(color: Colors.red)),
              onTap: () => authService.logout(),
            ),
          const Divider(),

          // Quality Settings
          _buildSectionHeader('畫質設定'),
          ListTile(
            leading: const Icon(Icons.high_quality),
            title: const Text('解析度'),
            subtitle: Text(streamingService.isConnected 
              ? streamingService.quality 
              : '720p (推薦)'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showResolutionDialog(context, streamingService),
          ),
          ListTile(
            leading: const Icon(Icons.speed),
            title: const Text('幀率'),
            subtitle: Text(streamingService.isConnected 
              ? '${streamingService.fps} fps' 
              : '30 fps'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showFpsDialog(context, streamingService),
          ),
          const Divider(),

          // Server Settings
          _buildSectionHeader('連線設定'),
          ListTile(
            leading: const Icon(Icons.wifi),
            title: const Text('伺服器位址'),
            subtitle: Text(streamingService.serverUrl),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showServerUrlDialog(context, streamingService),
          ),
          const Divider(),

          // About
          _buildSectionHeader('關於'),
          const ListTile(
            leading: Icon(Icons.info),
            title: Text('版本'),
            subtitle: Text('1.0.0 (POC)'),
          ),
          ListTile(
            leading: const Icon(Icons.description),
            title: const Text('使用條款'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.privacy_tip),
            title: const Text('隱私政策'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {},
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: TextStyle(
          color: Colors.blue.shade700,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  void _showServerUrlDialog(BuildContext context, StreamingService service) {
    final controller = TextEditingController(text: service.serverUrl);
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('伺服器位址'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: '192.168.1.100:8080',
            labelText: 'WebSocket 位址',
            prefixText: 'ws://',
          ),
          keyboardType: TextInputType.url,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              service.setServerUrl(controller.text);
              Navigator.pop(context);
            },
            child: const Text('儲存'),
          ),
        ],
      ),
    );
  }

  void _showResolutionDialog(BuildContext context, StreamingService service) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('選擇解析度'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: const Text('480p'),
              subtitle: const Text('省流量'),
              onTap: () {
                service.setQuality('480p');
                Navigator.pop(context);
              },
            ),
            ListTile(
              title: const Text('720p (推薦)'),
              subtitle: const Text('平衡'),
              onTap: () {
                service.setQuality('720p');
                Navigator.pop(context);
              },
            ),
            ListTile(
              title: const Text('1080p'),
              subtitle: const Text('高畫質'),
              onTap: () {
                service.setQuality('1080p');
                Navigator.pop(context);
              },
            ),
            ListTile(
              title: const Text('4K'),
              subtitle: const Text('超高畫質 (需要高頻寬)'),
              onTap: () {
                service.setQuality('4K');
                Navigator.pop(context);
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showFpsDialog(BuildContext context, StreamingService service) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('選擇幀率'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: const Text('24 fps'),
              subtitle: const Text('省電'),
              onTap: () {
                service.setFps(24);
                Navigator.pop(context);
              },
            ),
            ListTile(
              title: const Text('30 fps (推薦)'),
              subtitle: const Text('平衡'),
              onTap: () {
                service.setFps(30);
                Navigator.pop(context);
              },
            ),
            ListTile(
              title: const Text('60 fps'),
              subtitle: const Text('流暢'),
              onTap: () {
                service.setFps(60);
                Navigator.pop(context);
              },
            ),
          ],
        ),
      ),
    );
  }
}
