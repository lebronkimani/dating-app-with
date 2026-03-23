# Machine Learning Module

## Overview

This module provides ML-powered recommendations and ad targeting for the dating app.

## Components

### 1. Recommendation Engine (`server/ml/recommendations.ts`)

**Features:**
- User embedding based on interests & languages (vectorization)
- Cosine similarity for collaborative filtering
- Match probability prediction
- Ranked discovery (ML-sorted profiles)

**Algorithm:**
```typescript
Similarity = (interest_similarity * 0.7) + (age_similarity * 0.3)
```

### 2. Ad Targeting Engine (`server/ml/adTargeting.ts`)

**User Segments:**
- `travel_interest`, `fitness_interest`, `music_interest`, `food_interest`
- `young_adult` (18-25), `mid_adult` (26-35), `mature_adult` (36-50)
- `active_swiper`, `active_user`, `high_match_rate`, `low_match_rate`
- `new_user`, `returning_user`

**Ad Campaigns:**
- Premium Subscription Promo (high engagement users)
- Dating Coach App (low match rate users)
- Travel Dating App (travel interest + premium)
- Fitness App (fitness interest + young adult)
- Music App (music interest + active)
- Food App (food interest)

## API Endpoints

### ML Recommendations

```bash
# Initialize ML engines
POST /api/ml/init

# Find similar users (collaborative filtering)
GET /api/ml/similar/:userId?limit=10

# Predict match probability
GET /api/ml/match-probability/:userId1/:userId2

# Rank users for discovery (ML-powered)
GET /api/ml/rank/discover/:userId
```

### Ad Targeting

```bash
# Get user segments
GET /api/ml/segments/:userId

# Select ad for user
GET /api/ml/ad/select/:userId/:position

# Track ad click
POST /api/ml/ad/click/:adId

# Get ad statistics
GET /api/ml/ad/stats

# Refresh user segments
POST /api/ml/segments/refresh
```

## Usage Example

```javascript
// Get ML-ranked discovery users
const response = await fetch('http://localhost:3001/api/users/discover', {
  headers: { 'x-user-id': userId }
});

// Returns users sorted by ML-predicted compatibility
```

## How It Works

### Discovery Ranking Flow
1. Fetch 50 candidate users (filtered by age/preferences/swipes)
2. Create interest vectors for each user
3. Compute cosine similarity with current user
4. Rank by similarity score
5. Return top 20 ranked users

### Ad Targeting Flow
1. Compute user segments from behavior (swipes, messages, matches)
2. Match user segments to ad campaign targeting rules
3. Select ad with highest CPC / interest match
4. Track impressions and clicks for optimization

## Performance

- Vector size: 52 dimensions (40 interests + 12 languages)
- Similarity computation: O(n) per user comparison
- Scales to 5M+ users with proper indexing
- Refresh segments on-demand or scheduled

## Future Improvements

- Add XGBoost for click prediction
- Implement matrix factorization (SVD)
- Add real-time model updates
- A/B testing for recommendation algorithms
- Deep learning embeddings for better similarity