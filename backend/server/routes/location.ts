import { Router, Request, Response } from 'express';
import { locationService } from '../services/location';

const router = Router();

router.post('/update', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { latitude, longitude, showDistance, maxDistance } = req.body;
    
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const success = await locationService.updateUserLocation(userId, {
      latitude,
      longitude,
      showDistance,
      maxDistance
    });

    if (success) {
      const locationName = await locationService.geocodeLocation(latitude, longitude);
      res.json({ 
        success: true, 
        location: locationName,
        message: 'Location updated successfully'
      });
    } else {
      res.status(500).json({ error: 'Failed to update location' });
    }
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/distance/:otherUserId', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { otherUserId } = req.params;
    const distance = await locationService.getUserDistance(userId, otherUserId);
    
    if (distance === null) {
      return res.json({ distance: null, message: 'Location not available' });
    }

    res.json({
      distance: distance,
      formatted: locationService.formatDistance(distance)
    });
  } catch (error) {
    console.error('Distance calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate distance' });
  }
});

router.post('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { showDistance, maxDistance } = req.body;
    
    const success = await locationService.updateLocationPreference(
      userId, 
      showDistance ?? true, 
      maxDistance ?? 50
    );

    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  } catch (error) {
    console.error('Location preferences error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const coords = await locationService.getUserCoordinates(userId);
    const hasLocation = coords !== null;
    
    res.json({
      hasLocation,
      coordinates: coords,
      message: hasLocation ? 'Location available' : 'No location set'
    });
  } catch (error) {
    console.error('Location status error:', error);
    res.status(500).json({ error: 'Failed to get location status' });
  }
});

export default router;