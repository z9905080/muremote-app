import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final authService = context.watch<AuthService>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('MuRemote'),
        centerTitle: true,
        backgroundColor: Colors.blue.shade700,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.pushNamed(context, '/settings'),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Logo
              Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                  color: Colors.blue.shade100,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Icon(
                  Icons.phone_android,
                  size: 60,
                  color: Colors.blue.shade700,
                ),
              ),
              const SizedBox(height: 32),
              
              // Title
              Text(
                'MuRemote',
                style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: Colors.blue.shade800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '遠端控制 MuMu 模擬器',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
              ),
              const SizedBox(height: 48),

              // Connect Button
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  onPressed: () {
                    if (authService.isLoggedIn) {
                      Navigator.pushNamed(context, '/connect');
                    } else {
                      // Show login dialog
                      _showLoginDialog(context);
                    }
                  },
                  icon: const Icon(Icons.link, size: 28),
                  label: Text(
                    authService.isLoggedIn ? '連線' : '登入',
                    style: const TextStyle(fontSize: 18),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue.shade700,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Status
              if (authService.isLoggedIn)
                Text(
                  '已登入: ${authService.userEmail}',
                  style: TextStyle(color: Colors.grey.shade600),
                ),
            ],
          ),
        ),
      ),
    );
  }

  void _showLoginDialog(BuildContext context) {
    final emailController = TextEditingController();
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('登入'),
        content: TextField(
          controller: emailController,
          decoration: const InputDecoration(
            labelText: 'Email',
            border: OutlineInputBorder(),
          ),
          keyboardType: TextInputType.emailAddress,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () {
              if (emailController.text.isNotEmpty) {
                context.read<AuthService>().login(emailController.text);
                Navigator.pop(context);
              }
            },
            child: const Text('登入'),
          ),
        ],
      ),
    );
  }
}
