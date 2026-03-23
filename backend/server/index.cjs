const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const dbPath = path.join(process.cwd(), 'data', 'dating.db');

function initDb() {
  let db;
  try {
    const initSqlJs = require('sql.js');
    return initSqlJs().then(SQL => {
      if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
      } else {
        db = new SQL.Database();
      }
      
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          age INTEGER NOT NULL,
          location TEXT,
          bio TEXT,
          images TEXT DEFAULT '[]',
          is_verified INTEGER DEFAULT 0,
          interests TEXT DEFAULT '[]',
          languages TEXT DEFAULT '[]',
          created_at TEXT,
          updated_at TEXT
        )
      `);

      ['swipes', 'matches', 'messages', 'blocks', 'reports', 'user_preferences'].forEach(table => {
        try { db.run(`SELECT 1 FROM ${table} LIMIT 1`) } catch(e) { 
          db.run(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`)
        }
      });

      return db;
    });
  } catch(e) { console.error(e); throw e; }
}

function generateId() { return crypto.randomUUID(); }

function saveDb() {}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(console.error);