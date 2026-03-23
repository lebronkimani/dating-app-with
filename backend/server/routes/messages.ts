import { Router, Request, Response } from 'express';
import { getPool, generateId } from '../db/init';
import { sqlInjectionDetector } from '../services/sqlInjectionPrevention';

const router = Router();

const ALLOWED_SORT_FIELDS = ['created_at', 'id', 'sender_id', 'text'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

router.get('/:matchId', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { matchId } = req.params;
  const sortBy = sqlInjectionDetector.validateOrderByField(req.query.sort as string, ALLOWED_SORT_FIELDS) || 'created_at';
  const limit = Math.min(sqlInjectionDetector.validateLimit(req.query.limit), MAX_LIMIT);
  const offset = sqlInjectionDetector.validateOffset(req.query.offset);

  const pool = getPool();

  const matchResult = await pool.query(
    `SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
    [matchId, userId]
  );

  if (matchResult.rows.length === 0) {
    return res.status(404).json({ error: 'Match not found' });
  }

  await pool.query(
    `UPDATE messages SET read = true WHERE match_id = $1 AND sender_id != $2`,
    [matchId, userId]
  );

  const messagesResult = await pool.query(
    `SELECT id, sender_id, text, read, created_at
     FROM messages WHERE match_id = $1 ORDER BY ${sortBy} ASC LIMIT $2 OFFSET $3`,
    [matchId, limit, offset]
  );

  const messages = messagesResult.rows.map((m: any) => ({
    id: m.id,
    senderId: m.sender_id,
    text: m.text,
    timestamp: m.created_at,
    isRead: m.read
  }));

  res.json(messages);
});

router.post('/:matchId', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { matchId } = req.params;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Missing message text' });
  }

  const pool = getPool();

  const matchResult = await pool.query(
    `SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
    [matchId, userId]
  );

  if (matchResult.rows.length === 0) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const result = await pool.query(
    `INSERT INTO messages (match_id, sender_id, text) VALUES ($1, $2, $3)
     RETURNING *`,
    [matchId, userId, text]
  );

  const message = result.rows[0];
  res.status(201).json({
    id: message.id,
    senderId: message.sender_id,
    text: message.text,
    timestamp: message.created_at,
    isRead: message.read
  });
});

export default router;