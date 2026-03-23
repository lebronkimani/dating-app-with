import { useState, useEffect, useRef, useCallback } from "react";
import { User } from "../types";
import { getUserId, api } from "../api";
import { X, Heart, Star, Filter, Sparkles, Zap, Award } from "lucide-react";

interface DiscoveryProps {
  isPremium: boolean;
}

export default function Discovery({ isPremium }: DiscoveryProps) {
  const [profiles, setProfiles] = useState<User[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [superLikeUsed, setSuperLikeUsed] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isSunday, setIsSunday] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const userId = getUserId();

  useEffect(() => {
    const today = new Date();
    setIsSunday(today.getDay() === 0);
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3001/api/ml/recommendations', {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        setProfiles(data.recommendations || []);
      }
    } catch (error) {
      console.error('Failed to load profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSwipe = async (direction: 'left' | 'right' | 'super') => {
    const profile = profiles[currentIndex];
    if (!profile) return;

    try {
      await fetch('http://localhost:3001/api/swipe', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId!
        },
        body: JSON.stringify({
          targetUserId: profile.id,
          action: direction === 'super' ? 'superlike' : direction
        })
      });
    } catch (error) {
      console.error('Swipe error:', error);
    }

    if (direction === 'super') {
      setSuperLikeUsed(true);
    }

    if (currentIndex < profiles.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      loadProfiles();
      setCurrentIndex(0);
    }
  };

  const currentProfile = profiles[currentIndex];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-pink-500 animate-pulse mx-auto mb-4" />
          <p className="text-gray-500">Finding people near you...</p>
        </div>
      </div>
    );
  }

  if (!currentProfile) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center px-4">
          <Sparkles className="w-16 h-16 text-pink-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No more profiles</h3>
          <p className="text-gray-500 mb-4">Check back later for new matches!</p>
          <button
            onClick={loadProfiles}
            className="px-6 py-2 bg-pink-500 text-white rounded-full hover:bg-pink-600 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const canSuperLike = isPremium || isSunday || !superLikeUsed;

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white shadow-sm px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Discover</h1>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="p-2 hover:bg-gray-100 rounded-full"
        >
          <Filter className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      <div className="flex-1 p-4 overflow-hidden">
        <div
          ref={cardRef}
          className="relative w-full h-full bg-white rounded-3xl shadow-lg overflow-hidden"
        >
          <img
            src={currentProfile.images?.[0] || '/placeholder.jpg'}
            alt={currentProfile.name}
            className="w-full h-full object-cover"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl font-bold">{currentProfile.name}</h2>
              <span className="text-xl">{currentProfile.age}</span>
              {currentProfile.isVerified && (
                <Award className="w-5 h-5 text-blue-400" />
              )}
            </div>

            <div className="flex items-center gap-2 text-sm mb-3">
              <span className="opacity-90">{currentProfile.location}</span>
              <span>•</span>
              <span className="opacity-90">{currentProfile.distance}</span>
            </div>

            {currentProfile.mlFeatures && (
              <div className="flex flex-wrap gap-2">
                {currentProfile.mlFeatures.interestOverlap > 0.7 && (
                  <span className="px-2 py-1 bg-pink-500/80 rounded-full text-xs flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    {Math.round(currentProfile.mlFeatures.interestOverlap * 100)}% Match
                  </span>
                )}
                {currentProfile.mlFeatures.profileQuality > 0.8 && (
                  <span className="px-2 py-1 bg-blue-500/80 rounded-full text-xs flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Top Profile
                  </span>
                )}
              </div>
            )}

            <p className="mt-3 text-sm opacity-90 line-clamp-2">{currentProfile.bio}</p>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex justify-center items-center gap-4">
          <button
            onClick={() => handleSwipe('left')}
            className="w-14 h-14 bg-white rounded-full shadow-lg flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
          >
            <X className="w-7 h-7" />
          </button>

          <button
            onClick={() => handleSwipe('super')}
            disabled={!canSuperLike}
            className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors ${
              canSuperLike
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            title={!canSuperLike ? "Super Like available on Sunday!" : "Super Like"}
          >
            <Star className="w-6 h-6" />
          </button>

          <button
            onClick={() => handleSwipe('right')}
            className="w-14 h-14 bg-pink-500 rounded-full shadow-lg flex items-center justify-center text-white hover:bg-pink-600 transition-colors"
          >
            <Heart className="w-7 h-7" />
          </button>
        </div>

        {(!isPremium && !isSunday) && (
          <p className="text-center text-xs text-gray-400 mt-3">
            Super Likes available on Sundays for free users
          </p>
        )}
      </div>
    </div>
  );
}
