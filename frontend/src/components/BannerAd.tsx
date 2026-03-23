import { useEffect, useState } from "react";
import { getUserId } from "../api";

interface BannerAdProps {
  isPremium: boolean;
}

export default function BannerAd({ isPremium }: BannerAdProps) {
  const [ad, setAd] = useState<any>(null);
  const userId = getUserId();

  useEffect(() => {
    if (!isPremium) {
      loadAd();
    }
  }, [isPremium]);

  const loadAd = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/ads/banner', {
        headers: { 'x-user-id': userId! }
      });
      if (response.ok) {
        const data = await response.json();
        setAd(data.ad);
      }
    } catch (error) {
      console.error('Failed to load ad:', error);
    }
  };

  if (isPremium || !ad) {
    return null;
  }

  return (
    <div className="bg-gray-100 border-t px-2 py-2">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Sponsored</span>
        {ad.content?.imageUrl && (
          <img
            src={ad.content.imageUrl}
            alt={ad.content.title}
            className="w-8 h-8 rounded object-cover"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-700 truncate">{ad.content?.title}</p>
          {ad.content?.description && (
            <p className="text-gray-400 truncate text-xs">{ad.content.description}</p>
          )}
        </div>
        {ad.content?.cta && (
          <button className="px-3 py-1 bg-pink-500 text-white rounded-full text-xs font-medium">
            {ad.content.cta}
          </button>
        )}
      </div>
    </div>
  );
}
