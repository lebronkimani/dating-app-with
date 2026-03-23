import { Home, Heart, MessageCircle, User } from "lucide-react";

interface BottomNavProps {
  activeTab: "discovery" | "matches" | "likes" | "profile";
  setActiveTab: (tab: "discovery" | "matches" | "likes" | "profile") => void;
  likesCount: number;
}

export default function BottomNav({ activeTab, setActiveTab, likesCount }: BottomNavProps) {
  return (
    <div className="bg-white border-t px-6 py-2 flex justify-around items-center">
      <button
        onClick={() => setActiveTab("discovery")}
        className={`flex flex-col items-center py-2 px-4 ${
          activeTab === "discovery" ? "text-pink-500" : "text-gray-400"
        }`}
      >
        <Home className="w-6 h-6" />
        <span className="text-xs mt-1">Discover</span>
      </button>

      <button
        onClick={() => setActiveTab("likes")}
        className={`flex flex-col items-center py-2 px-4 relative ${
          activeTab === "likes" ? "text-pink-500" : "text-gray-400"
        }`}
      >
        <Heart className="w-6 h-6" />
        {likesCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-pink-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
            {likesCount > 9 ? "9+" : likesCount}
          </span>
        )}
        <span className="text-xs mt-1">Likes</span>
      </button>

      <button
        onClick={() => setActiveTab("matches")}
        className={`flex flex-col items-center py-2 px-4 ${
          activeTab === "matches" ? "text-pink-500" : "text-gray-400"
        }`}
      >
        <MessageCircle className="w-6 h-6" />
        <span className="text-xs mt-1">Matches</span>
      </button>

      <button
        onClick={() => setActiveTab("profile")}
        className={`flex flex-col items-center py-2 px-4 ${
          activeTab === "profile" ? "text-pink-500" : "text-gray-400"
        }`}
      >
        <User className="w-6 h-6" />
        <span className="text-xs mt-1">Profile</span>
      </button>
    </div>
  );
}
