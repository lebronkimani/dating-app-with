import { Router, Request, Response } from 'express';
import { getPool } from '../db/init';
import { locationService } from '../services/location';
import { recommendationEngine } from '../ml/recommendations';

const router = Router();

router.get('/filters', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pool = getPool();
    
    const result = await pool.query(
      `SELECT min_age, max_age, max_distance, gender_preference FROM user_preferences WHERE user_id = $1`,
      [userId]
    );

    const filters = result.rows[0] || {
      min_age: 18,
      max_age: 50,
      max_distance: 50,
      gender_preference: 'all'
    };

    res.json({
      minAge: filters.min_age,
      maxAge: filters.max_age,
      maxDistance: filters.max_distance,
      genderPreference: filters.gender_preference
    });
  } catch (error) {
    console.error('Get filters error:', error);
    res.status(500).json({ error: 'Failed to get filters' });
  }
});

router.post('/filters', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { minAge, maxAge, maxDistance, genderPreference } = req.body;

    if (minAge !== undefined && (minAge < 18 || minAge > 120)) {
      return res.status(400).json({ error: 'Min age must be 18-120' });
    }
    if (maxAge !== undefined && (maxAge < 18 || maxAge > 120)) {
      return res.status(400).json({ error: 'Max age must be 18-120' });
    }
    if (maxDistance !== undefined && (maxDistance < 1 || maxDistance > 500)) {
      return res.status(400).json({ error: 'Max distance must be 1-500' });
    }
    if (genderPreference !== undefined && !['all', 'male', 'female', 'non_binary'].includes(genderPreference)) {
      return res.status(400).json({ error: 'Invalid gender preference' });
    }

    const pool = getPool();
    
    await pool.query(
      `INSERT INTO user_preferences (user_id, min_age, max_age, max_distance, gender_preference)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         min_age = COALESCE($2, user_preferences.min_age),
         max_age = COALESCE($3, user_preferences.max_age),
         max_distance = COALESCE($4, user_preferences.max_distance),
         gender_preference = COALESCE($5, user_preferences.gender_preference)`,
      [userId, minAge ?? null, maxAge ?? null, maxDistance ?? null, genderPreference ?? null]
    );

    res.json({ success: true, message: 'Filters updated' });
  } catch (error) {
    console.error('Update filters error:', error);
    res.status(500).json({ error: 'Failed to update filters' });
  }
});

router.get('/discover', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await recommendationEngine.initialize();

    const pool = getPool();
    
    const prefsResult = await pool.query(
      `SELECT min_age, max_age, max_distance, gender_preference FROM user_preferences WHERE user_id = $1`,
      [userId]
    );

    const prefs = prefsResult.rows[0] || {
      min_age: 18,
      max_age: 50,
      max_distance: 50,
      gender_preference: 'all'
    };

    const userCoords = await locationService.getUserCoordinates(userId);

    let query = `
      SELECT id, name, age, sex, location, bio, images, is_verified, interests, languages, latitude, longitude
      FROM users 
      WHERE id != $1 
        AND age >= $2 
        AND age <= $3
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
    `;
    
    const params: any[] = [userId, prefs.min_age, prefs.max_age];
    let paramIndex = 4;
    
    if (prefs.gender_preference !== 'all') {
      query += ` AND sex = $${paramIndex}`;
      params.push(prefs.gender_preference);
      paramIndex++;
    }
    
    const swipedResult = await pool.query(
      `SELECT swiped_id FROM swipes WHERE swiper_id = $1 UNION SELECT blocked_id FROM blocks WHERE blocker_id = $1`,
      [userId]
    );
    const excludedIds = swipedResult.rows.map(r => r.swiped_id || r.blocked_id);
    
    if (excludedIds.length > 0) {
      const placeholders = excludedIds.map(() => `$${paramIndex++}`).join(',');
      query += ` AND id NOT IN (${placeholders})`;
      params.push(...excludedIds);
    }
    
    query += ' LIMIT 100';
    
    const result = await pool.query(query, params);
    
    const candidateIds = result.rows.map(r => r.id);
    
    const scoredCandidates = await recommendationEngine.rankCandidates(
      userId,
      candidateIds,
      userCoords || undefined
    );

    const scoredMap = new Map(scoredCandidates.map(s => [s.userId, s]));
    
    const candidates = [];
    
    for (const row of result.rows) {
      const scoreData = scoredMap.get(row.id);
      
      let distanceKm: number | null = null;
      let distanceText = 'Distance unknown';
      
      if (userCoords && row.latitude && row.longitude) {
        distanceKm = locationService.calculateDistance(
          userCoords,
          { latitude: parseFloat(row.latitude), longitude: parseFloat(row.longitude) }
        );
        
        if (distanceKm <= prefs.max_distance) {
          distanceText = locationService.formatDistance(distanceKm);
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
        distanceKm,
        bio: row.bio || '',
        images: row.images || [],
        isVerified: row.is_verified,
        interests: row.interests || [],
        languages: row.languages || [],
        matchProbability: scoreData ? Math.round(scoreData.score * 100) : 50
      });
    }

    candidates.sort((a, b) => (b.matchProbability || 50) - (a.matchProbability || 50));
    
    res.json(candidates.slice(0, 20));
  } catch (error) {
    console.error('Filtered discover error:', error);
    res.status(500).json({ error: 'Failed to get candidates' });
  }
});

export default router;