export class ValidationService {
  private readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private readonly PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;
  private readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  private readonly PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  validateEmail(email: string): { valid: boolean; error?: string } {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: 'Email is required' };
    }

    const trimmed = email.trim().toLowerCase();
    
    if (trimmed.length < 3 || trimmed.length > 255) {
      return { valid: false, error: 'Email must be between 3 and 255 characters' };
    }

    if (!this.EMAIL_REGEX.test(trimmed)) {
      return { valid: false, error: 'Invalid email format' };
    }

    return { valid: true };
  }

  validatePassword(password: string): { valid: boolean; error?: string } {
    if (!password || typeof password !== 'string') {
      return { valid: false, error: 'Password is required' };
    }

    if (password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters' };
    }

    if (!this.PASSWORD_REGEX.test(password)) {
      return { 
        valid: false, 
        error: 'Password must contain uppercase, lowercase, number, and special character' 
      };
    }

    return { valid: true };
  }

  validatePhone(phone: string): { valid: boolean; error?: string } {
    if (!phone || typeof phone !== 'string') {
      return { valid: false, error: 'Phone is required' };
    }

    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length < 10 || cleaned.length > 15) {
      return { valid: false, error: 'Invalid phone number' };
    }

    return { valid: true };
  }

  validateUUID(id: string): { valid: boolean; error?: string } {
    if (!id || typeof id !== 'string') {
      return { valid: false, error: 'ID is required' };
    }

    if (!this.UUID_REGEX.test(id)) {
      return { valid: false, error: 'Invalid UUID format' };
    }

    return { valid: true };
  }

  validateAge(age: number): { valid: boolean; error?: string } {
    if (typeof age !== 'number' || isNaN(age)) {
      return { valid: false, error: 'Age must be a number' };
    }

    if (age < 18 || age > 120) {
      return { valid: false, error: 'Age must be between 18 and 120' };
    }

    return { valid: true };
  }

  validateCoordinates(lat: number, lon: number): { valid: boolean; error?: string } {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return { valid: false, error: 'Coordinates must be numbers' };
    }

    if (lat < -90 || lat > 90) {
      return { valid: false, error: 'Latitude must be between -90 and 90' };
    }

    if (lon < -180 || lon > 180) {
      return { valid: false, error: 'Longitude must be between -180 and 180' };
    }

    return { valid: true };
  }

  sanitizeString(input: string, maxLength: number = 1000): string {
    if (!input || typeof input !== 'string') return '';
    
    return input
      .trim()
      .slice(0, maxLength)
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '');
  }

  validateRequiredFields(data: Record<string, any>, required: string[]): { valid: boolean; missing?: string } {
    for (const field of required) {
      if (!data[field] && data[field] !== 0 && data[field] !== false) {
        return { valid: false, missing: field };
      }
    }
    return { valid: true };
  }

  validateSwipeDirection(direction: string): { valid: boolean; error?: string } {
    const validDirections = ['left', 'right', 'super'];
    if (!validDirections.includes(direction)) {
      return { valid: false, error: 'Invalid swipe direction' };
    }
    return { valid: true };
  }

  validateMessageText(text: string): { valid: boolean; error?: string } {
    if (!text || typeof text !== 'string') {
      return { valid: false, error: 'Message is required' };
    }

    if (text.length > 10000) {
      return { valid: false, error: 'Message too long (max 10000 characters)' };
    }

    if (text.length === 0 || text.trim().length === 0) {
      return { valid: false, error: 'Message cannot be empty' };
    }

    return { valid: true };
  }
}

export const validationService = new ValidationService();
