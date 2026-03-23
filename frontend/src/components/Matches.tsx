import { useState, useEffect } from "react";
import { User, Match } from "../types";
import { getUserId } from "../api";
import { Circle, MessageCircle } from "lucide-react";

interface MatchesProps {
  onSelectMatch: (user: User, matchId: string) => void;
  isPremium: boolean;
}

export default function Matches({ onSelectMatch, isPremium }: MatchesProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineStatus, setOnlineStatus] = useState<Record<string, boolean>>({});
  const userId = getUserId();

  useEffect(() => {
    loadMatches();
    const interval = setInterval(loadOnlineStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadMatches = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3001/api/swipe/matches', {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        setMatches(data.matches || []);
        loadOnlineStatus(data.matches || []);
      }
    } catch (error) {
      console.error('Failed to load matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOnlineStatus = async (matchesList?: Match[]) => {
    const targetMatches = matchesList || matches;
    if (targetMatches.length === 0) return;

    try {
      const response = await fetch('http://localhost:3001/api/presence/who-online', {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        const statusMap: Record<string, boolean> = {};
        data.users?.forEach((u: any) => {
          statusMap[u.id] = u.online;
        });
        setOnlineStatus(statusMap);
      }
    } catch (error) {
      console.error('Failed to load online status:', error);
    }
  };

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading matches...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      <div className="bg-white shadow-sm px-4 py-3">
        <h1 className="text-xl font-bold text-gray-900">Matches</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <MessageCircle className="w-16 h-16 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No matches yet</h3>
            <p className="text-gray-500 text-sm">
              Keep swiping to find your perfect match!
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {matches.map((match) => (
              <button
                key={match.id}
                onClick={() => onSelectMatch(match.user, match.id)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="relative">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                    {match.user.images?.[0] ? (
                      <img
                        src={match.user.images[0]}
                        alt={match.user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-pink-500 text-white text-xl font-semibold">
                        {match.user.name?.[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  {onlineStatus[match.user.id] && (
                    <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 border-2 border-white rounded-full" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 truncate">
                      {match.user.name}
                    </h3>
                    {match.timestamp && (
                      <span className="text-xs text-gray-400">
                        {formatTime(match.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {onlineStatus[match.user.id] ? (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Circle className="w-2 h-2 fill-green-600" />
                        Online
                      </span>
                    ) : match.lastMessage ? (
                      <p className="text-sm text-gray-500 truncate">
                        {match.lastMessage}
                      </p>
                    ) : (
                      <p className="text-sm text-pink-500">
                        New match! Say hi 👋
                      </p>
                    )}
                  </div>
                </div>

                <MessageCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
