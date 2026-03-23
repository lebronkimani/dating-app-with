import { useState, useEffect } from "react";
import BottomNav from "./components/BottomNav";
import Discovery from "./components/Discovery";
import Matches from "./components/Matches";
import LikesYou from "./components/LikesYou";
import Profile from "./components/Profile";
import Chat from "./components/Chat";
import Auth from "./components/Auth";
import BannerAd from "./components/BannerAd";
import { User } from "./types";
import { api, setUserId, getUserId, clearUser } from "./api";

interface ActiveChat {
  user: User;
  matchId: string;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "discovery" | "matches" | "likes" | "profile"
  >("discovery");
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [likesCount, setLikesCount] = useState(0);

  useEffect(() => {
    const userId = getUserId();
    if (userId) {
      api.users.me()
        .then(() => setIsAuthenticated(true))
        .catch(() => clearUser())
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadLikesCount();
    }
  }, [isAuthenticated]);

  const loadLikesCount = async () => {
    try {
      const userId = getUserId();
      if (!userId) return;
      const response = await fetch('http://localhost:3001/api/likes/likes-you/count', {
        headers: { 'x-user-id': userId }
      });
      if (response.ok) {
        const data = await response.json();
        setLikesCount(data.likesCount || 0);
      }
    } catch (error) {
      console.error('Failed to load likes count:', error);
    }
  };

  const handleLogin = async (user: any) => {
    setUserId(user.id);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearUser();
    setIsAuthenticated(false);
    setActiveTab("discovery");
  };

  const handleSelectMatch = (user: User, matchId: string) => {
    setActiveChat({ user, matchId });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center min-h-screen bg-gray-900">
        <div className="w-full max-w-md bg-white h-[100dvh] relative overflow-hidden shadow-2xl flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex justify-center min-h-screen bg-gray-900">
        <div className="w-full max-w-md bg-white h-[100dvh] relative overflow-hidden shadow-2xl flex flex-col">
          <Auth onLogin={handleLogin} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center min-h-screen bg-gray-900">
      <div className="w-full max-w-md bg-white h-[100dvh] relative overflow-hidden shadow-2xl flex flex-col">
        <div className="flex-1 overflow-hidden relative">
          {activeTab === "discovery" && <Discovery isPremium={isPremium} />}
          {activeTab === "likes" && (
            <LikesYou isPremium={isPremium} />
          )}
          {activeTab === "matches" && (
            <Matches onSelectMatch={handleSelectMatch} isPremium={isPremium} />
          )}
          {activeTab === "profile" && (
            <Profile
              isPremium={isPremium}
              onTogglePremium={() => setIsPremium(!isPremium)}
              onLogout={handleLogout}
            />
          )}

          {activeChat && (
            <Chat
              user={activeChat.user}
              matchId={activeChat.matchId}
              onBack={() => setActiveChat(null)}
              isPremium={isPremium}
            />
          )}
        </div>

        {!activeChat &&
          (activeTab === "discovery" || activeTab === "matches") && (
            <BannerAd isPremium={isPremium} />
          )}

        {!activeChat && (
          <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} likesCount={likesCount} />
        )}
      </div>
    </div>
  );
}