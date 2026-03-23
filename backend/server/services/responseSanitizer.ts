export class ResponseSanitizer {
  private static SENSITIVE_FIELDS = [
    'password_hash',
    'password',
    'salt',
    'device_id',
    'ip_address',
    'last_ip',
    'session_token',
    'refresh_token',
    'api_key',
    'secret',
    'credit_card',
    'ssn',
    'date_of_birth',
    'real_age'
  ];

  static filterUser(user: any): any {
    if (!user) return null;

    const filtered: any = {};
    const allowed = [
      'id', 'email', 'name', 'age', 'sex', 'location', 'bio', 'images',
      'is_verified', 'is_premium', 'interests', 'languages', 'latitude', 'longitude',
      'created_at', 'updated_at', 'last_active', 'profile_complete',
      'age_verified', 'phone_verified', 'email_verified', 'face_verified'
    ];

    for (const key of allowed) {
      if (user[key] !== undefined) {
        filtered[key] = user[key];
      }
    }

    return filtered;
  }

  static filterMatch(match: any): any {
    if (!match) return null;

    return {
      id: match.id,
      user1_id: match.user1_id,
      user2_id: match.user2_id,
      created_at: match.created_at
    };
  }

  static filterMessage(message: any): any {
    if (!message) return null;

    return {
      id: message.id,
      match_id: message.match_id,
      sender_id: message.sender_id,
      text: message.text,
      read: message.read,
      created_at: message.created_at
    };
  }

  static filterProfile(user: any, viewerId?: string): any {
    if (!user) return null;

    const publicProfile = {
      id: user.id,
      name: user.name,
      age: user.age,
      location: user.location,
      bio: user.bio,
      images: user.images || [],
      is_verified: user.is_verified,
      interests: user.interests || [],
      languages: user.languages || [],
      distance: user.distance
    };

    if (viewerId && viewerId === user.id) {
      return {
        ...publicProfile,
        email: user.email,
        phone: user.phone,
        is_premium: user.is_premium,
        premium_expires_at: user.premium_expires_at,
        last_active: user.last_active
      };
    }

    return publicProfile;
  }

  static sanitizeObject(obj: any, allowedFields?: string[]): any {
    if (!obj) return null;
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, allowedFields));
    }

    const fields = allowedFields || Object.keys(obj);
    const sanitized: any = {};

    for (const key of fields) {
      if (obj[key] !== undefined) {
        if (this.SENSITIVE_FIELDS.includes(key.toLowerCase())) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = obj[key];
        }
      }
    }

    return sanitized;
  }

  static removeSensitive<T extends Record<string, any>>(obj: T, additionalFields: string[] = []): T {
    if (!obj) return obj;

    const allSensitive = [...this.SENSITIVE_FIELDS, ...additionalFields];
    const sanitized = { ...obj };

    for (const field of allSensitive) {
      if (field in sanitized) {
        delete (sanitized as any)[field];
      }
    }

    return sanitized;
  }
}

export const responseSanitizer = ResponseSanitizer;
