import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AuthService extends ChangeNotifier {
  bool _isLoggedIn = false;
  String _userEmail = '';
  String _userId = '';

  bool get isLoggedIn => _isLoggedIn;
  String get userEmail => _userEmail;
  String get userId => _userId;

  AuthService() {
    _loadStoredAuth();
  }

  Future<void> _loadStoredAuth() async {
    final prefs = await SharedPreferences.getInstance();
    _userEmail = prefs.getString('userEmail') ?? '';
    _userId = prefs.getString('userId') ?? '';
    _isLoggedIn = _userEmail.isNotEmpty;
    notifyListeners();
  }

  Future<void> login(String email) async {
    // TODO: Implement actual authentication with backend
    // For POC, we'll just store the email locally
    
    // Simulate API call
    await Future.delayed(const Duration(seconds: 1));
    
    _userEmail = email;
    _userId = 'user_${DateTime.now().millisecondsSinceEpoch}';
    _isLoggedIn = true;

    // Store locally
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('userEmail', _userEmail);
    await prefs.setString('userId', _userId);

    notifyListeners();
  }

  Future<void> logout() async {
    _userEmail = '';
    _userId = '';
    _isLoggedIn = false;

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('userEmail');
    await prefs.remove('userId');

    notifyListeners();
  }

  Future<String?> getAuthToken() async {
    if (!_isLoggedIn) return null;
    // TODO: Return actual JWT token from backend
    return _userId;
  }
}
