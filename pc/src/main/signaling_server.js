/**
 * Signaling Server (Signaling Server)
 * 用於 WebRTC P2P 連線的訊號交換
 * POC 階段使用，長期可考慮自建
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const log = require('electron-log');

class SignalingServer {
  constructor(port = 8081) {
    this.port = port;
    this.wss = null;
    this.clients = new Map(); // clientId -> { ws, pcId, mobileId }
    this.rooms = new Map();  // roomId -> { pc, mobile }
  }

  /**
   * 啟動訊號伺服器
   */
  start() {
    this.wss = new WebSocket.Server({ port: this.port });

    this.wss.on('connection', (ws, req) => {
      const clientId = uuidv4();
      log.info('New signaling client:', clientId);

      this.clients.set(clientId, { ws, pcId: null, mobileId: null });

      ws.on('message', (message) => {
        this.handleMessage(clientId, message);
      });

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('error', (error) => {
        log.error('WebSocket error:', error);
      });

      // 發送 clientId 給客戶端
      this.send(clientId, {
        type: 'registered',
        clientId: clientId
      });
    });

    log.info(`Signaling server started on port ${this.port}`);
  }

  /**
   * 處理訊息
   */
  handleMessage(clientId, message) {
    try {
      const data = JSON.parse(message);
      const client = this.clients.get(clientId);
      
      if (!client) return;

      switch (data.type) {
        case 'register-pc':
          // PC 客戶端註冊
          client.pcId = data.pcId;
          client.isPC = true;
          log.info(`PC registered: ${client.pcId}`);
          break;

        case 'register-mobile':
          // 手機客戶端註冊
          client.mobileId = data.mobileId;
          client.isMobile = true;
          log.info(`Mobile registered: ${client.mobileId}`);
          break;

        case 'offer':
          // WebRTC offer - 轉發給對方
          this.forwardToPeer(clientId, {
            type: 'offer',
            sdp: data.sdp,
            from: clientId
          });
          break;

        case 'answer':
          // WebRTC answer - 轉發給對方
          this.forwardToPeer(clientId, {
            type: 'answer',
            sdp: data.sdp,
            from: clientId
          });
          break;

        case 'ice-candidate':
          // ICE candidate - 轉發給對方
          this.forwardToPeer(clientId, {
            type: 'ice-candidate',
            candidate: data.candidate,
            from: clientId
          });
          break;

        case 'join-room':
          // 加入房間 (配對)
          this.handleJoinRoom(clientId, data.roomId);
          break;

        case 'leave-room':
          // 離開房間
          this.handleLeaveRoom(clientId);
          break;

        default:
          log.warn('Unknown message type:', data.type);
      }
    } catch (e) {
      log.error('Message parse error:', e);
    }
  }

  /**
   * 轉發訊息給對等端
   */
  forwardToPeer(fromClientId, message) {
    const fromClient = this.clients.get(fromClientId);
    if (!fromClient) return;

    // 找到對應的客戶端
    for (const [clientId, client] of this.clients) {
      if (clientId === fromClientId) continue;

      // 如果是 PC，找手機；如果是手機，找 PC
      if (fromClient.isPC && client.isMobile) {
        this.send(clientId, message);
        return;
      } else if (fromClient.isMobile && client.isPC) {
        this.send(clientId, message);
        return;
      }
    }

    log.warn('Peer not found for forwarding');
  }

  /**
   * 加入房間
   */
  handleJoinRoom(clientId, roomId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // 創建房間或加入現有房間
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { pc: null, mobile: null });
    }

    const room = this.rooms.get(roomId);

    // 根據客戶端類型加入
    if (client.isPC) {
      room.pc = clientId;
    } else if (client.isMobile) {
      room.mobile = clientId;
    }

    client.roomId = roomId;

    // 通知客戶端加入成功
    this.send(clientId, {
      type: 'room-joined',
      roomId: roomId,
      role: client.isPC ? 'pc' : 'mobile'
    });

    // 如果房間裡有雙方，通知它們可以開始 WebRTC 連線
    if (room.pc && room.mobile) {
      this.send(room.pc, {
        type: 'peer-ready',
        peerId: room.mobile
      });
      this.send(room.mobile, {
        type: 'peer-ready',
        peerId: room.pc
      });
    }

    log.info(`Client ${clientId} joined room ${roomId}`);
  }

  /**
   * 離開房間
   */
  handleLeaveRoom(clientId) {
    const client = this.clients.get(clientId);
    if (!client || !client.roomId) return;

    const roomId = client.roomId;
    const room = this.rooms.get(roomId);

    if (room) {
      if (room.pc === clientId) room.pc = null;
      if (room.mobile === clientId) room.mobile = null;

      // 通知房間裡的另一方
      const otherClientId = room.pc || room.mobile;
      if (otherClientId) {
        this.send(otherClientId, {
          type: 'peer-left',
          roomId: roomId
        });
      }

      // 如果房間空了，刪除房間
      if (!room.pc && !room.mobile) {
        this.rooms.delete(roomId);
      }
    }

    client.roomId = null;
    log.info(`Client ${clientId} left room ${roomId}`);
  }

  /**
   * 處理斷線
   */
  handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    
    if (client) {
      // 如果在房間裡，離開房間
      if (client.roomId) {
        this.handleLeaveRoom(clientId);
      }

      log.info(`Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
    }
  }

  /**
   * 發送訊息給客戶端
   */
  send(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * 停止伺服器
   */
  stop() {
    if (this.wss) {
      this.wss.close();
      log.info('Signaling server stopped');
    }
  }

  /**
   * 獲取統計資訊
   */
  getStats() {
    return {
      totalClients: this.clients.size,
      rooms: this.rooms.size,
      clients: Array.from(this.clients.values()).map(c => ({
        pcId: c.pcId,
        mobileId: c.mobileId,
        roomId: c.roomId
      }))
    };
  }
}

module.exports = SignalingServer;
