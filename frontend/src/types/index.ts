export interface User {
  id: string;
  name: string;
  age: number;
  sex: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
  location: string;
  distance: string;
  distanceKm?: number;
  bio: string;
  images: string[];
  isVerified: boolean;
  interests?: string[];
  languages: string[];
  matchProbability?: number;
  mlFeatures?: {
    interestOverlap: number;
    ageCompatibility: number;
    distanceScore: number;
    profileQuality: number;
    behavioralScore: number;
    collaborativeScore: number;
    mutualLikeProbability: number;
    popularityScore: number;
    activityScore: number;
  };
}

export interface VerificationStatus {
  email: boolean;
  phone: boolean;
  photo: boolean;
  badge: boolean;
}

export interface Match {
  id: string;
  user: User;
  lastMessage?: string;
  timestamp?: string;
  unreadCount?: number;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

export interface Ad {
  adId: string;
  type: 'banner' | 'interstitial' | 'native';
  content: {
    title: string;
    imageUrl: string;
    description?: string;
    cta?: string;
  };
  reward?: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  features: Record<string, boolean>;
}

export interface Filters {
  minAge: number;
  maxAge: number;
  maxDistance: number;
  genderPreference: 'all' | 'male' | 'female' | 'non_binary';
}

export interface LikeUser {
  id: string;
  name?: string;
  age?: number;
  sex?: string;
  location?: string;
  bio?: string;
  images: string[];
  isVerified?: boolean;
  interests?: string[];
  languages?: string[];
  blurred: boolean;
  matchProbability?: number;
}
