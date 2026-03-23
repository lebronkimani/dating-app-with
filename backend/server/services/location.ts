import { getPool } from '../db/init';

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface LocationUpdate {
  latitude: number;
  longitude: number;
  showDistance?: boolean;
  maxDistance?: number;
}

export class LocationService {
  
  calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371;
    const dLat = this.toRadians(coord2.latitude - coord1.latitude);
    const dLon = this.toRadians(coord2.longitude - coord1.longitude);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(coord1.latitude)) * 
      Math.cos(this.toRadians(coord2.latitude)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return Math.round(distance);
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  formatDistance(km: number): string {
    if (km < 1) {
      return 'Less than 1 km away';
    } else if (km < 10) {
      return `${Math.round(km)} km away`;
    } else if (km < 100) {
      return `${Math.round(km)} km away`;
    } else {
      return `${Math.round(km / 100) * 100} km away`;
    }
  }

  async updateUserLocation(userId: string, location: LocationUpdate): Promise<boolean> {
    const pool = getPool();
    
    try {
      await pool.query(
        `UPDATE users 
         SET latitude = $1, 
             longitude = $2, 
             location_last_updated = CURRENT_TIMESTAMP,
             show_distance = COALESCE($3, show_distance),
             max_distance_preference = COALESCE($4, max_distance_preference)
         WHERE id = $5`,
        [
          location.latitude,
          location.longitude,
          location.showDistance ?? null,
          location.maxDistance ?? null,
          userId
        ]
      );
      return true;
    } catch (error) {
      console.error('Failed to update location:', error);
      return false;
    }
  }

  async getUserCoordinates(userId: string): Promise<Coordinates | null> {
    const pool = getPool();
    
    const result = await pool.query(
      'SELECT latitude, longitude FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].latitude) {
      return null;
    }

    return {
      latitude: parseFloat(result.rows[0].latitude),
      longitude: parseFloat(result.rows[0].longitude)
    };
  }

  async findUsersWithinDistance(
    userId: string, 
    maxDistanceKm: number,
    genderPreference: string = 'all'
  ): Promise<string[]> {
    const pool = getPool();
    const userCoords = await this.getUserCoordinates(userId);
    
    if (!userCoords) {
      return [];
    }

    let query = `
      SELECT id, latitude, longitude FROM users 
      WHERE id != $1 
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
    `;
    
    const params: any[] = [userId];
    
    if (genderPreference !== 'all') {
      query += ` AND sex = $2`;
      params.push(genderPreference);
    }
    
    const result = await pool.query(query, params);
    
    const usersWithinDistance: string[] = [];
    
    for (const row of result.rows) {
      const distance = this.calculateDistance(
        userCoords,
        { latitude: parseFloat(row.latitude), longitude: parseFloat(row.longitude) }
      );
      
      if (distance <= maxDistanceKm) {
        usersWithinDistance.push(row.id);
      }
    }
    
    return usersWithinDistance;
  }

  async getUserDistance(userId1: string, userId2: string): Promise<number | null> {
    const coords1 = await this.getUserCoordinates(userId1);
    const coords2 = await this.getUserCoordinates(userId2);
    
    if (!coords1 || !coords2) {
      return null;
    }
    
    return this.calculateDistance(coords1, coords2);
  }

  async getDiscoveryCandidates(
    userId: string,
    minAge: number,
    maxAge: number,
    maxDistanceKm: number,
    genderPreference: string = 'all',
    excludeIds: string[] = []
  ): Promise<any[]> {
    const pool = getPool();
    const userCoords = await this.getUserCoordinates(userId);
    
    let query = `
      SELECT id, name, age, sex, location, bio, images, is_verified, 
             interests, languages, latitude, longitude
      FROM users 
      WHERE id != $1 
        AND age >= $2 
        AND age <= $3
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
    `;
    
    const params: any[] = [userId, minAge, maxAge];
    let paramIndex = 4;
    
    if (genderPreference !== 'all') {
      query += ` AND sex = $${paramIndex}`;
      params.push(genderPreference);
      paramIndex++;
    }
    
    if (excludeIds.length > 0) {
      const placeholders = excludeIds.map(() => `$${paramIndex++}`).join(',');
      query += ` AND id NOT IN (${placeholders})`;
      params.push(...excludeIds);
    }
    
    query += ' LIMIT 50';
    
    const result = await pool.query(query, params);
    
    const candidates = [];
    
    for (const row of result.rows) {
      let distance = null;
      let distanceText = 'Distance unknown';
      
      if (userCoords && row.latitude && row.longitude) {
        const distKm = this.calculateDistance(
          userCoords,
          { latitude: parseFloat(row.latitude), longitude: parseFloat(row.longitude) }
        );
        
        if (distKm <= maxDistanceKm) {
          distance = distKm;
          distanceText = this.formatDistance(distKm);
        } else {
          continue;
        }
      }
      
      candidates.push({
        id: row.id,
        name: row.name,
        age: row.age,
        sex: row.sex,
        location: row.location || 'Unknown',
        distance: distanceText,
        distanceKm: distance,
        bio: row.bio || '',
        images: row.images || [],
        isVerified: row.is_verified,
        interests: row.interests || [],
        languages: row.languages || []
      });
    }
    
    return candidates;
  }

  async updateLocationPreference(userId: string, showDistance: boolean, maxDistance: number): Promise<boolean> {
    const pool = getPool();
    
    try {
      await pool.query(
        `UPDATE users SET show_distance = $1, max_distance_preference = $2 WHERE id = $3`,
        [showDistance, maxDistance, userId]
      );
      return true;
    } catch (error) {
      console.error('Failed to update location preference:', error);
      return false;
    }
  }

  geocodeLocation(lat: number, lng: number): Promise<string> {
    return fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
    )
      .then(res => res.json())
      .then(data => {
        const parts = [];
        if (data.address?.city) parts.push(data.address.city);
        else if (data.address?.town) parts.push(data.address.town);
        else if (data.address?.village) parts.push(data.address.village);
        
        if (data.address?.country_code) {
          const country = data.address.country_code.toUpperCase();
          const countries: any = {
            US: 'USA', UK: 'UK', DE: 'Germany', FR: 'France', ES: 'Spain',
            IT: 'Italy', JP: 'Japan', AU: 'Australia', CA: 'Canada', BR: 'Brazil'
          };
          parts.push(countries[country] || country);
        }
        
        return parts.join(', ') || 'Unknown location';
      })
      .catch(() => 'Unknown location');
  }
}

export const locationService = new LocationService();