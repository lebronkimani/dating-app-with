-- GlobalConnect Dating App - PostgreSQL Schema
-- Production-level design for 5M+ users
-- Supports: Authentication, Swipes, Matches, Messaging, Subscriptions, Ads, ML

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & IDENTITY
-- ============================================

-- Users table (core account data)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    username VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    age INTEGER NOT NULL CHECK (age >= 18 AND age <= 120),
    gender VARCHAR(20) NOT NULL CHECK (gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say')),
    looking_for VARCHAR(50) DEFAULT 'all',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_verified BOOLEAN DEFAULT false,
    is_banned BOOLEAN DEFAULT false,
    show_distance BOOLEAN DEFAULT true,
    
    -- Premium fields
    is_premium BOOLEAN DEFAULT false,
    premium_expires_at TIMESTAMP,
    daily_swipe_limit INTEGER DEFAULT 100,
    
    -- Device and location tracking
    ip_address VARCHAR(45),
    device_id VARCHAR(255),
    last_login_ip VARCHAR(45),
    login_count INTEGER DEFAULT 0
);

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_age ON users(age);
CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active DESC);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- User profiles (extended profile attributes)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT,
    height INT,
    education VARCHAR(100),
    occupation VARCHAR(100),
    religion VARCHAR(50),
    drinking VARCHAR(20) CHECK (drinking IN ('never', 'sometimes', 'regularly')),
    smoking VARCHAR(20) CHECK (smoking IN ('never', 'sometimes', 'regularly')),
    profile_completion INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    upload_order INT DEFAULT 0,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_primary ON photos(user_id, is_primary) WHERE is_primary = true;

-- User locations (geolocation data)
CREATE TABLE IF NOT EXISTS user_locations (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    city VARCHAR(100),
    country VARCHAR(100),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_locations_coords ON user_locations(latitude, longitude);

-- User interests
CREATE TABLE IF NOT EXISTS user_interests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    interest VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, interest)
);

CREATE INDEX IF NOT EXISTS idx_user_interests_user_id ON user_interests(user_id);

-- User languages
CREATE TABLE IF NOT EXISTS user_languages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    language VARCHAR(50) NOT NULL,
    proficiency VARCHAR(20) DEFAULT 'native',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, language)
);

CREATE INDEX IF NOT EXISTS idx_user_languages_user_id ON user_languages(user_id);

-- ============================================
-- DISCOVERY & MATCHING
-- ============================================

-- Preferences table
CREATE TABLE IF NOT EXISTS preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    min_age INTEGER DEFAULT 18,
    max_age INTEGER DEFAULT 50,
    max_distance_km INTEGER DEFAULT 50,
    preferred_gender VARCHAR(20) DEFAULT 'all',
    show_distance BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_preferences_user_id ON preferences(user_id);

-- Swipes table (tracks every swipe action for ML training)
CREATE TABLE IF NOT EXISTS swipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL CHECK (action IN ('like', 'dislike', 'superlike')),
    time_spent_seconds INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_swipes_user_id ON swipes(user_id);
CREATE INDEX IF NOT EXISTS idx_swipes_target_user_id ON swipes(target_user_id);
CREATE INDEX IF NOT EXISTS idx_swipes_action ON swipes(action);
CREATE INDEX IF NOT EXISTS idx_swipes_created_at ON swipes(created_at DESC);

-- Likes table (positive likes only - for "Likes You" feature)
CREATE TABLE IF NOT EXISTS likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    liker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_match BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(liker_id, liked_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_liker_id ON likes(liker_id);
CREATE INDEX IF NOT EXISTS idx_likes_liked_id ON likes(liked_id);
CREATE INDEX IF NOT EXISTS idx_likes_created_at ON likes(created_at DESC);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'unmatched', 'blocked')),
    matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unmatched_at TIMESTAMP,
    UNIQUE(user1_id, user2_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_user1_id ON matches(user1_id);
CREATE INDEX IF NOT EXISTS idx_matches_user2_id ON matches(user2_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_matched_at ON matches(matched_at DESC);

-- ============================================
-- MESSAGING
-- ============================================

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_text TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_match_id ON messages(match_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_match_sent ON messages(match_id, sent_at DESC);

-- Message attachments
CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_type VARCHAR(20) CHECK (file_type IN ('image', 'video', 'audio')),
    thumbnail_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);

-- ============================================
-- SAFETY
-- ============================================

-- Blocks table
CREATE TABLE IF NOT EXISTS blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(blocker_id, blocked_user_id)
);

CREATE INDEX IF NOT idx_blocks_blocker_id ON blocks(blocker_id);
CREATE INDEX IF NOT idx_blocks_blocked_id ON blocks(blocked_user_id);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(50) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'action_taken', 'dismissed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_id ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- ============================================
-- MONETIZATION
-- ============================================

-- Subscription plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    duration_days INT NOT NULL,
    features JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default plans
INSERT INTO subscription_plans (name, price, duration_days, features) VALUES
('Premium Monthly', 9.99, 30, '{"unlimited_swipes": true, "super_likes": true, "see_likes": true, "ad_free": true}'),
('Premium 6 Months', 49.99, 180, '{"unlimited_swipes": true, "super_likes": true, "see_likes": true, "ad_free": true, "boost": true}'),
('Premium Year', 79.99, 365, '{"unlimited_swipes": true, "super_likes": true, "see_likes": true, "ad_free": true, "boost": true, "priority": true}');

-- User subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'refunded')),
    auto_renew BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_end_date ON user_subscriptions(end_date);

-- ============================================
-- ADS
-- ============================================

-- Ads table
CREATE TABLE IF NOT EXISTS ads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ad_network VARCHAR(50),
    ad_type VARCHAR(20) NOT NULL CHECK (ad_type IN ('rewarded', 'banner', 'interstitial', 'native')),
    reward_type VARCHAR(20),
    content_url TEXT,
    destination_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default ads
INSERT INTO ads (ad_network, ad_type, reward_type, content_url, destination_url) VALUES
('internal', 'rewarded', 'super_like', 'https://example.com/ads/super_like.mp4', NULL),
('internal', 'rewarded', 'like_reveal', 'https://example.com/ads/like_reveal.mp4', NULL),
('internal', 'interstitial', NULL, 'https://example.com/ads/interstitial.mp4', NULL),
('internal', 'banner', NULL, 'https://example.com/ads/banner.png', 'https://example.com/premium');

-- Ad views
CREATE TABLE IF NOT EXISTS ad_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ad_id UUID REFERENCES ads(id) ON DELETE CASCADE,
    placement VARCHAR(50),
    watched_duration_seconds INT DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    reward_granted BOOLEAN DEFAULT false,
    watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ad_views_user_id ON ad_views(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_ad_id ON ad_views(ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_views_watched_at ON ad_views(watched_at DESC);

-- Ad reveals (Sunday reveal system)
CREATE TABLE IF NOT EXISTS ad_reveals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revealed_liker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    revealed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_number, year)
);

CREATE INDEX IF NOT EXISTS idx_ad_reveals_user ON ad_reveals(user_id, week_number, year);

-- ============================================
-- NOTIFICATIONS
-- ============================================

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(100) NOT NULL,
    body TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Device tokens
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('ios', 'android', 'web')),
    token TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, device_type, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token);

-- ============================================
-- MACHINE LEARNING
-- ============================================

-- User activity (engagement tracking)
CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type VARCHAR(30) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity(activity_type);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC);

-- ML user features (precomputed features for recommendations)
CREATE TABLE IF NOT EXISTS ml_user_features (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    swipe_rate FLOAT DEFAULT 0,
    match_rate FLOAT DEFAULT 0,
    response_rate FLOAT DEFAULT 0,
    profile_score FLOAT DEFAULT 0,
    popularity_score FLOAT DEFAULT 0,
    last_calculated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ml_user_features_user_id ON ml_user_features(user_id);

-- Recommendations (predicted match probabilities)
CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score FLOAT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user_id ON recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_score ON recommendations(score DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_generated ON recommendations(generated_at DESC);

-- Profile views
CREATE TABLE IF NOT EXISTS profile_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(viewer_id, profile_id, viewed_at::date)
);

CREATE INDEX IF NOT EXISTS idx_profile_views_viewer_id ON profile_views(viewer_id);
CREATE INDEX IF NOT EXISTS idx_profile_views_profile_id ON profile_views(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_views_viewed_at ON profile_views(viewed_at DESC);

-- ============================================
-- VERIFICATION
-- ============================================

-- Verifications
CREATE TABLE IF NOT EXISTS verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('email', 'phone', 'photo', 'identity')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    code VARCHAR(20),
    expires_at TIMESTAMP,
    verified_at TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, type)
);

CREATE INDEX IF NOT EXISTS idx_verifications_user_id ON verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status);

-- ============================================
-- SUPER LIKES
-- ============================================

-- Super likes
CREATE TABLE IF NOT EXISTS super_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sender_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_super_likes_sender_id ON super_likes(sender_id);
CREATE INDEX IF NOT EXISTS idx_super_likes_target_id ON super_likes(target_id);

-- Super like credits
CREATE TABLE IF NOT EXISTS super_like_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits INTEGER DEFAULT 0,
    last_sunday DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_super_like_credits_user_id ON super_like_credits(user_id);

-- ============================================
-- OTP (One-Time Password) Tables
-- ============================================

-- OTP records (for tracking and analytics)
CREATE TABLE IF NOT EXISTS otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20) NOT NULL,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('verification', 'login', 'password_reset')),
    code_hash VARCHAR(64) NOT NULL,
    attempts INTEGER DEFAULT 0,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otps_phone ON otps(phone);
CREATE INDEX IF NOT EXISTS idx_otps_purpose ON otps(purpose);
CREATE INDEX IF NOT EXISTS idx_otps_created_at ON otps(created_at DESC);

-- OTP attempts tracking
CREATE TABLE IF NOT EXISTS otp_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    otp_id UUID REFERENCES otps(id) ON DELETE CASCADE,
    attempts INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(otp_id)
);

-- OTP verifications
CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    otp_id UUID REFERENCES otps(id) ON DELETE CASCADE,
    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    UNIQUE(otp_id)
);

-- Add phone_verified column to users if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'phone_verified') THEN
        ALTER TABLE users ADD COLUMN phone_verified BOOLEAN DEFAULT false;
    END IF;
END $$;

-- ============================================
-- MODERATION TABLES
-- ============================================

-- User moderation status (warnings, strikes, bans)
CREATE TABLE IF NOT EXISTS user_moderation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    warning_count INTEGER DEFAULT 0,
    strike_count INTEGER DEFAULT 0,
    risk_score INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'warning', 'restricted', 'temporary_ban', 'permanent_ban', 'shadow_banned')),
    last_warning_date TIMESTAMP,
    ban_until TIMESTAMP,
    restricted_until TIMESTAMP,
    restricted_features JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_moderation_user_id ON user_moderation(user_id);
CREATE INDEX IF NOT EXISTS idx_user_moderation_status ON user_moderation(status);
CREATE INDEX IF NOT EXISTS idx_user_moderation_risk_score ON user_moderation(risk_score DESC);

-- User reports (when users report other users)
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(50) NOT NULL CHECK (reason IN ('spam', 'harassment', 'fake_profile', 'inappropriate_photos', 'underage', 'scam', 'other')),
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'ai_screening', 'under_review', 'resolved', 'dismissed')),
    ai_confidence DECIMAL(5,4),
    reviewed_by UUID,
    resolution VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_user_id ON reports(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);

-- Confirmed violations
CREATE TABLE IF NOT EXISTS violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    source VARCHAR(20) NOT NULL CHECK (source IN ('ai_detection', 'user_report', 'moderator', 'spam_detection')),
    description TEXT,
    evidence JSONB,
    report_id UUID REFERENCES reports(id),
    reviewed_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_violations_user_id ON violations(user_id);
CREATE INDEX IF NOT EXISTS idx_violations_type ON violations(type);
CREATE INDEX IF NOT EXISTS idx_violations_created_at ON violations(created_at DESC);

-- Banned users (permanent ban blacklist)
CREATE TABLE IF NOT EXISTS banned_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    original_user_id UUID,
    email VARCHAR(255),
    phone VARCHAR(20),
    device_id VARCHAR(255),
    ip_address VARCHAR(45),
    reason VARCHAR(255),
    banned_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(email),
    UNIQUE(phone),
    UNIQUE(device_id)
);

CREATE INDEX IF NOT EXISTS idx_banned_users_email ON banned_users(email);
CREATE INDEX IF NOT EXISTS idx_banned_users_phone ON banned_users(phone);
CREATE INDEX IF NOT EXISTS idx_banned_users_device_id ON banned_users(device_id);

-- User blocks (user-to-user blocking)
CREATE TABLE IF NOT EXISTS blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blocker_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker_user_id ON blocks(blocker_user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_user_id ON blocks(blocked_user_id);

-- Moderation logs (audit trail)
CREATE TABLE IF NOT EXISTS moderation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    moderator_id UUID REFERENCES users(id),
    target_user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL CHECK (action IN ('warning', 'restriction', 'lift_restriction', 'temporary_ban', 'lift_ban', 'permanent_ban', 'shadow_ban', 'lift_shadow_ban', 'content_removed', 'appeal_granted', 'appeal_denied')),
    reason TEXT,
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    duration VARCHAR(50),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_moderator_id ON moderation_logs(moderator_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_target_user_id ON moderation_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_created_at ON moderation_logs(created_at DESC);

-- Spam detection logs
CREATE TABLE IF NOT EXISTS spam_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_count INTEGER DEFAULT 1,
    time_window_seconds INTEGER,
    ip_address VARCHAR(45),
    device_id VARCHAR(255),
    flagged BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spam_logs_user_id ON spam_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_spam_logs_flagged ON spam_logs(flagged);
CREATE INDEX IF NOT EXISTS idx_spam_logs_created_at ON spam_logs(created_at DESC);

-- Content moderation queue (for AI-reviewed content)
CREATE TABLE IF NOT EXISTS content_moderation_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('photo', 'message', 'bio', 'profile')),
    content_id UUID NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content_url TEXT,
    content_text TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'needs_review')),
    ai_confidence DECIMAL(5,4),
    ai_labels JSONB,
    rejection_reason VARCHAR(255),
    reviewed_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_moderation_queue_status ON content_moderation_queue(status);
CREATE INDEX IF NOT EXISTS idx_content_moderation_queue_user_id ON content_moderation_queue(user_id);

-- ============================================
-- PERSISTENT EVENT QUEUE (for async processing)
-- ============================================

CREATE TABLE IF NOT EXISTS event_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    user_id UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    scheduled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_queue_status ON event_queue(status);
CREATE INDEX IF NOT EXISTS idx_event_queue_type ON event_queue(event_type);
CREATE INDEX IF NOT EXISTS idx_event_queue_user_id ON event_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_event_queue_scheduled ON event_queue(scheduled_at);

-- ============================================
-- CONCURRENCY OPTIMIZATIONS
-- ============================================

-- Add partial index for active matches only
CREATE INDEX IF NOT EXISTS idx_matches_active_user1 ON matches(user1_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_matches_active_user2 ON matches(user2_id) WHERE status = 'active';

-- Add partial index for unread messages
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(match_id, is_read) WHERE is_read = false;

-- Add composite index for swipe detection (prevent duplicates)
CREATE INDEX IF NOT EXISTS idx_swipes_direction ON swipes(swiper_id, direction) WHERE direction IN ('right', 'super');

-- Add index for online presence tracking
CREATE INDEX IF NOT EXISTS idx_presence_user ON user_moderation(user_id) WHERE status = 'active';

-- ============================================
-- DEVICE FINGERPRINTING
-- ============================================

CREATE TABLE IF NOT EXISTS device_fingerprints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fingerprint VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT,
    screen_resolution VARCHAR(20),
    timezone VARCHAR(50),
    language VARCHAR(10),
    platform VARCHAR(50),
    ip_address VARCHAR(45),
    country VARCHAR(50),
    isp VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_fingerprint ON device_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_user_id ON device_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_device_ip ON device_fingerprints(ip_address);
CREATE INDEX IF NOT EXISTS idx_device_created ON device_fingerprints(created_at DESC);

-- Add device_fingerprint column to users table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'device_fingerprint') THEN
        ALTER TABLE users ADD COLUMN device_fingerprint VARCHAR(100);
    END IF;
END $$;

-- Add location tracking columns to users table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_location_lat') THEN
        ALTER TABLE users ADD COLUMN last_location_lat DECIMAL(10, 8);
        ALTER TABLE users ADD COLUMN last_location_lon DECIMAL(11, 8);
    END IF;
END $$;

-- ============================================
-- SECURITY LOGGING
-- ============================================

CREATE TABLE IF NOT EXISTS security_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES users(id),
    ip_address VARCHAR(45),
    user_agent TEXT,
    resource VARCHAR(100),
    action VARCHAR(50),
    result VARCHAR(20) CHECK (result IN ('success', 'failure')),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON security_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_logs_event ON security_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at DESC);

-- Add role column to users
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role') THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'moderator', 'support', 'user'));
    END IF;
END $$;

-- Add api_key column to users
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'api_key') THEN
        ALTER TABLE users ADD COLUMN api_key VARCHAR(100) UNIQUE);
    END IF;
END $$;

-- Connection pool settings (run these separately)
-- ALTER SYSTEM SET max_connections = 500;
-- ALTER SYSTEM SET shared_buffers = '2GB';
-- ALTER SYSTEM SET effective_cache_size = '6GB';
-- ALTER SYSTEM SET work_mem = '16MB';
-- ANALYZE to update statistics
ANALYZE;
