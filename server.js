require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csurf = require('csurf');
const { body, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_too';
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// DB (SQLite)
const dbPath = path.join(DATA_DIR, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Failed to open database', err);
});

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS posts(
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    content TEXT NOT NULL,
    date TEXT NOT NULL
  )`);
});

// Middlewares
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 3600000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// CSRF protection (will be applied selectively)
const csrfProtection = csurf();

// Rate limiter for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток, попробуйте позже' }
});

function readPosts(callback) {
  db.all('SELECT * FROM posts ORDER BY date DESC', [], (err, rows) => {
    if (err) return callback(err);
    callback(null, rows || []);
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Необходима авторизация' });
}

app.get('/api/posts', (req, res) => {
  readPosts((err, posts) => {
    if (err) return res.status(500).json({ error: 'Ошибка чтения постов' });
    res.json(posts);
  });
});

// Provide CSRF token for clients (requires a session)
app.get('/api/csrf-token', (req, res) => {
  try {
    const token = req.csrfToken ? req.csrfToken() : null;
    // If csurf is not applied globally, create token by applying middleware on the fly
    if (!token) {
      // apply csurf middleware then return token
      csrfProtection(req, res, (err) => {
        if (err) return res.status(500).json({ error: 'CSRF init error' });
        return res.json({ csrfToken: req.csrfToken() });
      });
    } else {
      res.json({ csrfToken: token });
    }
  } catch (e) {
    // If no session exists yet, create one and send token
    csrfProtection(req, res, (err) => {
      if (err) return res.status(500).json({ error: 'CSRF init error' });
      return res.json({ csrfToken: req.csrfToken() });
    });
  }
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string') return res.status(400).json({ success: false, message: 'Неверные данные' });
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true, message: 'Авторизован' });
  }
  return res.status(401).json({ success: false, message: 'Неверный пароль' });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.post('/api/admin/logout', csrfProtection, requireAuth, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Ошибка выхода' });
    res.json({ success: true });
  });
});

app.post('/api/posts', express.json(), csrfProtection, requireAuth,
  body('title').isLength({ min: 1 }).trim(),
  body('content').isLength({ min: 1 }).trim(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    let { title, category, content } = req.body;
    title = String(title);
    category = category ? String(category) : 'Политика';
    // Strip any HTML
    content = sanitizeHtml(String(content), { allowedTags: [], allowedAttributes: {} });

    const id = Date.now().toString();
    const date = new Date().toLocaleDateString('ru-RU');

    db.run('INSERT INTO posts(id, title, category, content, date) VALUES (?, ?, ?, ?, ?)', [id, title, category, content, date], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка записи' });
      return res.status(201).json({ id, title, category, content, date });
    });
  }
);

app.put('/api/posts/:id', express.json(), csrfProtection, requireAuth,
  body('title').isLength({ min: 1 }).trim(),
  body('content').isLength({ min: 1 }).trim(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    let { title, category, content } = req.body;
    title = String(title);
    category = category ? String(category) : 'Политика';
    content = sanitizeHtml(String(content), { allowedTags: [], allowedAttributes: {} });

    db.run('UPDATE posts SET title = ?, category = ?, content = ? WHERE id = ?', [title, category, content, id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Новость не найдена' });
      db.get('SELECT * FROM posts WHERE id = ?', [id], (err2, row) => {
        if (err2) return res.status(500).json({ error: 'Ошибка чтения' });
        res.json(row);
      });
    });
  }
);

app.delete('/api/posts/:id', csrfProtection, requireAuth, (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM posts WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: 'Ошибка удаления' });
    return res.json({ success: true });
  });
});

// Error handler for CSRF
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Неверный CSRF токен' });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('Сайт REPUBLIC успешно запущен!');
  console.log(`Адрес: http://localhost:${PORT}`);
  console.log('========================================');
});
