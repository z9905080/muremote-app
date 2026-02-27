import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/webrtc_service.dart';
import 'services/streaming_service.dart';
import 'services/auth_service.dart';
import 'services/discovery_service.dart';
import 'screens/home_screen.dart';
import 'screens/connection_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/streaming_screen.dart';

void main() {
  runApp(const MuRemoteApp());
}

class MuRemoteApp extends StatelessWidget {
  const MuRemoteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthService()),
        ChangeNotifierProvider(create: (_) => WebRTCService()),
        ChangeNotifierProvider(create: (_) => StreamingService()),
        ChangeNotifierProvider(create: (_) => DiscoveryService()),
      ],
      child: MaterialApp(
        title: 'MuRemote',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
          useMaterial3: true,
        ),
        home: const HomeScreen(),
        routes: {
          '/connect': (context) => const ConnectionScreen(),
          '/settings': (context) => const SettingsScreen(),
          '/stream': (context) => const StreamingScreen(),
        },
      ),
    );
  }
}
