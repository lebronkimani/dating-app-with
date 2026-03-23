const API_BASE = '/api';

let userId: string | null = localStorage.getItem('userId');

export function setUserId(id: string) {
  userId = id;
  localStorage.setItem('userId', id);
}

export function getUserId(): string | null {
  return userId;
}

export function clearUser() {
  userId = null;
  localStorage.removeItem('userId');
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };
  
  if (userId) {
    headers['x-user-id'] = userId;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export const api = {
  // Auth Service
  auth: {
    register: (data: { email: string; password: string; name: string; age: number; location?: string; bio?: string; interests?: string[]; languages?: string[] }) =>
      request<{ user: any }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    
    login: (data: { email: string; password: string }) =>
      request<{ user: any }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  },

  // User Service
  users: {
    me: () => request<any>('/users/me'),
    updateMe: (data: { name?: string; age?: number; location?: string; bio?: string; images?: string[]; interests?: string[]; languages?: string[] }) =>
      request<any>('/users/me', { method: 'PUT', body: JSON.stringify(data) }),
    getById: (id: string) => request<any>(`/users/${id}`),
    uploadPhoto: (photoUrl: string) =>
      request<any>('/users/photo', { method: 'POST', body: JSON.stringify({ photo_url: photoUrl }) }),
  },

  // Discovery & Filters
  discovery: {
    discover: () => request<any[]>('/filters/discover'),
    filters: () => request<any>('/filters/filters'),
    updateFilters: (data: { minAge?: number; maxAge?: number; maxDistance?: number; genderPreference?: string }) =>
      request<any>('/filters/filters', { method: 'POST', body: JSON.stringify(data) }),
  },

  // Swipe & Match Service
  swipe: {
    swipe: (swipedUserId: string, direction: 'left' | 'right' | 'super') =>
      request<{ success: boolean; match: boolean }>('/swipe', { method: 'POST', body: JSON.stringify({ swiped_user_id: swipedUserId, direction }) }),
    
    matches: () => request<any[]>('/swipe/matches'),
    
    report: (reportedUserId: string, category: string, description?: string) =>
      request<{ success: boolean }>('/swipe/report', { method: 'POST', body: JSON.stringify({ reported_user_id: reportedUserId, category, description }) }),
    
    superLikeStatus: () => request<any>('/swipe/super-like-status'),
    
    unlockSuperLike: () =>
      request<{ success: boolean }>('/swipe/unlock-super-like', { method: 'POST' }),
    
    upgradePremium: (durationDays?: number) =>
      request<any>('/swipe/upgrade-premium', { method: 'POST', body: JSON.stringify({ durationDays }) }),
  },

  // Likes You Service
  likes: {
    getLikes: () => request<any>('/likes/likes-you'),
    getLikesCount: () => request<{ likesCount: number }>('/likes/likes-you/count'),
    reveal: (likerId: string) =>
      request<any>('/likes/likes-you/reveal', { method: 'POST', body: JSON.stringify({ liker_id: likerId }) }),
    likeBack: (likerId: string) =>
      request<any>('/likes/likes-you/like-back', { method: 'POST', body: JSON.stringify({ liker_id: likerId }) }),
    revealStatus: () => request<any>('/likes/likes-you/reveal-status'),
  },

  // Messaging Service
  messages: {
    get: (matchId: string) =>
      request<any[]>(`/messages/${matchId}`),
    
    send: (matchId: string, text: string) =>
      request<any>(`/messages/${matchId}`, { method: 'POST', body: JSON.stringify({ text }) }),
    
    getConversations: () => request<any[]>('/messages/conversations'),
  },

  // Notification Service
  notifications: {
    get: (limit?: number, offset?: number) =>
      request<any[]>(`/notifications?limit=${limit || 50}&offset=${offset || 0}`),
    
    unreadCount: () => request<{ count: number }>('/notifications/unread-count'),
    
    markAsRead: (notificationId: string) =>
      request<{ success: boolean }>(`/notifications/${notificationId}/read`, { method: 'PUT' }),
    
    markAllAsRead: () =>
      request<{ success: boolean }>('/notifications/read-all', { method: 'PUT' }),
    
    delete: (notificationId: string) =>
      request<{ success: boolean }>(`/notifications/${notificationId}`, { method: 'DELETE' }),
  },

  // Subscription Service
  subscription: {
    getPlans: () => request<any[]>('/subscription/plans'),
    
    getStatus: () => request<any>('/subscription/status'),
    
    subscribe: (planId: string, paymentMethod?: string) =>
      request<any>('/subscription/subscribe', { method: 'POST', body: JSON.stringify({ planId, paymentMethod }) }),
    
    cancel: () =>
      request<{ success: boolean }>('/subscription/cancel', { method: 'POST' }),
  },

  // Ads Service
  ads: {
    getAd: (placement: string) =>
      request<any>(`/ad-placement/${placement}`),
    
    getConfig: () =>
      request<any>('/ad-placement/config'),
    
    recordClick: (adId: string) =>
      request<{ success: boolean }>(`/ad-placement/click/${adId}`, { method: 'POST' }),
    
    recordImpression: (adId: string, placement: string) =>
      request<{ success: boolean }>(`/ad-placement/impression/${adId}`, { method: 'POST', body: JSON.stringify({ placement }) }),
    
    recordSwipe: () =>
      request<{ success: boolean }>('/ad-placement/swipe', { method: 'POST' }),
    
    startSession: () =>
      request<{ success: boolean }>('/ad-placement/session/start', { method: 'POST' }),
  },

  // Location Service
  location: {
    update: (latitude: number, longitude: number) =>
      request<any>('/location', { method: 'POST', body: JSON.stringify({ latitude, longitude }) }),
    
    getNearby: (latitude: number, longitude: number, radiusKm: number) =>
      request<any[]>(`/location/nearby?lat=${latitude}&lon=${longitude}&radius=${radiusKm}`),
  },

  // Presence Service
  presence: {
    setOnline: () => request<{ success: boolean }>('/presence/online', { method: 'POST' }),
    setOffline: () => request<{ success: boolean }>('/presence/offline', { method: 'POST' }),
    getOnlineUsers: () => request<string[]>('/presence/online'),
  },

  // Verification Service
  verification: {
    sendEmailCode: (email: string) =>
      request<{ success: boolean }>('/verification/email/send', { method: 'POST', body: JSON.stringify({ email }) }),
    
    verifyEmailCode: (code: string) =>
      request<{ success: boolean }>('/verification/email/verify', { method: 'POST', body: JSON.stringify({ code }) }),
    
    sendPhoneCode: (phone: string) =>
      request<{ success: boolean }>('/verification/phone/send', { method: 'POST', body: JSON.stringify({ phone }) }),
    
    verifyPhoneCode: (code: string) =>
      request<{ success: boolean }>('/verification/phone/verify', { method: 'POST', body: JSON.stringify({ code }) }),
    
    getStatus: () => request<any>('/verification/status'),
    
    startPhotoVerification: () =>
      request<any>('/verification/photo/start', { method: 'POST' }),
    
    verifyPhoto: (selfieData: string) =>
      request<any>('/verification/photo/verify', { method: 'POST', body: JSON.stringify({ selfie_data: selfieData }) }),
  },

  // ML Recommendation Service
  ml: {
    init: () => request<{ status: string }>('/ml/init', { method: 'POST' }),
    
    refresh: () => request<{ status: string }>('/ml/refresh', { method: 'POST' }),
    
    coldStart: (userId: string) =>
      request<any>(`/ml/cold-start/${userId}`),
    
    similarUsers: (userId: string, limit?: number) =>
      request<any[]>(`/ml/similar/${userId}?limit=${limit || 10}`),
    
    matchProbability: (userId1: string, userId2: string) =>
      request<{ probability: number }>(`/ml/match-probability/${userId1}/${userId2}`),
    
    ranking: (userId: string) =>
      request<any>(`/ml/rank/discover/${userId}`),
    
    segments: (userId: string) =>
      request<any>(`/ml/segments/${userId}`),
    
    embeddingStats: () => request<any>('/ml/embeddings/stats'),
    
    embeddingSimilar: (userId: string, limit?: number) =>
      request<any[]>(`/ml/embeddings/similar/${userId}?limit=${limit || 10}`),
    
    embeddingCompatibility: (userId1: string, userId2: string) =>
      request<any>(`/ml/embeddings/compatibility/${userId1}/${userId2}`),
    
    twoTowerStats: () => request<any>('/ml/two-tower/stats'),
    
    twoTowerCompatibility: (userId1: string, userId2: string) =>
      request<any>(`/ml/two-tower/compatibility/${userId1}/${userId2}`),
    
    graphSimilar: (userId: string, depth?: number) =>
      request<any>(`/ml/two-tower/graph-similar/${userId}?depth=${depth || 3}`),
    
    rlStats: () => request<any>('/ml/rl/stats'),
    
    rlSuggestions: (userId: string) =>
      request<any>(`/ml/rl/suggestions/${userId}`),
    
    updateRLPolicy: (userId: string, match?: boolean, conversation?: boolean, messageReply?: boolean, longChat?: boolean) =>
      request<{ success: boolean }>('/ml/rl/update-policy', { method: 'POST', body: JSON.stringify({ userId, match, conversation, messageReply, longChat }) }),
  },

  // Monitoring & Observability
  monitoring: {
    health: () => request<any>('/monitoring/health'),
    metrics: (name?: string) => request<any>(`/monitoring/metrics${name ? `?name=${name}` : ''}`),
    logs: (level?: string, limit?: number) =>
      request<any>(`/monitoring/logs?${level ? `level=${level}&` : ''}limit=${limit || 100}`),
    alerts: () => request<any[]>('/monitoring/alerts'),
    acknowledgeAlert: (alertId: string) =>
      request<{ success: boolean }>(`/monitoring/alerts/${alertId}/acknowledge`, { method: 'POST' }),
  },

  // Vector Database
  vector: {
    stats: () => request<any>('/vector/stats'),
    search: (userId: string, topK?: number) =>
      request<any>(`/vector/search/${userId}?topK=${topK || 10}`),
  },

  // Feature Store
  features: {
    get: (userId: string, refresh?: boolean) =>
      request<any>(`/features/${userId}${refresh ? '?refresh=true' : ''}`),
    getMetadata: (userId: string) =>
      request<any>(`/features/${userId}/metadata`),
  },

  // Kafka Events
  kafka: {
    topics: () => request<any[]>('/kafka/topics'),
    consumers: () => request<any>('/kafka/consumers'),
  },

  // Health Check
  health: () => request<any>('/health'),
};
