import { useState, useEffect } from "react";
import { User } from "../types";
import { getUserId, api, clearUser } from "../api";
import { User as UserIcon, Settings, Crown, LogOut, Shield, Camera, MapPin, Heart } from "lucide-react";

interface ProfileProps {
  isPremium: boolean;
  onTogglePremium: () => void;
  onLogout: () => void;
}

export default function Profile({ isPremium, onTogglePremium, onLogout }: ProfileProps) {
  const [user, setUser] = useState<Partial<User>>({});
  const [loading, setLoading] = useState(true);
  const userId = getUserId();

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3001/api/users/me', {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearUser();
    onLogout();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-y-auto">
      <div className="bg-white shadow-sm px-4 py-3">
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
      </div>

      <div className="p-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-200">
              {user.images?.[0] ? (
                <img src={user.images[0]} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-pink-500 text-white text-2xl font-semibold">
                  {user.name?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900">{user.name}</h2>
              <p className="text-gray-500">{user.age} years old</p>
              <div className="flex items-center gap-1 text-gray-500 text-sm mt-1">
                <MapPin className="w-4 h-4" />
                {user.location}
              </div>
            </div>
            {isPremium && (
              <div className="px-3 py-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full flex items-center gap-1">
                <Crown className="w-4 h-4 text-white" />
                <span className="text-white text-sm font-medium">Premium</span>
              </div>
            )}
          </div>

          {user.isVerified && (
            <div className="mt-4 flex items-center gap-2 text-green-600">
              <Shield className="w-5 h-5" />
              <span className="text-sm font-medium">Verified Profile</span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm mb-4">
          <h3 className="font-semibold text-gray-900 px-4 py-3 border-b">Bio</h3>
          <p className="p-4 text-gray-600">{user.bio || 'No bio yet'}</p>
        </div>

        {user.interests && user.interests.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm mb-4">
            <h3 className="font-semibold text-gray-900 px-4 py-3 border-b flex items-center gap-2">
              <Heart className="w-5 h-5 text-pink-500" />
              Interests
            </h3>
            <div className="p-4 flex flex-wrap gap-2">
              {user.interests.map((interest, idx) => (
                <span key={idx} className="px-3 py-1 bg-pink-100 text-pink-700 rounded-full text-sm">
                  {interest}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm mb-4">
          <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <Camera className="w-5 h-5 text-gray-600" />
              <span className="text-gray-900">Edit Photos</span>
            </div>
          </button>
          <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 border-t">
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-gray-600" />
              <span className="text-gray-900">Settings</span>
            </div>
          </button>
          <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 border-t">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-gray-600" />
              <span className="text-gray-900">Verification</span>
            </div>
          </button>
        </div>

        {!isPremium && (
          <button
            onClick={onTogglePremium}
            className="w-full py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-2xl font-semibold mb-4 flex items-center justify-center gap-2"
          >
            <Crown className="w-5 h-5" />
            Upgrade to Premium
          </button>
        )}

        <button
          onClick={handleLogout}
          className="w-full py-3 border border-red-200 text-red-600 rounded-2xl font-semibold flex items-center justify-center gap-2"
        >
          <LogOut className="w-5 h-5" />
          Log Out
        </button>
      </div>
    </div>
  );
}
