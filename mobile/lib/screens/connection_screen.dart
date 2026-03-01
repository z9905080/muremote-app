import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/webrtc_service.dart';
import '../services/streaming_service.dart';
import '../services/discovery_service.dart';

class ConnectionScreen extends StatefulWidget {
  const ConnectionScreen({super.key});

  @override
  State<ConnectionScreen> createState() => _ConnectionScreenState();
}

class _ConnectionScreenState extends State<ConnectionScreen> {
  final _pcIdController = TextEditingController();
  final _ipController = TextEditingController(text: '192.168.1.100');
  bool _showManualInput = false;
  
  @override
  void initState() {
    super.initState();
    // 開始設備發現
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DiscoveryService>().startDiscovery();
    });
  }
  
  @override
  void dispose() {
    _pcIdController.dispose();
    _ipController.dispose();
    super.dispose();
  }

  void _connectToDevice(DeviceInfo device) {
    final streamingService = context.read<StreamingService>();
    streamingService.connect(
      device.pcId,
      serverUrl: 'ws://${device.ip}:${device.port}',
    );
  }

  /// 顯示模擬器選擇對話框
  void _showEmulatorSelector(BuildContext context, DeviceInfo device) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => _EmulatorSelectorSheet(
        device: device,
        onConnect: (emulatorType) {
          Navigator.pop(context);
          _connectWithEmulator(device, emulatorType);
        },
      ),
    );
  }

  /// 連接時指定模擬器類型
  void _connectWithEmulator(DeviceInfo device, EmulatorType emulatorType) {
    final streamingService = context.read<StreamingService>();
    // 傳送模擬器類型到 PC 端
    streamingService.connect(
      device.pcId,
      serverUrl: 'ws://${device.ip}:${device.port}',
      metadata: {'emulatorType': emulatorType.key},
    );
  }

  /// 獲取模擬器對應的顏色
  Color _getEmulatorColor(EmulatorType type) {
    switch (type) {
      case EmulatorType.mumu:
        return Colors.blue;
      case EmulatorType.nox:
        return Colors.purple;
      case EmulatorType.ldplayer:
        return Colors.orange;
      case EmulatorType.bluestacks:
        return Colors.green;
      case EmulatorType.genymotion:
        return Colors.teal;
      case EmulatorType.memu:
        return Colors.red;
      case EmulatorType.koplayer:
        return Colors.indigo;
      case EmulatorType.unknown:
        return Colors.grey;
    }
  }

  /// 獲取模擬器對應的圖標
  IconData _getEmulatorIcon(EmulatorType type) {
    switch (type) {
      case EmulatorType.mumu:
        return Icons.smartphone;
      case EmulatorType.nox:
        return Icons.smartphone;
      case EmulatorType.ldplayer:
        return Icons.smartphone;
      case EmulatorType.bluestacks:
        return Icons.smartphone;
      case EmulatorType.genymotion:
        return Icons.smartphone;
      case EmulatorType.memu:
        return Icons.smartphone;
      case EmulatorType.koplayer:
        return Icons.smartphone;
      case EmulatorType.unknown:
        return Icons.computer;
    }
  }

  @override
  Widget build(BuildContext context) {
    final streamingService = context.watch<StreamingService>();
    final discoveryService = context.watch<DiscoveryService>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('連線'),
        backgroundColor: Colors.blue.shade700,
        actions: [
          IconButton(
            icon: Icon(_showManualInput ? Icons.wifi_find : Icons.edit),
            onPressed: () {
              setState(() {
                _showManualInput = !_showManualInput;
              });
            },
            tooltip: _showManualInput ? '顯示自動發現' : '手動輸入',
          ),
        ],
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
            const SizedBox(height: 24),

            // Auto Discovery Section
            if (!_showManualInput) ...[
              // Device List Header
              Row(
                children: [
                  const Icon(Icons.devices, size: 20),
                  const SizedBox(width: 8),
                  Text(
                    '發現的設備',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Spacer(),
                  if (discoveryService.isDiscovering)
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    IconButton(
                      icon: const Icon(Icons.refresh),
                      onPressed: () => discoveryService.startDiscovery(),
                    ),
                ],
              ),
              const SizedBox(height: 12),

              // Device List
              if (discoveryService.devices.isEmpty)
                Expanded(
                  child: Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.search_off,
                          size: 64,
                          color: Colors.grey.shade400,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '搜尋中...',
                          style: TextStyle(
                            color: Colors.grey.shade600,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '確保 PC Client 正在執行',
                          style: TextStyle(
                            color: Colors.grey.shade500,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              else
                Expanded(
                  child: ListView.builder(
                    itemCount: discoveryService.devices.length,
                    itemBuilder: (context, index) {
                      final device = discoveryService.devices[index];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: _getEmulatorColor(device.emulatorType),
                            child: Icon(
                              _getEmulatorIcon(device.emulatorType),
                              color: Colors.white,
                            ),
                          ),
                          title: Text(device.name),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${device.ip}:${device.port}'),
                              if (device.emulatorType != EmulatorType.unknown)
                                Container(
                                  margin: const EdgeInsets.only(top: 4),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 2,
                                  ),
                                  decoration: BoxDecoration(
                                    color: _getEmulatorColor(device.emulatorType).withValues(alpha: 0.1),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    device.emulatorType.displayName,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: _getEmulatorColor(device.emulatorType),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          trailing: streamingService.isConnecting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.chevron_right),
                          onTap: streamingService.isConnecting
                            ? null
                            : () => _showEmulatorSelector(context, device),
                        ),
                      );
                    },
                  ),
                ),

              const SizedBox(height: 16),
              const Divider(),
              const SizedBox(height: 8),

              // Manual Input Toggle
              Center(
                child: TextButton.icon(
                  icon: const Icon(Icons.keyboard),
                  label: const Text('或手動輸入 IP'),
                  onPressed: () {
                    setState(() {
                      _showManualInput = true;
                    });
                  },
                ),
              ),
            ],

            // Manual Input Section
            if (_showManualInput) ...[
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
                            serverUrl: 'ws://$ip:12000',
                          );
                          
                          if (streamingService.isConnected && context.mounted) {
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

              // Back to Discovery
              Center(
                child: TextButton.icon(
                  icon: const Icon(Icons.wifi_find),
                  label: const Text('返回自動發現'),
                  onPressed: () {
                    setState(() {
                      _showManualInput = false;
                    });
                  },
                ),
              ),
            ],

            // Instructions
            if (_showManualInput)
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

/// 模擬器選擇底部面板
class _EmulatorSelectorSheet extends StatelessWidget {
  final DeviceInfo device;
  final Function(EmulatorType) onConnect;

  const _EmulatorSelectorSheet({
    required this.device,
    required this.onConnect,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 標題
          Row(
            children: [
              const Icon(Icons.smartphone, size: 28),
              const SizedBox(width: 12),
              Text(
                '選擇模擬器',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '選擇要連接的模擬器類型',
            style: TextStyle(color: Colors.grey.shade600),
          ),
          const SizedBox(height: 20),

          // 模擬器列表
          ...EmulatorType.values
              .where((e) => e != EmulatorType.unknown)
              .map((emulator) => _EmulatorListTile(
                    emulator: emulator,
                    isSelected: device.emulatorType == emulator,
                    onTap: () => onConnect(emulator),
                  )),

          const SizedBox(height: 12),

          // 自動偵測選項
          ListTile(
            leading: const CircleAvatar(
              backgroundColor: Colors.grey,
              child: Icon(Icons.auto_awesome, color: Colors.white),
            ),
            title: const Text('自動偵測'),
            subtitle: const Text('讓系統自動選擇合適的模擬器'),
            trailing: device.emulatorType == EmulatorType.unknown
                ? const Icon(Icons.check, color: Colors.green)
                : null,
            onTap: () => onConnect(EmulatorType.unknown),
          ),

          const SizedBox(height: 20),
        ],
      ),
    );
  }
}

/// 模擬器列表項目
class _EmulatorListTile extends StatelessWidget {
  final EmulatorType emulator;
  final bool isSelected;
  final VoidCallback onTap;

  const _EmulatorListTile({
    required this.emulator,
    required this.isSelected,
    required this.onTap,
  });

  Color _getColor() {
    switch (emulator) {
      case EmulatorType.mumu:
        return Colors.blue;
      case EmulatorType.nox:
        return Colors.purple;
      case EmulatorType.ldplayer:
        return Colors.orange;
      case EmulatorType.bluestacks:
        return Colors.green;
      case EmulatorType.genymotion:
        return Colors.teal;
      case EmulatorType.memu:
        return Colors.red;
      case EmulatorType.koplayer:
        return Colors.indigo;
      case EmulatorType.unknown:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: _getColor(),
        child: const Icon(Icons.smartphone, color: Colors.white),
      ),
      title: Text(emulator.displayName),
      trailing: isSelected
          ? const Icon(Icons.check, color: Colors.green)
          : const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}
