import { getPool } from '../../db/init';
import { redisService } from '../redis';
import { moderationService } from '../moderation';

interface LocationSignal {
  gps?: { latitude: number; longitude: number; accuracy: number; timestamp: number };
  ip?: { address: string; country: string; city: string; isp: string; org: string; asn: string };
  wifi?: { bssid: string; ssid: string };
  device?: { fingerprint: string; os: string; timezone: string };
}

interface TrustScore {
  overall: number;
  gpsIpMatch: number;
  ipReputation: number;
  deviceConsistency: number;
  travelSpeed: number;
}

interface LocationResult {
  isFake: boolean;
  confidence: number;
  trustScore: TrustScore;
  reasons: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  action?: 'flag' | 'warn' | 'restrict' | 'ban' | 'verify';
  signals: {
    gpsIpDistance: number;
    vpnProbability: number;
    isDatacenter: boolean;
    travelSpeed: number;
    deviceFingerprintMatch: boolean;
    isMockLocation: boolean;
  };
}

export class FakeLocationDetectionService {
  private readonly VPN_THRESHOLD = 0.7;
  private readonly SPEED_THRESHOLD = 1000;
  private readonly MISMATCH_THRESHOLD = 500;
  private readonly DATACENTERS = [
    'amazon', 'aws', 'digitalocean', 'linode', 'vultr', 'ovh', 'hetzner',
    'azure', 'google cloud', 'cloudflare', 'fastly', 'akamai',
    'digitalocean', 'contabo', 'leaseweb', 'online', 'kimsufi'
  ];

  async analyzeLocation(
    userId: string,
    latitude: number,
    longitude: number,
    ipAddress?: string,
    deviceFingerprint?: string,
    isMockLocation?: boolean
  ): Promise<LocationResult> {
    const reasons: string[] = [];
    const trustScore: TrustScore = {
      overall: 0,
      gpsIpMatch: 1,
      ipReputation: 1,
      deviceConsistency: 1,
      travelSpeed: 1
    };

    const signals = {
      gpsIpDistance: 0,
      vpnProbability: 0,
      isDatacenter: false,
      travelSpeed: 0,
      deviceFingerprintMatch: false,
      isMockLocation: isMockLocation || false
    };

    if (isMockLocation) {
      reasons.push('Mock location detected on device');
      trustScore.overall -= 0.5;
      signals.isMockLocation = true;
    }

    if (ipAddress) {
      const vpnResult = await this.detectVPN(ipAddress);
      if (vpnResult.isVPN) {
        signals.vpnProbability = vpnResult.probability;
        signals.isDatacenter = vpnResult.isDatacenter || false;
        reasons.push(`VPN/Proxy detected (${Math.round(vpnResult.probability * 100)}% probability)${vpnResult.isDatacenter ? ' - Datacenter IP' : ''}`);
        trustScore.ipReputation -= vpnResult.probability * 0.5;
      }

      const ipLocation = await this.getIPLocation(ipAddress);
      if (ipLocation) {
        const distance = this.calculateDistance(
          latitude, longitude,
          ipLocation.latitude, ipLocation.longitude
        );
        signals.gpsIpDistance = distance;

        if (distance > this.MISMATCH_THRESHOLD) {
          reasons.push(`GPS location ${Math.round(distance)}km from IP location`);
          trustScore.gpsIpMatch -= Math.min(distance / 2000, 0.8);
        } else if (distance > 100) {
          reasons.push(`GPS location ${Math.round(distance)}km from IP location`);
          trustScore.gpsIpMatch -= 0.2;
        }
      }
    }

    const speedResult = await this.checkMovementSpeed(userId, latitude, longitude);
    if (speedResult.isSuspicious) {
      signals.travelSpeed = speedResult.speed;
      reasons.push(`Impossible travel speed: ${Math.round(speedResult.speed)} km/h`);
      trustScore.travelSpeed -= speedResult.confidence;
    }

    if (deviceFingerprint) {
      const fingerprintResult = await this.checkDeviceFingerprint(userId, deviceFingerprint, latitude, longitude);
      if (!fingerprintResult.isConsistent) {
        signals.deviceFingerprintMatch = false;
        reasons.push('Device fingerprint mismatch - location anomaly detected');
        trustScore.deviceConsistency -= 0.5;
      } else {
        signals.deviceFingerprintMatch = true;
      }
    }

    trustScore.overall = (
      trustScore.gpsIpMatch * 0.35 +
      trustScore.ipReputation * 0.25 +
      trustScore.deviceConsistency * 0.20 +
      trustScore.travelSpeed * 0.20
    );

    trustScore.overall = Math.max(0, Math.min(1, trustScore.overall));

    const severity = trustScore.overall >= 0.7 ? 'critical' :
                   trustScore.overall >= 0.5 ? 'high' :
                   trustScore.overall >= 0.3 ? 'medium' : 'low';

    let action: LocationResult['action'];
    if (trustScore.overall < 0.3) {
      action = 'verify';
    } else if (trustScore.overall < 0.5) {
      action = 'restrict';
    } else if (trustScore.overall < 0.7) {
      action = 'warn';
    }

    return {
      isFake: trustScore.overall < 0.5,
      confidence: 1 - trustScore.overall,
      trustScore,
      reasons,
      severity,
      action,
      signals
    };
  }

  async detectVPN(ipAddress: string): Promise<{ isVPN: boolean; probability: number; isDatacenter: boolean; provider?: string }> {
    if (!ipAddress || this.isPrivateIP(ipAddress)) {
      return { isVPN: false, probability: 0, isDatacenter: false };
    }

    const cached = await redisService.get(`vpn:detection:${ipAddress}`);
    if (cached) {
      return JSON.parse(cached);
    }

    let isVPN = false;
    let probability = 0;
    let isDatacenter = false;
    let provider: string | undefined;

    try {
      const [ipapi, ipqualityscore] = await Promise.all([
        this.checkIPApi(ipAddress),
        this.checkIPQualityScore(ipAddress)
      ]);

      if (ipapi) {
        if (ipapi.proxy || ipapi.vpn || ipapi.hosting) {
          isVPN = true;
          probability = Math.max(probability, ipapi.vpn ? 0.9 : ipapi.proxy ? 0.8 : 0.6);
        }

        if (ipapi.hosting || ipapi.datacenter) {
          isDatacenter = true;
        }

        provider = ipapi.org || ipapi.isp;
      }

      if (ipqualityscore) {
        probability = Math.max(probability, ipqualityscore.vpn_probability || 0);
        if (ipqualityscore.tor) {
          probability = Math.max(probability, 0.95);
          isVPN = true;
        }
      }

      if (provider) {
        const providerLower = provider.toLowerCase();
        for (const dc of this.DATACENTERS) {
          if (providerLower.includes(dc)) {
            isDatacenter = true;
            probability = Math.max(probability, 0.7);
            break;
          }
        }
      }

      const result = { isVPN, probability, isDatacenter, provider };
      await redisService.set(`vpn:detection:${ipAddress}`, JSON.stringify(result), 86400);

      return result;
    } catch (error) {
      console.error('VPN detection error:', error);
    }

    return { isVPN: false, probability: 0, isDatacenter: false };
  }

  private async checkIPApi(ipAddress: string): Promise<any> {
    try {
      const response = await fetch(`https://ipapi.co/${ipAddress}/json/`);
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  private async checkIPQualityScore(ipAddress: string): Promise<any> {
    const apiKey = process.env.IPQUALITYSCORE_API_KEY;
    if (!apiKey) return null;

    try {
      const response = await fetch(`https://www.ipqualityscore.com/api/json/ip/${apiKey}/${ipAddress}`);
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  private isPrivateIP(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) return true;
    
    const num = parseInt(parts[0]) * 256 * 256 * 256 + parseInt(parts[1]) * 256 * 256 + parseInt(parts[2]) * 256 + parseInt(parts[3]);
    
    if (parseInt(parts[0]) === 10) return true;
    if (parseInt(parts[0]) === 172 && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return true;
    if (parseInt(parts[0]) === 192 && parseInt(parts[1]) === 168) return true;
    if (parseInt(parts[0]) === 127) return true;
    
    return false;
  }

  async getIPLocation(ipAddress: string): Promise<{ latitude: number; longitude: number } | null> {
    if (!ipAddress || this.isPrivateIP(ipAddress)) {
      return null;
    }

    const cached = await redisService.get(`ip:location:${ipAddress}`);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      const response = await fetch(`http://ip-api.com/json/${ipAddress}?fields=lat,lon,country,city,isp,org,as`);
      const data = await response.json() as any;
      
      if (data.lat && data.lon) {
        const location = { latitude: data.lat, longitude: data.lon };
        await redisService.set(`ip:location:${ipAddress}`, JSON.stringify(location), 86400);
        return location;
      }
    } catch (error) {
      console.error('IP location lookup error:', error);
    }

    return null;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private async checkMovementSpeed(userId: string, lat: number, lon: number): Promise<{
    isSuspicious: boolean;
    speed: number;
    confidence: number;
  }> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT latitude, longitude, created_at 
       FROM user_locations 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 2`,
      [userId]
    );

    if (result.rows.length < 2) {
      return { isSuspicious: false, speed: 0, confidence: 0 };
    }

    const last = result.rows[0];
    const distance = this.calculateDistance(lat, lon, last.latitude, last.longitude);
    const timeDiff = (Date.now() - new Date(last.created_at).getTime()) / (1000 * 60);
    const speedKmH = timeDiff > 0 ? (distance / (timeDiff / 60)) : 0;

    const isSuspicious = speedKmH > this.SPEED_THRESHOLD;
    const confidence = Math.min(speedKmH / 2000, 1);

    return { isSuspicious, speed: speedKmH, confidence };
  }

  private async checkDeviceFingerprint(userId: string, fingerprint: string, latitude: number, longitude: number): Promise<{
    isConsistent: boolean;
  }> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT device_fingerprint, last_location_lat, last_location_lon 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].device_fingerprint) {
      await pool.query(
        `UPDATE users SET device_fingerprint = $2 WHERE id = $1`,
        [userId, fingerprint]
      );
      return { isConsistent: true };
    }

    const existingFingerprint = result.rows[0].device_fingerprint;
    if (existingFingerprint !== fingerprint) {
      return { isConsistent: false };
    }

    return { isConsistent: true };
  }

  async updateUserLocation(
    userId: string,
    latitude: number,
    longitude: number,
    accuracy: number,
    ipAddress?: string,
    deviceFingerprint?: string,
    isMockLocation?: boolean
  ): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `INSERT INTO user_locations (user_id, latitude, longitude, accuracy)
       VALUES ($1, $2, $3, $4)`,
      [userId, latitude, longitude, accuracy]
    );

    await pool.query(
      `UPDATE users SET 
        last_location_lat = $2, 
        last_location_lon = $3, 
        last_active = NOW(),
        device_fingerprint = COALESCE(device_fingerprint, $5)
       WHERE id = $1`,
      [userId, latitude, longitude, deviceFingerprint || null]
    );

    const analysis = await this.analyzeLocation(userId, latitude, longitude, ipAddress, deviceFingerprint, isMockLocation);
    
    await redisService.set(`location:trust:${userId}`, JSON.stringify(analysis), 3600);

    if (analysis.action) {
      await this.applyAction(userId, analysis);
    }
  }

  private async applyAction(userId: string, analysis: LocationResult): Promise<void> {
    switch (analysis.action) {
      case 'restrict':
        await moderationService.restrictUser(
          userId,
          24 * 60 * 60 * 1000,
          { discovery: false },
          `Fake location detected: ${analysis.reasons.join(', ')}`
        );
        break;
      case 'warn':
        await moderationService.handleViolation({
          userId,
          type: 'location_spoofing',
          severity: 'medium',
          source: 'ai_detection',
          description: `Location trust score: ${analysis.trustScore.overall}`
        });
        break;
    }
  }

  async getLocationHistory(userId: string): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT latitude, longitude, accuracy, created_at 
       FROM user_locations 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 100`,
      [userId]
    );
    return result.rows;
  }

  async detectLocationAnomalies(userId: string): Promise<{
    hasAnomaly: boolean;
    anomalies: any[];
  }> {
    const history = await this.getLocationHistory(userId);
    const anomalies: any[] = [];

    for (let i = 1; i < history.length; i++) {
      const current = history[i];
      const previous = history[i - 1];
      
      const distance = this.calculateDistance(
        current.latitude, current.longitude,
        previous.latitude, previous.longitude
      );

      const timeDiff = (new Date(current.created_at).getTime() - new Date(previous.created_at).getTime()) / 1000;
      const speedKmH = timeDiff > 0 ? (distance / (timeDiff / 3600)) : 0;

      if (speedKmH > this.SPEED_THRESHOLD) {
        anomalies.push({
          type: 'impossible_speed',
          speed: speedKmH,
          distance,
          timeDiff,
          timestamp: current.created_at
        });
      }

      if (current.latitude === previous.latitude && current.longitude === previous.longitude) {
        anomalies.push({
          type: 'static_location',
          timestamp: current.created_at
        });
      }
    }

    return {
      hasAnomaly: anomalies.length > 0,
      anomalies
    };
  }

  async verifyLocationChallenge(userId: string, challengeResponse: {
    selfieWithLocation: string;
    liveGps: { latitude: number; longitude: number };
  }): Promise<{ verified: boolean; message: string }> {
    const recentLocation = await this.getLocationHistory(userId);
    if (recentLocation.length === 0) {
      return { verified: false, message: 'No recent location data' };
    }

    const lastLocation = recentLocation[0];
    const distance = this.calculateDistance(
      lastLocation.latitude,
      lastLocation.longitude,
      challengeResponse.liveGps.latitude,
      challengeResponse.liveGps.longitude
    );

    if (distance > 1000) {
      return { verified: false, message: 'Location verification failed - too far from last known location' };
    }

    await moderationService.liftRestriction(userId);

    return { verified: true, message: 'Location verified successfully' };
  }
}

export const fakeLocationDetectionService = new FakeLocationDetectionService();
