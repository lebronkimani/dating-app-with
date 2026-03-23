import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getPool, generateId } from '../db/init';
import { validationService } from '../services/validation';
import { rateLimit } from '../middleware/rateLimit';
import { authService } from '../services/auth';

const router = Router();

const VALIDATE_REGISTRATION = [
  (req: Request, res: Response, next: Function) => {
    const { email, password, name, age } = req.body;
    
    const emailCheck = validationService.validateEmail(email);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: emailCheck.error });
    }
    
    const passwordCheck = validationService.validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ error: passwordCheck.error });
    }
    
    if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Name is required (1-100 characters)' });
    }
    
    const ageCheck = validationService.validateAge(age);
    if (!ageCheck.valid) {
      return res.status(400).json({ error: ageCheck.error });
    }
    
    next();
  }
];

router.post('/register', rateLimit('register'), VALIDATE_REGISTRATION, async (req: Request, res: Response) => {
  try {
    const { email, password, name, age, location, bio, interests, languages } = req.body;

    const pool = getPool();
    
    const existingResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, age, location, bio, interests, languages)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, name, age, location, bio, images, is_verified, interests, languages, created_at`,
      [email.toLowerCase(), passwordHash, name.trim(), age, location || null, bio || null, interests || [], languages || []]
    );

    await pool.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [userResult.rows[0].id]);

    const user = userResult.rows[0];
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        age: user.age,
        location: user.location,
        bio: user.bio,
        images: user.images || [],
        isVerified: user.is_verified,
        interests: user.interests || [],
        languages: user.languages || []
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', rateLimit('login'), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const emailCheck = validationService.validateEmail(email);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const pool = getPool();
    const result = await pool.query(
      'SELECT id, email, password_hash, name, age, is_banned FROM users WHERE email = $1', 
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    
    if (user.is_banned) {
      return res.status(403).json({ error: 'Account has been suspended' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = authService.generateAccessToken(user.id, user.email);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        age: user.age,
        location: user.location,
        bio: user.bio,
        images: user.images || [],
        isVerified: user.is_verified,
        interests: user.interests || [],
        languages: user.languages || []
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;