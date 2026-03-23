import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { generateId } from '../db/init';
import { authService } from './auth';

interface WSClient {
  ws: WebSocket;
  userId: string;
  matchId?: string;
  isAlive: boolean;
  authenticated: boolean;
}

interface ChatMessage {
  type: 'auth' | 'message' | 'typing' | 'online' | 'offline' | 'read' | 'match';
  matchId?: string;
  senderId?: string;
  text?: string;
  timestamp?: string;
  userId?: string;
  token?: string;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private matchRooms: Map<string, Set<string>> = new Map();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = generateId();
      const ip = req.socket.remoteAddress;
      console.log(`WebSocket client connected: ${clientId} from ${ip}`);

      this.clients.set(clientId, { ws, userId: '', isAlive: true, authenticated: false });

      ws.on('message', (data: Buffer) => {
        try {
          const message: ChatMessage = JSON.parse(data.toString());
          this.handleMessage(clientId, ws, message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('pong', () => {
        const client = this.clients.get(clientId);
        if (client) {
          client.isAlive = true;
        }
      });
    });

    this.startHeartbeat();
    console.log('WebSocket Service initialized');
  }

  private handleMessage(clientId: string, ws: WebSocket, message: ChatMessage) {
    switch (message.type) {
      case 'auth':
        this.handleAuth(clientId, ws, message.userId!, message.token!);
        break;
      case 'join':
        this.handleJoin(clientId, message.matchId!);
        break;
      case 'leave':
        this.handleLeave(clientId);
        break;
      case 'message':
        this.handleChatMessage(clientId, message);
        break;
      case 'typing':
        this.handleTyping(clientId, message);
        break;
      case 'read':
        this.handleRead(clientId, message);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }

  private async handleAuth(clientId: string, ws: WebSocket, userId: string, token?: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (!token || !userId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Token and userId required' }));
      ws.close(4001, 'Authentication required');
      return;
    }

    const payload = await authService.verifyAccessToken(token);
    if (!payload || payload.userId !== userId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
      ws.close(4001, 'Invalid token');
      return;
    }

    client.userId = userId;
    client.authenticated = true;
    client.isAlive = true;

    console.log(`User ${userId} authenticated on WebSocket`);
    this.broadcastOnlineStatus(userId);
    ws.send(JSON.stringify({ type: 'auth_success', userId }));
  }

  private isAuthenticated(clientId: string): boolean {
    const client = this.clients.get(clientId);
    return client?.authenticated === true;
  }

  private handleJoin(clientId: string, matchId: string) {
    if (!this.isAuthenticated(clientId)) {
      return;
    }
    
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.matchId && this.matchRooms.has(client.matchId)) {
      this.matchRooms.get(client.matchId)!.delete(clientId);
    }

    client.matchId = matchId;

    if (!this.matchRooms.has(matchId)) {
      this.matchRooms.set(matchId, new Set());
    }
    this.matchRooms.get(matchId)!.add(clientId);

    console.log(`Client ${clientId} joined room ${matchId}`);
  }

  private handleLeave(clientId: string) {
    if (!this.isAuthenticated(clientId)) {
      return;
    }
    
    const client = this.clients.get(clientId);
    if (!client || !client.matchId) return;

    const room = this.matchRooms.get(client.matchId);
    if (room) {
      room.delete(clientId);
      if (room.size === 0) {
        this.matchRooms.delete(client.matchId);
      }
    }
    client.matchId = undefined;
  }

  private async handleChatMessage(clientId: string, message: ChatMessage) {
    if (!this.isAuthenticated(clientId)) {
      return;
    }
    
    const client = this.clients.get(clientId);
    if (!client || !message.matchId) return;

    const { getPool } = await import('../db/init');
    const pool = getPool();

    const result = await pool.query(
      `INSERT INTO messages (match_id, sender_id, text) VALUES ($1, $2, $3)
       RETURNING *`,
      [message.matchId, client.userId, message.text]
    );

    const savedMessage = result.rows[0];
    const chatMessage: ChatMessage = {
      type: 'message',
      matchId: message.matchId,
      senderId: client.userId,
      text: message.text,
      timestamp: savedMessage.created_at
    };

    this.broadcastToRoom(message.matchId, chatMessage, clientId);

    this.notifyMatchUser(message.matchId, client.userId, chatMessage);
  }

  private handleTyping(clientId: string, message: ChatMessage) {
    if (!this.isAuthenticated(clientId)) {
      return;
    }
    
    const client = this.clients.get(clientId);
    if (!client || !message.matchId) return;

    const typingMessage: ChatMessage = {
      type: 'typing',
      matchId: message.matchId,
      senderId: client.userId
    };

    this.broadcastToRoom(message.matchId, typingMessage, clientId);
  }

  private async handleRead(clientId: string, message: ChatMessage) {
    if (!this.isAuthenticated(clientId)) {
      return;
    }
    
    const client = this.clients.get(clientId);
    if (!client || !message.matchId) return;

    const { getPool } = await import('../db/init');
    const pool = getPool();

    await pool.query(
      `UPDATE messages SET read = true 
       WHERE match_id = $1 AND sender_id != $2`,
      [message.matchId, client.userId]
    );

    const readMessage: ChatMessage = {
      type: 'read',
      matchId: message.matchId,
      senderId: client.userId
    };

    this.broadcastToRoom(message.matchId, readMessage, clientId);
  }

  private handleDisconnect(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      if (client.matchId) {
        this.handleLeave(clientId);
      }
      this.broadcastOnlineStatus(client.userId, false);
      this.clients.delete(clientId);
    }
    console.log(`WebSocket client disconnected: ${clientId}`);
  }

  private broadcastToRoom(matchId: string, message: ChatMessage, excludeClientId?: string) {
    const room = this.matchRooms.get(matchId);
    if (!room) return;

    const data = JSON.stringify(message);
    room.forEach(clientId => {
      if (clientId !== excludeClientId) {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(data);
        }
      }
    });
  }

  private async notifyMatchUser(matchId: string, excludeUserId: string, message: ChatMessage) {
    for (const client of this.clients.values()) {
      if (client.userId !== excludeUserId && client.matchId === matchId) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(message));
        }
      }
    }
  }

  private broadcastOnlineStatus(userId: string, isOnline: boolean = true) {
    const statusMessage: ChatMessage = {
      type: isOnline ? 'online' : 'offline',
      userId
    };

    for (const client of this.clients.values()) {
      if (client.userId === userId) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(statusMessage));
      }
    }
  }

  isUserOnline(userId: string): boolean {
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  getOnlineUsers(): string[] {
    const onlineUsers: string[] = [];
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN && !onlineUsers.includes(client.userId)) {
        onlineUsers.push(client.userId);
      }
    }
    return onlineUsers;
  }

  private startHeartbeat() {
    setInterval(() => {
      this.wss?.clients.forEach((ws: WebSocket) => {
        const client = Array.from(this.clients.values()).find(c => c.ws === ws);
        if (client) {
          if (client.isAlive === false) {
            this.handleDisconnect(Array.from(this.clients.keys()).find(key => this.clients.get(key) === client)!);
            return;
          }
          client.isAlive = false;
          ws.ping();
        }
      });
    }, 30000);
  }

  getOnlineStatusForUsers(userIds: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    userIds.forEach(userId => {
      result[userId] = this.isUserOnline(userId);
    });
    return result;
  }
}

export const wsService = new WebSocketService();
export default wsService;
