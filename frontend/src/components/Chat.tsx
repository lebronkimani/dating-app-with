import { useState, useEffect, useRef } from "react";
import { Message, User } from "../types";
import { getUserId, api } from "../api";
import { Send, ArrowLeft, Circle } from "lucide-react";

interface ChatProps {
  user: User;
  matchId: string;
  onBack: () => void;
  isPremium: boolean;
}

interface WSMessage {
  type: 'message' | 'typing' | 'online' | 'offline' | 'read';
  matchId?: string;
  senderId?: string;
  text?: string;
  timestamp?: string;
  userId?: string;
}

export default function Chat({ user, matchId, onBack, isPremium }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const userId = getUserId();

  useEffect(() => {
    loadMessages();
    checkOnlineStatus();
    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [matchId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/messages/${matchId}`, {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const checkOnlineStatus = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/presence/online/${user.id}`, {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        setIsOnline(data.online);
      }
    } catch (error) {
      console.error('Failed to check online status:', error);
    }
  };

  const connectWebSocket = () => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//localhost:3001/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('WebSocket connected');
      socket.send(JSON.stringify({ type: 'auth', userId: userId }));
      socket.send(JSON.stringify({ type: 'join', matchId }));
    };

    socket.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        handleWSMessage(message);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setWs(socket);
  };

  const handleWSMessage = (message: WSMessage) => {
    switch (message.type) {
      case 'message':
        if (message.matchId === matchId && message.senderId !== userId) {
          setMessages(prev => [...prev, {
            id: message.id || Date.now().toString(),
            senderId: message.senderId!,
            text: message.text!,
            timestamp: message.timestamp || new Date().toISOString()
          }]);
        }
        break;
      case 'typing':
        if (message.matchId === matchId && message.senderId !== userId) {
          setIsTyping(true);
          setTimeout(() => setIsTyping(false), 3000);
        }
        break;
      case 'online':
        if (message.userId === user.id) {
          setIsOnline(true);
        }
        break;
      case 'offline':
        if (message.userId === user.id) {
          setIsOnline(false);
        }
        break;
      case 'read':
        setMessages(prev => prev.map(m => 
          m.senderId !== userId ? { ...m, isRead: true } : m
        ));
        break;
    }
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !ws || ws.readyState !== WebSocket.OPEN) return;

    const message: WSMessage = {
      type: 'message',
      matchId,
      text: newMessage.trim()
    };

    ws.send(JSON.stringify(message));
    
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      senderId: userId!,
      text: newMessage.trim(),
      timestamp: new Date().toISOString()
    }]);

    setNewMessage("");
  };

  const handleTyping = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({ type: 'typing', matchId }));

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString();
  };

  const groupMessagesByDate = (msgs: Message[]) => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';

    msgs.forEach(msg => {
      const msgDate = new Date(msg.timestamp).toDateString();
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({ date: formatDate(msg.timestamp), messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });

    return groups;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white shadow-sm px-4 py-3 flex items-center gap-3 z-10">
        <button onClick={onBack} className="p-1 -ml-1 hover:bg-gray-100 rounded-full">
          <ArrowLeft className="w-6 h-6 text-gray-700" />
        </button>
        
        <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
          {user.images?.[0] ? (
            <img src={user.images[0]} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-pink-500 text-white text-lg font-semibold">
              {user.name?.[0]?.toUpperCase()}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate">{user.name}</div>
          <div className="text-sm text-gray-500 flex items-center gap-1">
            {isOnline ? (
              <>
                <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                <span className="text-green-600">Online</span>
              </>
            ) : (
              <span className="text-gray-400">Offline</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {groupMessagesByDate(messages).map((group, groupIdx) => (
          <div key={groupIdx}>
            <div className="text-center text-xs text-gray-400 my-4">
              {group.date}
            </div>
            {group.messages.map((message) => {
              const isOwn = message.senderId === userId;
              return (
                <div
                  key={message.id}
                  className={`flex mb-3 ${isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] px-4 py-2 rounded-2xl ${
                      isOwn
                        ? 'bg-pink-500 text-white rounded-br-md'
                        : 'bg-white text-gray-900 shadow-sm rounded-bl-md'
                    }`}
                  >
                    <p className="text-sm">{message.text}</p>
                    <div className={`flex items-center justify-end gap-1 mt-1 ${
                      isOwn ? 'text-pink-100' : 'text-gray-400'
                    }`}>
                      <span className="text-xs">{formatTime(message.timestamp)}</span>
                      {isOwn && message.isRead && (
                        <span className="text-xs">✓✓</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start mb-3">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-md shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="bg-white border-t px-4 py-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-2">
            <textarea
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                handleTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Type a message..."
              className="w-full bg-transparent resize-none outline-none text-sm max-h-32"
              rows={1}
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!newMessage.trim()}
            className="p-3 bg-pink-500 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pink-600 transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
