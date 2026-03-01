/**
 * Device Discovery Service - 設備發現服務
 * 使用 mDNS/Bonjour 自動發現區域網路中的 PC Client
 */

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:bonjour/bonjour.dart';

/// 模擬器類型
enum EmulatorType {
  mumu('MuMu 模擬器', 'mumu'),
  nox('夜神模擬器', 'nox'),
  ldplayer('雷電模擬器', 'ldplayer'),
  bluestacks('BlueStacks', 'bluestacks'),
  genymotion('Genymotion', 'genymotion'),
  memu('逍遙模擬器', 'memu'),
  koplayer('KOPlayer', 'koplator'),
  unknown('未知', 'unknown');

  final String displayName;
  final String key;
  const EmulatorType(this.displayName, this.key);

  static EmulatorType fromString(String? value) {
    if (value == null) return EmulatorType.unknown;
    return EmulatorType.values.firstWhere(
      (e) => e.key.toLowerCase() == value.toLowerCase(),
      orElse: () => EmulatorType.unknown,
    );
  }
}

class DeviceInfo {
  final String name;
  final String pcId;
  final String ip;
  final int port;
  final String host;
  final EmulatorType emulatorType;

  DeviceInfo({
    required this.name,
    required this.pcId,
    required this.ip,
    required this.port,
    required this.host,
    this.emulatorType = EmulatorType.unknown,
  });

  factory DeviceInfo.fromJson(Map<String, dynamic> json) {
    return DeviceInfo(
      name: json['name'] ?? 'Unknown',
      pcId: json['pcId'] ?? '',
      ip: json['ip'] ?? '',
      port: json['port'] ?? 12000,
      host: json['host'] ?? '',
      emulatorType: EmulatorType.fromString(json['emulatorType']),
    );
  }

  /// 從 mDNS TXT 記錄解析設備信息
  factory DeviceInfo.fromTxt(Map<String, String> txt, String host, int port) {
    return DeviceInfo(
      name: txt['name'] ?? 'MuRemote',
      pcId: txt['pcId'] ?? '',
      ip: host,
      port: port,
      host: host,
      emulatorType: EmulatorType.fromString(txt['emulatorType']),
    );
  }

  @override
  String toString() => 'DeviceInfo($name, $pcId, $ip:$port, $emulatorType)';
}

class DiscoveryService extends ChangeNotifier {
  final Discover _discover = Discover();
  Stream? _browseStream;
  Timer? _refreshTimer;
  
  List<DeviceInfo> _devices = [];
  bool _isDiscovering = false;
  String _serviceType = '_muremote._tcp';

  List<DeviceInfo> get devices => _devices;
  bool get isDiscovering => _isDiscovering;

  /**
   * 開始發現設備
   */
  Future<void> startDiscovery({String? serviceType}) async {
    if (_isDiscovering) return;
    
    _isDiscovering = true;
    if (serviceType != null) _serviceType = serviceType;
    notifyListeners();

    try {
      // 使用 Bonjour 發現設備
      _browseStream = _discover.browse(_serviceType);
      
      _browseStream!.listen(
        (service) {
          _handleServiceFound(service);
        },
        onError: (error) {
          debugPrint('Discovery error: $error');
          _isDiscovering = false;
          notifyListeners();
        },
        onDone: () {
          debugPrint('Discovery done');
          _isDiscovering = false;
          notifyListeners();
        },
      );

      // 每 30 秒刷新一次設備列表
      _refreshTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => _cleanStaleDevices(),
      );
      
    } catch (e) {
      debugPrint('Start discovery error: $e');
      _isDiscovering = false;
      notifyListeners();
    }
  }

  /**
   * 處理發現的服務
   */
  void _handleServiceFound(Service service) {
    debugPrint('Found service: ${service.name} at ${service.host}:${service.port}');
    
    // 嘗試從 TXT 記錄獲取 PC ID 和模擬器類型
    String pcId = '';
    String emulatorType = 'unknown';
    if (service.txt != null) {
      pcId = service.txt!['pcId'] ?? '';
      emulatorType = service.txt!['emulatorType'] ?? 'unknown';
    }

    // 如果沒有 PC ID，從名稱解析
    final device = DeviceInfo(
      name: service.name,
      pcId: pcId.isNotEmpty ? pcId : _extractPcId(service.name),
      ip: service.host ?? '',
      port: service.port ?? 12000,
      host: service.name,
      emulatorType: EmulatorType.fromString(emulatorType),
    );

    // 更新或添加設備
    final existingIndex = _devices.indexWhere((d) => d.host == device.host);
    if (existingIndex >= 0) {
      _devices[existingIndex] = device;
    } else {
      _devices.add(device);
    }

    notifyListeners();
  }

  /**
   * 從服務名稱提取 PC ID
   */
  String _extractPcId(String name) {
    // 假設格式: MuRemote-ABC123
    final parts = name.split('-');
    return parts.length > 1 ? parts.last : name;
  }

  /**
   * 清理超時設備
   */
  void _cleanStaleDevices() {
    // 刷新時重新發現
    debugPrint('Refreshing device list...');
  }

  /**
   * 停止發現
   */
  void stopDiscovery() {
    _browseStream = null;
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _isDiscovering = false;
    notifyListeners();
    debugPrint('Discovery stopped');
  }

  /**
   * 手動添加設備
   */
  void addDevice(DeviceInfo device) {
    if (!_devices.any((d) => d.ip == device.ip && d.port == device.port)) {
      _devices.add(device);
      notifyListeners();
    }
  }

  /**
   * 移除設備
   */
  void removeDevice(String host) {
    _devices.removeWhere((d) => d.host == host);
    notifyListeners();
  }

  /**
   * 測試設備連接
   */
  Future<bool> testConnection(DeviceInfo device) async {
    try {
      final ws = await WebSocket.connect(
        'ws://${device.ip}:${device.port}',
      ).timeout(const Duration(seconds: 5));
      
      await ws.close();
      return true;
    } catch (e) {
      debugPrint('Connection test failed: $e');
      return false;
    }
  }

  @override
  void dispose() {
    stopDiscovery();
    super.dispose();
  }
}
