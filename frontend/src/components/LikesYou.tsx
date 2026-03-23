import { useState, useEffect } from "react";
import { LikeUser } from "../types";
import { getUserId } from "../api";
import { Heart, Lock, Eye, Sparkles } from "lucide-react";

interface LikesYouProps {
  isPremium: boolean;
}

export default function LikesYou({ isPremium }: LikesYouProps) {
  const [likes, setLikes] = useState<LikeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealedCount, setRevealedCount] = useState(0);
  const userId = getUserId();

  const isSunday = new Date().getDay() === 0;

  useEffect(() => {
    loadLikes();
  }, []);

  const loadLikes = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3001/api/likes/likes-you', {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        setLikes(data.likes || []);
      }
    } catch (error) {
      console.error('Failed to load likes:', error);
    } finally {
      setLoading(false);
    }
  };

  const revealProfile = async (likeId: string) => {
    try {
      const response = await fetch('http://localhost:3001/api/likes/reveal', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId!
        },
        body: JSON.stringify({ likeId })
      });
      if (response.ok) {
        setLikes(prev => prev.map(l => 
          l.id === likeId ? { ...l, blurred: false } : l
        ));
        setRevealedCount(prev => prev + 1);
      }
    } catch (error) {
      console.error('Failed to reveal profile:', error);
    }
  };

  const canReveal = isPremium || (isSunday && revealedCount === 0);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      <div className="bg-white shadow-sm px-4 py-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Heart className="w-5 h-5 text-pink-500" />
          Likes You
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {likes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Heart className="w-16 h-16 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No likes yet</h3>
            <p className="text-gray-500 text-sm">
              People who like you will appear here
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {likes.map((like) => (
              <div
                key={like.id}
                className="relative bg-white rounded-2xl overflow-hidden shadow-md"
              >
                <div className="aspect-[3/4] relative">
                  {like.blurred ? (
                    <>
                      <div className="absolute inset-0 bg-gray-200">
                        {like.images?.[0] && (
                          <img
                            src={like.images[0]}
                            alt={like.name}
                            className="w-full h-full object-cover blur-xl scale-110"
                          />
                        )}
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div className="text-center text-white p-4">
                          <Lock className="w-8 h-8 mx-auto mb-2" />
                          <p className="text-sm font-medium">Upgrade to see</p>
                        </div>
                      </div>
                      {canReveal && (
                        <button
                          onClick={() => revealProfile(like.id)}
                          className="absolute bottom-3 left-3 right-3 py-2 bg-pink-500 text-white rounded-full text-sm font-medium flex items-center justify-center gap-1 hover:bg-pink-600 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          Reveal
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <img
                        src={like.images?.[0] || '/placeholder.jpg'}
                        alt={like.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                        <h3 className="font-semibold text-white">
                          {like.name}, {like.age}
                        </h3>
                        {like.matchProbability && (
                          <p className="text-xs text-pink-300 flex items-center gap-1 mt-1">
                            <Sparkles className="w-3 h-3" />
                            {Math.round(like.matchProbability * 100)}% match
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isPremium && !isSunday && (
        <div className="bg-white border-t px-4 py-3">
          <p className="text-center text-sm text-gray-500">
            Free users can reveal 1 profile per week on Sunday
          </p>
        </div>
      )}
    </div>
  );
}
