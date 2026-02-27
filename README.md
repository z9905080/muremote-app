# MuRemote App

> POC - 遠端控制 MuMu 模擬器

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 產品概述

MuRemote 是一款讓您可以透過手機遠端控制電腦上的 MuMu 模擬器的應用程式。

### 特色

- 📱 手機遠端控制 MuMu 模擬器
- 🎮 低延遲操作體驗
- 🔒 帳號綁定安全驗證
- 🖥️ 跨平台支援

### 競爭對手

- OSLink (僅支援雷電模擬器)
- **MuRemote** 支援 MuMu 模擬器 🎯

---

## 專案結構

```
muremote-app/
├── mobile/           # 手機 APP (Flutter)
│   ├── lib/
│   │   ├── screens/    # 畫面
│   │   ├── services/    # 服務 (WebRTC, Auth)
│   │   └── main.dart
│   └── pubspec.yaml
│
├── pc/              # PC Client (Electron)
│   ├── src/
│   │   ├── main/       # 主程序
│   │   ├── preload/     # 預加載
│   │   └── renderer/    # UI
│   └── package.json
│
├── docs/             # 文件
└── README.md
```

---

## 開發指南

### 前置需求

- Flutter SDK 3.0+
- Node.js 18+
- Electron 28+

### 安裝

#### 手機 APP

```bash
cd mobile
flutter pub get
flutter run
```

#### PC Client

```bash
cd pc
npm install
npm start
```

---

## 技術架構

### 手機端
- **Framework**: Flutter
- **串流**: WebRTC
- **狀態管理**: Provider

### PC 端
- **Framework**: Electron
- **控制協議**: ADB (Android Debug Bridge)
- **通訊**: WebSocket

---

## Roadmap

### Phase 1 (POC)
- [x] 專案規劃
- [x] 基礎架構
- [ ] 技術驗證 (ADB + 螢幕串流)
- [ ] 原型開發

### Phase 2
- [ ] 優化延遲
- [ ] 增加畫質選項
- [ ] 多開支援

---

## 授權

MIT License - see [LICENSE](LICENSE) for details.

---

## 聯繫

- 問題回報: GitHub Issues
