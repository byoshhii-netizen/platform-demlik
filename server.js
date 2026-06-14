const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const slugify = require('slugify');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'persistent', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

const SITE_URL = process.env.SITE_URL || 'https://demlikforum.up.railway.app';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /panel-giris\nDisallow: /ayarlar\nSitemap: ${SITE_URL}/sitemap.xml`);
});

app.get('/sitemap.xml', (req, res) => {
  const forums = db.prepare('SELECT slug, title, banner_image, updated_at FROM forums').all();
  const books = db.prepare('SELECT slug, updated_at FROM books').all();
  const groups = db.prepare('SELECT slug FROM groups').all();
  const users = db.prepare('SELECT username FROM users').all();

  const staticUrls = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
    { url: '/forum', priority: '0.9', changefreq: 'hourly' },
    { url: '/kitaplar', priority: '0.8', changefreq: 'daily' },
    { url: '/gruplar', priority: '0.7', changefreq: 'daily' }
  ].map(u => `  <url><loc>${SITE_URL}${u.url}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n');

  const forumUrls = forums.map(f => {
    const imgTag = f.banner_image
      ? `\n    <image:image><image:loc>${escapeHtml(f.banner_image)}</image:loc><image:title>${escapeHtml(f.title)}</image:title></image:image>`
      : '';
    const mod = f.updated_at ? `\n    <lastmod>${f.updated_at.replace(' ','T')}</lastmod>` : '';
    return `  <url><loc>${SITE_URL}/forum/${f.slug}</loc>${mod}<changefreq>weekly</changefreq><priority>0.8</priority>${imgTag}\n  </url>`;
  }).join('\n');

  const bookUrls = books.map(b => {
    const mod = b.updated_at ? `\n    <lastmod>${b.updated_at.replace(' ','T')}</lastmod>` : '';
    return `  <url><loc>${SITE_URL}/kitap/${b.slug}</loc>${mod}<changefreq>weekly</changefreq><priority>0.7</priority>\n  </url>`;
  }).join('\n');

  const groupUrls = groups.map(g => `  <url><loc>${SITE_URL}/grup/${g.slug}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`).join('\n');
  const profileUrls = users.map(u => `  <url><loc>${SITE_URL}/profil/${u.username}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`).join('\n');

  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticUrls}
${forumUrls}
${bookUrls}
${groupUrls}
${profileUrls}
</urlset>`);
});

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken(userId) {
  return Buffer.from(JSON.stringify({ id: userId, ts: Date.now(), rand: Math.random() })).toString('base64');
}

const tokens = new Map(); // token -> userId (in-memory, resets on restart)

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !tokens.has(token)) return res.status(401).json({ error: 'Giriï¿½ gerekli' });
  const userId = tokens.get(token);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) return res.status(401).json({ error: 'Kullanï¿½cï¿½ bulunamadï¿½' });
  if (user.banned) return res.status(403).json({ error: 'Hesabï¿½nï¿½z yasaklandï¿½' });
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token && tokens.has(token)) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(tokens.get(token));
    if (user && !user.banned) req.user = user;
  }
  next();
}

function adminMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Admin token gerekli' });
  const setting = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_password');
  if (!setting || token !== setting.value) return res.status(403).json({ error: 'Geï¿½ersiz admin token' });
  next();
}

function makeSlug(title, id) {
  const base = slugify(title, { lower: true, strict: false, locale: 'tr', replacement: '-' })
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').substring(0, 60);
  return base + '-' + id;
}

function updateUserLevel(userId) {
  const user = db.prepare('SELECT forum_count, book_count, comment_count FROM users WHERE id=?').get(userId);
  if (!user) return;
  const levels = db.prepare('SELECT * FROM levels ORDER BY order_num ASC').all();
  let bestLevel = levels[0];
  for (const lv of levels) {
    const minF = lv.min_forums >= 9999999 ? Infinity : lv.min_forums;
    const minB = lv.min_books >= 9999999 ? Infinity : lv.min_books;
    const minC = lv.min_comments >= 9999999 ? Infinity : lv.min_comments;
    if (user.forum_count >= minF && user.book_count >= minB && user.comment_count >= minC) {
      bestLevel = lv;
    }
  }
  db.prepare('UPDATE users SET level_id=? WHERE id=?').run(bestLevel.id, userId);
}

function logAction(actor, action, target = '', detail = '', ip = '') {
  db.prepare('INSERT INTO system_logs (actor,action,target,detail,ip) VALUES (?,?,?,?,?)').run(actor, action, target, detail, ip);
}


app.post('/api/auth/register', (req, res) => {
  const { username, email, password, kvkk_accepted } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Tï¿½m alanlar zorunlu' });
  if (!kvkk_accepted) return res.status(400).json({ error: 'KVKK onayï¿½ zorunlu' });
  if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Kullanï¿½cï¿½ adï¿½ 3-30 karakter olmalï¿½' });
  if (password.length < 6) return res.status(400).json({ error: 'ï¿½ifre en az 6 karakter olmalï¿½' });

  const ip = getIp(req);

  const ipBanned = db.prepare('SELECT * FROM users WHERE banned_ip=? AND ban_type=?').get(ip, 'ip');
  if (ipBanned) return res.status(403).json({ error: 'Bu IP adresi yasaklanmï¿½ï¿½' });

  const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email);
  if (existing) return res.status(400).json({ error: 'Bu kullanï¿½cï¿½ adï¿½ veya e-posta zaten kullanï¿½lï¿½yor' });

  try {
    const result = db.prepare('INSERT INTO users (username, email, password_hash, kvkk_accepted, ip) VALUES (?,?,?,?,?)').run(username, email, hashPassword(password), 1, ip);
    const token = generateToken(result.lastInsertRowid);
    tokens.set(token, result.lastInsertRowid);
    logAction(username, 'register', '', '', ip);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) {
    res.status(400).json({ error: 'Kayï¿½t baï¿½arï¿½sï¿½z: ' + e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Bilgiler eksik' });

  const ip = getIp(req);
  const ipBanned = db.prepare('SELECT * FROM users WHERE banned_ip=? AND ban_type=?').get(ip, 'ip');
  if (ipBanned) return res.status(403).json({ error: 'Bu IP adresi yasaklanmï¿½ï¿½' });

  const user = db.prepare('SELECT * FROM users WHERE (email=? OR username=?)').get(login, login);
  if (!user || user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Hatalï¿½ bilgiler' });
  if (user.banned) return res.status(403).json({ error: 'Hesabï¿½nï¿½z yasaklandï¿½' });

  db.prepare("UPDATE users SET last_active=datetime('now','localtime'), ip=? WHERE id=?").run(ip, user.id);
  const token = generateToken(user.id);
  tokens.set(token, user.id);
  logAction(user.username, 'login', '', '', ip);
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const level = db.prepare('SELECT * FROM levels WHERE id=?').get(req.user.level_id);
  res.json({ user: sanitizeUser(req.user), level });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  tokens.delete(token);
  res.json({ ok: true });
});

function sanitizeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}


app.get('/api/forums', (req, res) => {
  const forums = db.prepare(`
    SELECT f.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus,
      (SELECT COUNT(*) FROM forum_likes WHERE forum_id=f.id) as like_count,
      (SELECT COUNT(*) FROM forum_comments WHERE forum_id=f.id) as comment_count
    FROM forums f LEFT JOIN users u ON f.user_id=u.id
    ORDER BY f.created_at DESC
  `).all();
  res.json(forums);
});

app.get('/api/forum/:slug', optionalAuth, (req, res) => {
  const forum = db.prepare(`
    SELECT f.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus, u.level_id,
      (SELECT COUNT(*) FROM forum_likes WHERE forum_id=f.id) as like_count,
      (SELECT COUNT(*) FROM forum_comments WHERE forum_id=f.id) as comment_count
    FROM forums f LEFT JOIN users u ON f.user_id=u.id
    WHERE f.slug=?
  `).get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  res.json(forum);
});

app.post('/api/forum/:slug/view', (req, res) => {
  const ip = getIp(req);
  const forum = db.prepare('SELECT id FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });

  const existing = db.prepare('SELECT * FROM forum_views WHERE forum_id=? AND ip=?').get(forum.id, ip);
  if (!existing) {
    db.prepare('INSERT INTO forum_views (forum_id, ip, view_count) VALUES (?,?,1)').run(forum.id, ip);
    db.prepare('UPDATE forums SET views=views+1 WHERE id=?').run(forum.id);
  } else if (existing.view_count < 3) {
    db.prepare('UPDATE forum_views SET view_count=view_count+1 WHERE id=?').run(existing.id);
    db.prepare('UPDATE forums SET views=views+1 WHERE id=?').run(forum.id);
  }
  res.json({ ok: true });
});

app.post('/api/forums', authMiddleware, (req, res) => {
  const { title, content, banner_image, allow_comments, tagIds, customTags } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Baï¿½lï¿½k ve iï¿½erik zorunlu' });

  const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
  try {
    const customTagsStr = Array.isArray(customTags) ? customTags.join(',') : (customTags || '');
    const result = db.prepare('INSERT INTO forums (user_id, title, content, banner_image, slug, allow_comments, custom_tags) VALUES (?,?,?,?,?,?,?)').run(
      req.user.id, title, content, banner_image || '', tempSlug, allow_comments !== false ? 1 : 0, customTagsStr
    );
    const realSlug = makeSlug(title, result.lastInsertRowid);
    db.prepare('UPDATE forums SET slug=? WHERE id=?').run(realSlug, result.lastInsertRowid);
    
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const insertTag = db.prepare('INSERT INTO forum_tags (forum_id, tag_id) VALUES (?,?)');
      tagIds.forEach(tagId => {
        try { insertTag.run(result.lastInsertRowid, tagId); } catch {}
      });
    }
    
    db.prepare('UPDATE users SET forum_count=forum_count+1 WHERE id=?').run(req.user.id);
    updateUserLevel(req.user.id);
    logAction(req.user.username, 'create_forum', realSlug);
    const forum = db.prepare('SELECT * FROM forums WHERE id=?').get(result.lastInsertRowid);
    res.json(forum);
  } catch (e) {
    console.error('Konu olusturma hatasi', e);
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/forum/:slug', authMiddleware, (req, res) => {
  const forum = db.prepare('SELECT * FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  if (forum.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });

  const { title, content, banner_image, allow_comments, tagIds, customTags } = req.body;
  const customTagsStr = Array.isArray(customTags) ? customTags.join(',') : (customTags !== undefined ? customTags : forum.custom_tags);
  
  db.prepare("UPDATE forums SET title=?, content=?, banner_image=?, allow_comments=?, custom_tags=?, updated_at=datetime('now','localtime') WHERE id=?").run(
    title || forum.title, content || forum.content, banner_image ?? forum.banner_image, 
    allow_comments !== undefined ? (allow_comments ? 1 : 0) : forum.allow_comments, 
    customTagsStr, forum.id
  );
  
  if (tagIds !== undefined) {
    db.prepare('DELETE FROM forum_tags WHERE forum_id=?').run(forum.id);
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const insertTag = db.prepare('INSERT INTO forum_tags (forum_id, tag_id) VALUES (?,?)');
      tagIds.forEach(tagId => {
        try { insertTag.run(forum.id, tagId); } catch {}
      });
    }
  }
  
  res.json(db.prepare('SELECT * FROM forums WHERE id=?').get(forum.id));
});

app.delete('/api/forum/:slug', authMiddleware, (req, res) => {
  const forum = db.prepare('SELECT * FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  if (forum.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  db.prepare('DELETE FROM forum_comments WHERE forum_id=?').run(forum.id);
  db.prepare('DELETE FROM forum_likes WHERE forum_id=?').run(forum.id);
  db.prepare('DELETE FROM forum_views WHERE forum_id=?').run(forum.id);
  db.prepare('DELETE FROM forums WHERE id=?').run(forum.id);
  db.prepare('UPDATE users SET forum_count=MAX(0,forum_count-1) WHERE id=?').run(req.user.id);
  updateUserLevel(req.user.id);
  logAction(req.user.username, 'delete_forum', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/forum/:slug/like', authMiddleware, (req, res) => {
  const forum = db.prepare('SELECT id FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  const existing = db.prepare('SELECT id FROM forum_likes WHERE forum_id=? AND user_id=?').get(forum.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM forum_likes WHERE id=?').run(existing.id);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO forum_likes (forum_id, user_id) VALUES (?,?)').run(forum.id, req.user.id);
    res.json({ liked: true });
  }
});

app.get('/api/forum/:slug/liked', optionalAuth, (req, res) => {
  if (!req.user) return res.json({ liked: false });
  const forum = db.prepare('SELECT id FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.json({ liked: false });
  const liked = db.prepare('SELECT id FROM forum_likes WHERE forum_id=? AND user_id=?').get(forum.id, req.user.id);
  res.json({ liked: !!liked });
});

app.get('/api/forum/:slug/comments', (req, res) => {
  const forum = db.prepare('SELECT id FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  const comments = db.prepare(`
    SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id,
      (SELECT COUNT(*) FROM forum_comment_likes WHERE comment_id=fc.id) as like_count
    FROM forum_comments fc LEFT JOIN users u ON fc.user_id=u.id
    WHERE fc.forum_id=? ORDER BY fc.created_at ASC
  `).all(forum.id);
  res.json(comments);
});

app.post('/api/forum/:slug/comments/:id/like', authMiddleware, (req, res) => {
  const forum = db.prepare('SELECT id FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  const comment = db.prepare('SELECT id FROM forum_comments WHERE id=? AND forum_id=?').get(req.params.id, forum.id);
  if (!comment) return res.status(404).json({ error: 'Yorum bulunamadï¿½' });
  const existing = db.prepare('SELECT id FROM forum_comment_likes WHERE comment_id=? AND user_id=?').get(comment.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM forum_comment_likes WHERE id=?').run(existing.id);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO forum_comment_likes (comment_id, user_id) VALUES (?,?)').run(comment.id, req.user.id);
    res.json({ liked: true });
  }
});

app.get('/api/forum/:slug/comments/:id/liked', optionalAuth, (req, res) => {
  if (!req.user) return res.json({ liked: false });
  const forum = db.prepare('SELECT id FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.json({ liked: false });
  const liked = db.prepare('SELECT id FROM forum_comment_likes WHERE comment_id=? AND user_id=?').get(req.params.id, req.user.id);
  res.json({ liked: !!liked });
});

app.post('/api/forum/:slug/comments', authMiddleware, (req, res) => {
  const forum = db.prepare('SELECT * FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  if (!forum.allow_comments) return res.status(403).json({ error: 'Yorumlar kapalï¿½' });
  const { content } = req.body;
  if (!content || content.trim().length === 0) return res.status(400).json({ error: 'Yorum boï¿½ olamaz' });
  const result = db.prepare('INSERT INTO forum_comments (forum_id, user_id, content) VALUES (?,?,?)').run(forum.id, req.user.id, content.trim());
  db.prepare('UPDATE users SET comment_count=comment_count+1 WHERE id=?').run(req.user.id);
  updateUserLevel(req.user.id);
  const comment = db.prepare(`SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id FROM forum_comments fc LEFT JOIN users u ON fc.user_id=u.id WHERE fc.id=?`).get(result.lastInsertRowid);
  res.json(comment);
});

app.delete('/api/forum/:slug/comments/:id', authMiddleware, (req, res) => {
  const comment = db.prepare('SELECT * FROM forum_comments WHERE id=?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Yorum bulunamadï¿½' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  db.prepare('DELETE FROM forum_comments WHERE id=?').run(comment.id);
  db.prepare('UPDATE users SET comment_count=MAX(0,comment_count-1) WHERE id=?').run(req.user.id);
  updateUserLevel(req.user.id);
  res.json({ ok: true });
});


app.get('/api/tags', (req, res) => {
  const tags = db.prepare('SELECT * FROM tags WHERE is_system=1 ORDER BY name ASC').all();
  res.json(tags);
});

app.get('/api/forum/:slug/tags', (req, res) => {
  const forum = db.prepare('SELECT id, custom_tags FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadÄ±' });
  const systemTags = db.prepare(`
    SELECT t.* FROM tags t
    INNER JOIN forum_tags ft ON ft.tag_id=t.id
    WHERE ft.forum_id=?
  `).all(forum.id);
  const customTags = forum.custom_tags ? forum.custom_tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  res.json({ systemTags, customTags });
});

app.get('/api/books', (req, res) => {
  const books = db.prepare(`
    SELECT b.*, u.username, u.avatar, u.name_color
    FROM books b LEFT JOIN users u ON b.user_id=u.id
    ORDER BY b.created_at DESC
  `).all();
  res.json(books);
});

app.get('/api/book/:slug', (req, res) => {
  const book = db.prepare(`SELECT b.*, u.username, u.avatar, u.name_color FROM books b LEFT JOIN users u ON b.user_id=u.id WHERE b.slug=?`).get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  const chapters = db.prepare('SELECT * FROM book_chapters WHERE book_id=? ORDER BY order_num ASC').all(book.id);
  const pages = db.prepare('SELECT id, title, page_num, slug, chapter_id FROM book_pages WHERE book_id=? ORDER BY page_num ASC').all(book.id);
  res.json({ book, chapters, pages });
});

app.post('/api/books', authMiddleware, (req, res) => {
  const { title, preface, cover_image } = req.body;
  if (!title) return res.status(400).json({ error: 'Baï¿½lï¿½k zorunlu' });
  const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
  try {
    const result = db.prepare('INSERT INTO books (user_id, title, preface, cover_image, slug) VALUES (?,?,?,?,?)').run(req.user.id, title, preface || '', cover_image || '', tempSlug);
    const realSlug = makeSlug(title, result.lastInsertRowid);
    db.prepare('UPDATE books SET slug=? WHERE id=?').run(realSlug, result.lastInsertRowid);
    db.prepare('UPDATE users SET book_count=book_count+1 WHERE id=?').run(req.user.id);
    updateUserLevel(req.user.id);
    logAction(req.user.username, 'create_book', realSlug);
    res.json(db.prepare('SELECT * FROM books WHERE id=?').get(result.lastInsertRowid));
  } catch (e) {
    console.error('Kitap oluï¿½turma hatasï¿½:', e);
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/book/:slug', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  if (book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, preface, cover_image } = req.body;
  db.prepare("UPDATE books SET title=?, preface=?, cover_image=?, updated_at=datetime('now','localtime') WHERE id=?").run(
    title || book.title, preface ?? book.preface, cover_image ?? book.cover_image, book.id
  );
  res.json(db.prepare('SELECT * FROM books WHERE id=?').get(book.id));
});

app.delete('/api/book/:slug', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  if (book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  db.prepare('DELETE FROM book_pages WHERE book_id=?').run(book.id);
  db.prepare('DELETE FROM book_chapters WHERE book_id=?').run(book.id);
  db.prepare('DELETE FROM books WHERE id=?').run(book.id);
  db.prepare('UPDATE users SET book_count=MAX(0,book_count-1) WHERE id=?').run(req.user.id);
  updateUserLevel(req.user.id);
  logAction(req.user.username, 'delete_book', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/book/:slug/pages', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  if (book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, content, chapter_id, image_url } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Baï¿½lï¿½k ve iï¿½erik zorunlu' });
  const pageCount = db.prepare('SELECT COUNT(*) as c FROM book_pages WHERE book_id=?').get(book.id).c;
  const pageNum = pageCount + 1;
  const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 40) + '-' + Date.now();
  const result = db.prepare('INSERT INTO book_pages (book_id, chapter_id, title, content, page_num, slug, image_url) VALUES (?,?,?,?,?,?,?)').run(book.id, chapter_id || null, title, content, pageNum, tempSlug, image_url || '');
  const realSlug = makeSlug(title, result.lastInsertRowid);
  db.prepare('UPDATE book_pages SET slug=? WHERE id=?').run(realSlug, result.lastInsertRowid);
  db.prepare("UPDATE books SET page_count=page_count+1, updated_at=datetime('now','localtime') WHERE id=?").run(book.id);
  res.json(db.prepare('SELECT * FROM book_pages WHERE id=?').get(result.lastInsertRowid));
});

app.get('/api/book/:slug/page/:pageSlug', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  const page = db.prepare('SELECT * FROM book_pages WHERE slug=? AND book_id=?').get(req.params.pageSlug, book.id);
  if (!page) return res.status(404).json({ error: 'Sayfa bulunamadï¿½' });
  const prev = db.prepare('SELECT slug, title FROM book_pages WHERE book_id=? AND page_num=?').get(book.id, page.page_num - 1);
  const next = db.prepare('SELECT slug, title FROM book_pages WHERE book_id=? AND page_num=?').get(book.id, page.page_num + 1);
  res.json({ page, book, prev, next });
});

app.put('/api/book/:slug/page/:pageSlug', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  if (book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const page = db.prepare('SELECT * FROM book_pages WHERE slug=? AND book_id=?').get(req.params.pageSlug, book.id);
  if (!page) return res.status(404).json({ error: 'Sayfa bulunamadï¿½' });
  const { title, content, chapter_id } = req.body;
  db.prepare('UPDATE book_pages SET title=?, content=?, chapter_id=? WHERE id=?').run(title || page.title, content || page.content, chapter_id ?? page.chapter_id, page.id);
  res.json(db.prepare('SELECT * FROM book_pages WHERE id=?').get(page.id));
});

app.delete('/api/book/:slug/page/:pageSlug', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  if (book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const page = db.prepare('SELECT * FROM book_pages WHERE slug=? AND book_id=?').get(req.params.pageSlug, book.id);
  if (!page) return res.status(404).json({ error: 'Sayfa bulunamadï¿½' });
  db.prepare('DELETE FROM book_pages WHERE id=?').run(page.id);
  db.prepare('UPDATE books SET page_count=MAX(0,page_count-1) WHERE id=?').run(book.id);
  const remaining = db.prepare('SELECT id FROM book_pages WHERE book_id=? ORDER BY page_num ASC').all(book.id);
  remaining.forEach((p, i) => db.prepare('UPDATE book_pages SET page_num=? WHERE id=?').run(i + 1, p.id));
  res.json({ ok: true });
});

app.post('/api/book/:slug/chapters', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  if (book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, order_num } = req.body;
  if (!title) return res.status(400).json({ error: 'Baï¿½lï¿½k zorunlu' });
  const result = db.prepare('INSERT INTO book_chapters (book_id, title, order_num) VALUES (?,?,?)').run(book.id, title, order_num || 0);
  res.json(db.prepare('SELECT * FROM book_chapters WHERE id=?').get(result.lastInsertRowid));
});

app.put('/api/book/:slug/chapter/:id', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book || book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const ch = db.prepare('SELECT * FROM book_chapters WHERE id=? AND book_id=?').get(req.params.id, book.id);
  if (!ch) return res.status(404).json({ error: 'Bï¿½lï¿½m bulunamadï¿½' });
  const { title, order_num } = req.body;
  db.prepare('UPDATE book_chapters SET title=?, order_num=? WHERE id=?').run(title || ch.title, order_num ?? ch.order_num, ch.id);
  res.json(db.prepare('SELECT * FROM book_chapters WHERE id=?').get(ch.id));
});

app.delete('/api/book/:slug/chapter/:id', authMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book || book.user_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const ch = db.prepare('SELECT * FROM book_chapters WHERE id=? AND book_id=?').get(req.params.id, book.id);
  if (!ch) return res.status(404).json({ error: 'Bï¿½lï¿½m bulunamadï¿½' });
  db.prepare('UPDATE book_pages SET chapter_id=NULL WHERE chapter_id=?').run(ch.id);
  db.prepare('DELETE FROM book_chapters WHERE id=?').run(ch.id);
  res.json({ ok: true });
});


app.get('/api/groups', (req, res) => {
  const groups = db.prepare(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id WHERE g.type='public' OR 1=1 ORDER BY g.created_at DESC`).all();
  res.json(groups);
});

app.get('/api/group/:slug', optionalAuth, (req, res) => {
  const group = db.prepare(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id WHERE g.slug=?`).get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  let isMember = false, role = null;
  if (req.user) {
    const m = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
    if (m) { isMember = true; role = m.role; }
  }
  res.json({ group, isMember, role });
});

app.post('/api/groups', authMiddleware, (req, res) => {
  const { name, description, cover_image, type, allow_chat, allow_photos, invite_only } = req.body;
  if (!name) return res.status(400).json({ error: 'ï¿½sim zorunlu' });
  const tempSlug = slugify(name, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
  try {
    const result = db.prepare('INSERT INTO groups (name, slug, description, cover_image, owner_id, type, allow_chat, allow_photos, invite_only, member_count) VALUES (?,?,?,?,?,?,?,?,?,1)').run(
      name, tempSlug, description || '', cover_image || '', req.user.id, type || 'public',
      allow_chat !== false ? 1 : 0, allow_photos !== false ? 1 : 0, invite_only ? 1 : 0
    );
    const realSlug = makeSlug(name, result.lastInsertRowid);
    db.prepare('UPDATE groups SET slug=? WHERE id=?').run(realSlug, result.lastInsertRowid);
    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?)').run(result.lastInsertRowid, req.user.id, 'owner');
    logAction(req.user.username, 'create_group', realSlug);
    res.json(db.prepare('SELECT * FROM groups WHERE id=?').get(result.lastInsertRowid));
  } catch (e) {
    console.error('Grup oluï¿½turma hatasï¿½:', e);
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/group/:slug', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  if (group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { name, description, cover_image, type, allow_chat, allow_photos, invite_only } = req.body;
  db.prepare('UPDATE groups SET name=?, description=?, cover_image=?, type=?, allow_chat=?, allow_photos=?, invite_only=? WHERE id=?').run(
    name || group.name, description ?? group.description, cover_image ?? group.cover_image,
    type || group.type, allow_chat !== undefined ? (allow_chat ? 1 : 0) : group.allow_chat,
    allow_photos !== undefined ? (allow_photos ? 1 : 0) : group.allow_photos,
    invite_only !== undefined ? (invite_only ? 1 : 0) : group.invite_only, group.id
  );
  res.json(db.prepare('SELECT * FROM groups WHERE id=?').get(group.id));
});

app.delete('/api/group/:slug', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  if (group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  db.prepare('DELETE FROM group_messages WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM group_members WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM group_invites WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM moderator_permissions WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM groups WHERE id=?').run(group.id);
  logAction(req.user.username, 'delete_group', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/group/:slug/join', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  if (group.type === 'private' || group.invite_only) return res.status(403).json({ error: 'Bu grup sadece davet ile katï¿½labilir' });
  const existing = db.prepare('SELECT id FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  if (existing) return res.status(400).json({ error: 'Zaten ï¿½yesiniz' });
  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?)').run(group.id, req.user.id, 'member');
  db.prepare('UPDATE groups SET member_count=member_count+1 WHERE id=?').run(group.id);
  res.json({ ok: true });
});

app.post('/api/group/:slug/leave', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  if (group.owner_id === req.user.id) return res.status(400).json({ error: 'Grup sahibi ayrï¿½lamaz' });
  const existing = db.prepare('SELECT id FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  if (!existing) return res.status(400).json({ error: 'ï¿½ye deï¿½ilsiniz' });
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(group.id, req.user.id);
  db.prepare('UPDATE groups SET member_count=MAX(0,member_count-1) WHERE id=?').run(group.id);
  res.json({ ok: true });
});

app.post('/api/group/:slug/invite', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  const member = db.prepare('SELECT * FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) return res.status(403).json({ error: 'Yetki yok' });
  const code = uuidv4().substring(0, 8).toUpperCase();
  db.prepare('INSERT INTO group_invites (group_id, invite_code, created_by) VALUES (?,?,?)').run(group.id, code, req.user.id);
  res.json({ invite_code: code });
});

app.post('/api/group/join-invite', authMiddleware, (req, res) => {
  const { invite_code } = req.body;
  if (!invite_code) return res.status(400).json({ error: 'Kod zorunlu' });
  const invite = db.prepare('SELECT * FROM group_invites WHERE invite_code=?').get(invite_code.toUpperCase());
  if (!invite) return res.status(404).json({ error: 'Geï¿½ersiz davet kodu' });
  const existing = db.prepare('SELECT id FROM group_members WHERE group_id=? AND user_id=?').get(invite.group_id, req.user.id);
  if (existing) return res.status(400).json({ error: 'Zaten ï¿½yesiniz' });
  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?)').run(invite.group_id, req.user.id, 'member');
  db.prepare('UPDATE groups SET member_count=member_count+1 WHERE id=?').run(invite.group_id);
  res.json({ ok: true });
});

app.get('/api/group/:slug/members', (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  const members = db.prepare(`SELECT gm.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id FROM group_members gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=? ORDER BY gm.joined_at ASC`).all(group.id);
  res.json(members);
});

app.get('/api/group/:slug/messages', optionalAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  if (group.type === 'private') {
    if (!req.user) return res.status(401).json({ error: 'Giriï¿½ gerekli' });
    const m = db.prepare('SELECT id FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
    if (!m) return res.status(403).json({ error: 'ï¿½ye deï¿½ilsiniz' });
  }
  const messages = db.prepare(`SELECT gm.*, u.username, u.avatar, u.name_color, u.is_vip FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=? ORDER BY gm.created_at ASC LIMIT 200`).all(group.id);
  res.json(messages);
});

app.post('/api/group/:slug/messages', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  if (!group.allow_chat) return res.status(403).json({ error: 'Sohbet kapalï¿½' });
  const member = db.prepare('SELECT id FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'ï¿½ye deï¿½ilsiniz' });
  const { content, image_url } = req.body;
  if (!content && !image_url) return res.status(400).json({ error: 'Mesaj boï¿½ olamaz' });
  const result = db.prepare('INSERT INTO group_messages (group_id, user_id, content, image_url) VALUES (?,?,?,?)').run(group.id, req.user.id, content || '', image_url || '');
  const msg = db.prepare(`SELECT gm.*, u.username, u.avatar, u.name_color, u.is_vip FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.id=?`).get(result.lastInsertRowid);
  res.json(msg);
});

app.delete('/api/group/:slug/messages/:id', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  const msg = db.prepare('SELECT * FROM group_messages WHERE id=? AND group_id=?').get(req.params.id, group.id);
  if (!msg) return res.status(404).json({ error: 'Mesaj bulunamadï¿½' });
  const member = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  const perm = db.prepare('SELECT * FROM moderator_permissions WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  const canDelete = msg.user_id === req.user.id || group.owner_id === req.user.id || (member?.role === 'moderator' && perm?.can_delete_messages);
  if (!canDelete) return res.status(403).json({ error: 'Yetki yok' });
  db.prepare('DELETE FROM group_messages WHERE id=?').run(msg.id);
  res.json({ ok: true });
});

app.post('/api/group/:slug/moderator/:userId', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group || group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  const member = db.prepare('SELECT * FROM group_members WHERE group_id=? AND user_id=?').get(group.id, userId);
  if (!member) return res.status(404).json({ error: 'ï¿½ye bulunamadï¿½' });
  db.prepare('UPDATE group_members SET role=? WHERE group_id=? AND user_id=?').run('moderator', group.id, userId);
  db.prepare('INSERT OR IGNORE INTO moderator_permissions (group_id, user_id) VALUES (?,?)').run(group.id, userId);
  res.json({ ok: true });
});

app.delete('/api/group/:slug/moderator/:userId', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group || group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  db.prepare('UPDATE group_members SET role=? WHERE group_id=? AND user_id=?').run('member', group.id, userId);
  db.prepare('DELETE FROM moderator_permissions WHERE group_id=? AND user_id=?').run(group.id, userId);
  res.json({ ok: true });
});

app.put('/api/group/:slug/moderator/:userId/permissions', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group || group.owner_id !== req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  const { can_delete_messages, can_ban_members, can_edit_group, can_manage_invites } = req.body;
  db.prepare('INSERT INTO moderator_permissions (group_id,user_id,can_delete_messages,can_ban_members,can_edit_group,can_manage_invites) VALUES (?,?,?,?,?,?) ON CONFLICT(group_id,user_id) DO UPDATE SET can_delete_messages=excluded.can_delete_messages, can_ban_members=excluded.can_ban_members, can_edit_group=excluded.can_edit_group, can_manage_invites=excluded.can_manage_invites').run(
    group.id, userId, can_delete_messages ? 1 : 0, can_ban_members ? 1 : 0, can_edit_group ? 1 : 0, can_manage_invites ? 1 : 0
  );
  res.json({ ok: true });
});

app.post('/api/group/:slug/ban/:userId', authMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  const member = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  const perm = db.prepare('SELECT * FROM moderator_permissions WHERE group_id=? AND user_id=?').get(group.id, req.user.id);
  const canBan = group.owner_id === req.user.id || (member?.role === 'moderator' && perm?.can_ban_members);
  if (!canBan) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(group.id, userId);
  db.prepare('UPDATE groups SET member_count=MAX(0,member_count-1) WHERE id=?').run(group.id);
  res.json({ ok: true });
});

app.post('/api/group/:slug/upload', authMiddleware, upload.single('image'), (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group || !group.allow_photos) return res.status(403).json({ error: 'Fotoï¿½raf yï¿½kleme kapalï¿½' });
  if (!req.file) return res.status(400).json({ error: 'Dosya bulunamadï¿½' });
  res.json({ url: '/uploads/' + req.file.filename });
});


app.get('/api/profile/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Kullanï¿½cï¿½ bulunamadï¿½' });
  const forums = db.prepare('SELECT * FROM forums WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(user.id);
  const books = db.prepare('SELECT * FROM books WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(user.id);
  const groups = db.prepare(`SELECT g.* FROM groups g INNER JOIN group_members gm ON g.id=gm.group_id WHERE gm.user_id=? LIMIT 20`).all(user.id);
  const level = db.prepare('SELECT * FROM levels WHERE id=?').get(user.level_id);
  const levels = db.prepare('SELECT * FROM levels ORDER BY order_num ASC').all();
  res.json({ user: sanitizeUser(user), forums, books, groups, level, levels });
});

app.put('/api/profile', authMiddleware, upload.single('avatar'), (req, res) => {
  const { bio, links, name_color, show_level_badge, show_level_color } = req.body;
  const avatar = req.file ? '/uploads/' + req.file.filename : undefined;
  const user = req.user;
  const newAvatar = avatar !== undefined ? avatar : user.avatar;
  const newLinks = links ? (typeof links === 'string' ? links : JSON.stringify(links)) : user.links;
  db.prepare('UPDATE users SET bio=?, links=?, name_color=?, show_level_badge=?, show_level_color=?, avatar=? WHERE id=?').run(
    bio ?? user.bio, newLinks, name_color ?? user.name_color,
    show_level_badge !== undefined ? (show_level_badge ? 1 : 0) : user.show_level_badge,
    show_level_color !== undefined ? (show_level_color ? 1 : 0) : user.show_level_color,
    newAvatar, user.id
  );
  res.json(sanitizeUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)));
});

app.put('/api/profile/password', authMiddleware, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) return res.status(400).json({ error: 'Eski ve yeni ï¿½ifre zorunlu' });
  if (req.user.password_hash !== hashPassword(old_password)) return res.status(401).json({ error: 'Eski ï¿½ifre yanlï¿½ï¿½' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Yeni ï¿½ifre en az 6 karakter' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(new_password), req.user.id);
  res.json({ ok: true });
});

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya bulunamadï¿½' });
  res.json({ url: '/uploads/' + req.file.filename });
});


app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(users.map(u => ({ ...sanitizeUser(u) })));
});

app.get('/api/admin/user/:id', adminMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Kullanï¿½cï¿½ bulunamadï¿½' });
  res.json(sanitizeUser(user));
});

app.put('/api/admin/user/:id', adminMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Kullanï¿½cï¿½ bulunamadï¿½' });
  const { username, email, password, is_vip, is_plus, name_color, level_id } = req.body;
  const newPwHash = password ? hashPassword(password) : user.password_hash;
  db.prepare('UPDATE users SET username=?, email=?, password_hash=?, is_vip=?, is_plus=?, name_color=?, level_id=? WHERE id=?').run(
    username || user.username, email || user.email, newPwHash,
    is_vip !== undefined ? (is_vip ? 1 : 0) : user.is_vip,
    is_plus !== undefined ? (is_plus ? 1 : 0) : user.is_plus,
    name_color ?? user.name_color, level_id || user.level_id, user.id
  );
  logAction('admin', 'edit_user', user.username);
  res.json(sanitizeUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)));
});

app.post('/api/admin/user/:id/ban', adminMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Kullanï¿½cï¿½ bulunamadï¿½' });
  const { ban_type } = req.body; // 'soft' or 'ip'
  db.prepare('UPDATE users SET banned=1, ban_type=?, banned_ip=? WHERE id=?').run(ban_type || 'soft', ban_type === 'ip' ? user.ip : '', user.id);
  logAction('admin', 'ban_user', user.username, ban_type || 'soft');
  res.json({ ok: true });
});

app.post('/api/admin/user/:id/unban', adminMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Kullanï¿½cï¿½ bulunamadï¿½' });
  db.prepare('UPDATE users SET banned=0, ban_type="", banned_ip="" WHERE id=?').run(user.id);
  logAction('admin', 'unban_user', user.username);
  res.json({ ok: true });
});

app.delete('/api/admin/user/:id', adminMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Kullanï¿½cï¿½ bulunamadï¿½' });
  db.prepare('DELETE FROM users WHERE id=?').run(user.id);
  logAction('admin', 'delete_user', user.username);
  res.json({ ok: true });
});

app.get('/api/admin/forums', adminMiddleware, (req, res) => {
  const forums = db.prepare(`SELECT f.*, u.username FROM forums f LEFT JOIN users u ON f.user_id=u.id ORDER BY f.created_at DESC`).all();
  res.json(forums);
});

app.put('/api/admin/forum/:id', adminMiddleware, (req, res) => {
  const forum = db.prepare('SELECT * FROM forums WHERE id=?').get(req.params.id);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  const { title, content, allow_comments } = req.body;
  db.prepare('UPDATE forums SET title=?, content=?, allow_comments=? WHERE id=?').run(title || forum.title, content || forum.content, allow_comments !== undefined ? (allow_comments ? 1 : 0) : forum.allow_comments, forum.id);
  res.json(db.prepare('SELECT * FROM forums WHERE id=?').get(forum.id));
});

app.delete('/api/admin/forum/:id', adminMiddleware, (req, res) => {
  const forum = db.prepare('SELECT * FROM forums WHERE id=?').get(req.params.id);
  if (!forum) return res.status(404).json({ error: 'Konu bulunamadi' });
  db.prepare('DELETE FROM forum_comments WHERE forum_id=?').run(forum.id);
  db.prepare('DELETE FROM forum_likes WHERE forum_id=?').run(forum.id);
  db.prepare('DELETE FROM forum_views WHERE forum_id=?').run(forum.id);
  db.prepare('DELETE FROM forums WHERE id=?').run(forum.id);
  if (forum.user_id) db.prepare('UPDATE users SET forum_count=MAX(0,forum_count-1) WHERE id=?').run(forum.user_id);
  logAction('admin', 'delete_forum', forum.slug);
  res.json({ ok: true });
});

app.get('/api/admin/books', adminMiddleware, (req, res) => {
  const books = db.prepare(`SELECT b.*, u.username FROM books b LEFT JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC`).all();
  res.json(books);
});

app.delete('/api/admin/book/:id', adminMiddleware, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadï¿½' });
  db.prepare('DELETE FROM book_pages WHERE book_id=?').run(book.id);
  db.prepare('DELETE FROM book_chapters WHERE book_id=?').run(book.id);
  db.prepare('DELETE FROM books WHERE id=?').run(book.id);
  if (book.user_id) db.prepare('UPDATE users SET book_count=MAX(0,book_count-1) WHERE id=?').run(book.user_id);
  logAction('admin', 'delete_book', book.slug);
  res.json({ ok: true });
});

app.get('/api/admin/groups', adminMiddleware, (req, res) => {
  const groups = db.prepare(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id ORDER BY g.created_at DESC`).all();
  res.json(groups);
});

app.delete('/api/admin/group/:id', adminMiddleware, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id=?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grup bulunamadï¿½' });
  db.prepare('DELETE FROM group_messages WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM group_members WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM group_invites WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM moderator_permissions WHERE group_id=?').run(group.id);
  db.prepare('DELETE FROM groups WHERE id=?').run(group.id);
  logAction('admin', 'delete_group', group.slug);
  res.json({ ok: true });
});

app.get('/api/admin/levels', adminMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM levels ORDER BY order_num ASC').all());
});

app.post('/api/admin/levels', adminMiddleware, (req, res) => {
  const { name, icon, color, min_forums, min_books, min_comments, order_num } = req.body;
  if (!name) return res.status(400).json({ error: 'ï¿½sim zorunlu' });
  const result = db.prepare('INSERT INTO levels (name,icon,color,min_forums,min_books,min_comments,order_num) VALUES (?,?,?,?,?,?,?)').run(name, icon || 'fas fa-star', color || '#dc2626', min_forums || 0, min_books || 0, min_comments || 0, order_num || 0);
  res.json(db.prepare('SELECT * FROM levels WHERE id=?').get(result.lastInsertRowid));
});

app.put('/api/admin/level/:id', adminMiddleware, (req, res) => {
  const lv = db.prepare('SELECT * FROM levels WHERE id=?').get(req.params.id);
  if (!lv) return res.status(404).json({ error: 'Seviye bulunamadï¿½' });
  const { name, icon, color, min_forums, min_books, min_comments, order_num } = req.body;
  db.prepare('UPDATE levels SET name=?,icon=?,color=?,min_forums=?,min_books=?,min_comments=?,order_num=? WHERE id=?').run(
    name || lv.name, icon || lv.icon, color || lv.color, min_forums ?? lv.min_forums, min_books ?? lv.min_books, min_comments ?? lv.min_comments, order_num ?? lv.order_num, lv.id
  );
  res.json(db.prepare('SELECT * FROM levels WHERE id=?').get(lv.id));
});

app.delete('/api/admin/level/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM levels WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/logs', adminMiddleware, (req, res) => {
  const logs = db.prepare('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 500').all();
  res.json(logs);
});

app.get('/api/admin/settings', adminMiddleware, (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(settings.map(s => [s.key, s.value])));
});

app.post('/api/admin/settings', adminMiddleware, (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key zorunlu' });
  let val = value;
  if (key === 'admin_password') val = hashPassword(value);
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, val);
  res.json({ ok: true });
});

app.get('/api/kvkk', (req, res) => {
  const setting = db.prepare('SELECT value FROM settings WHERE key=?').get('kvkk_text');
  res.json({ text: setting ? setting.value : '' });
});

app.get('/panel-giris', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

function injectMeta(title, desc, url, imageUrl) {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const img = imageUrl || `${SITE_URL}/demlik.png`;
  const meta = `<title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(desc)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:site_name" content="Demlik" />
    <meta property="og:image" content="${escapeHtml(img)}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(desc)}" />
    <meta name="twitter:image" content="${escapeHtml(img)}" />`;
  return html.replace('<title>Demlik</title>', meta);
}

app.get('/giris', (req, res) => {
  res.send(injectMeta('Giriş – Demlik', 'Demlik hesabına giriş yap ve topluluğa katıl.', `${SITE_URL}/giris`, ''));
});
app.get('/kayit', (req, res) => {
  res.send(injectMeta('Kayıt Ol – Demlik', 'Demlik\'e ücretsiz kaydol, konular yaz ve e-kitap oluştur.', `${SITE_URL}/kayit`, ''));
});
app.get('/forum', (req, res) => {
  const tag = req.query.tag || '';
  const title = tag ? `${tag} Konuları – Demlik` : 'Konular – Demlik';
  const desc = tag ? `Demlik\'te ${tag} etiketli konuları keşfet.` : 'Demlik topluluğunun konularını keşfet, tartışmalara katıl.';
  res.send(injectMeta(title, desc, `${SITE_URL}/forum${tag ? '?tag=' + encodeURIComponent(tag) : ''}`, ''));
});
app.get('/kitaplar', (req, res) => {
  res.send(injectMeta('E-Kitaplar – Demlik', 'Demlik yazarlarının e-kitaplarını oku veya kendi kitabını oluştur.', `${SITE_URL}/kitaplar`, ''));
});
app.get('/gruplar', (req, res) => {
  res.send(injectMeta('Gruplar – Demlik', 'Demlik\'teki gruplara katıl ya da kendi grubunu kur.', `${SITE_URL}/gruplar`, ''));
});
app.get('/ayarlar', (req, res) => {
  res.send(injectMeta('Ayarlar – Demlik', 'Profil, şifre ve hesap ayarlarını düzenle.', `${SITE_URL}/ayarlar`, ''));
});

app.get('/forum/:slug', (req, res) => {
  const forum = db.prepare('SELECT * FROM forums WHERE slug=?').get(req.params.slug);
  if (!forum) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((forum.content || '').substring(0, 160).replace(/\n/g, ' '));
  const imgTag = forum.banner_image
    ? `<meta property="og:image" content="${escapeHtml(forum.banner_image)}" />
    <meta property="og:image:width" content="1200" />
    <meta name="twitter:image" content="${escapeHtml(forum.banner_image)}" />
    <meta name="twitter:card" content="summary_large_image" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(forum.title)} â€“ Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:title" content="${escapeHtml(forum.title)} â€“ Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      'headline': forum.title,
      'text': (forum.content || '').substring(0, 500),
      'url': `${SITE_URL}/forum/${forum.slug}`,
      'datePublished': forum.created_at,
      'dateModified': forum.updated_at || forum.created_at,
      'author': { '@type': 'Person', 'name': forum.username || 'Anonim' },
      'publisher': { '@type': 'Organization', 'name': 'Demlik', 'url': SITE_URL },
      ...(forum.banner_image ? { 'image': { '@type': 'ImageObject', 'url': forum.banner_image, 'name': forum.title } } : {})
    })}</script>`;
  res.send(html.replace('<title>Demlik</title>', meta));
});

app.get('/kitap/:slug', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE slug=?').get(req.params.slug);
  if (!book) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((book.preface || book.title + ' â€“ Demlik\'te yayÄ±mlanan kitap.').substring(0, 160));
  const imgTag = book.cover_image
    ? `<meta property="og:image" content="${escapeHtml(book.cover_image)}" />
    <meta name="twitter:image" content="${escapeHtml(book.cover_image)}" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(book.title)} â€“ Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/kitap/${escapeHtml(book.slug)}" />
    <meta property="og:title" content="${escapeHtml(book.title)} â€“ Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="book" />
    <meta property="og:url" content="${SITE_URL}/kitap/${escapeHtml(book.slug)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Book',
      'name': book.title,
      'description': (book.preface || '').substring(0, 300),
      'url': `${SITE_URL}/kitap/${book.slug}`,
      'author': { '@type': 'Person', 'name': book.username || 'Anonim' },
      'publisher': { '@type': 'Organization', 'name': 'Demlik', 'url': SITE_URL },
      'numberOfPages': book.page_count || 0,
      ...(book.cover_image ? { 'image': book.cover_image } : {})
    })}</script>`;
  res.send(html.replace('<title>Demlik</title>', meta));
});

app.get('/grup/:slug', (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE slug=?').get(req.params.slug);
  if (!group) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((group.description || group.name + ' â€“ Demlik topluluÄŸu grubu.').substring(0, 160));
  const imgTag = group.cover_image
    ? `<meta property="og:image" content="${escapeHtml(group.cover_image)}" />
    <meta name="twitter:image" content="${escapeHtml(group.cover_image)}" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(group.name)} â€“ Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/grup/${escapeHtml(group.slug)}" />
    <meta property="og:title" content="${escapeHtml(group.name)} â€“ Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${SITE_URL}/grup/${escapeHtml(group.slug)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}`;
  res.send(html.replace('<title>Demlik</title>', meta));
});

app.get('/profil/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username);
  if (!user) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const bioText = (user.bio || `${user.username} adlÄ± kullanÄ±cÄ±nÄ±n Demlik profili.`).substring(0, 160);
  const desc = escapeHtml(bioText);
  const imgTag = user.avatar
    ? `<meta property="og:image" content="${escapeHtml(user.avatar)}" />
    <meta name="twitter:image" content="${escapeHtml(user.avatar)}" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(user.username)} â€“ Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/profil/${escapeHtml(user.username)}" />
    <meta property="og:title" content="${escapeHtml(user.username)} â€“ Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="profile" />
    <meta property="og:url" content="${SITE_URL}/profil/${escapeHtml(user.username)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Person',
      'name': user.username,
      'url': `${SITE_URL}/profil/${user.username}`,
      ...(user.bio ? { 'description': user.bio.substring(0, 300) } : {}),
      ...(user.avatar ? { 'image': user.avatar } : {})
    })}</script>`;
  res.send(html.replace('<title>Demlik</title>', meta));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Demlik calisiyor: http://localhost:${PORT}`));


app.get('/api/admin/tags', adminMiddleware, (req, res) => {
  const tags = db.prepare('SELECT * FROM tags ORDER BY is_system DESC, name ASC').all();
  res.json(tags);
});

app.post('/api/admin/tags', adminMiddleware, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Ä°sim zorunlu' });
  try {
    const result = db.prepare('INSERT INTO tags (name, color, is_system) VALUES (?,?,1)').run(name.trim(), color || '#dc2626');
    logAction('admin', 'create_tag', name);
    res.json(db.prepare('SELECT * FROM tags WHERE id=?').get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/admin/tag/:id', adminMiddleware, (req, res) => {
  const tag = db.prepare('SELECT * FROM tags WHERE id=?').get(req.params.id);
  if (!tag) return res.status(404).json({ error: 'Tag bulunamadÄ±' });
  const { name, color } = req.body;
  db.prepare('UPDATE tags SET name=?, color=? WHERE id=?').run(name || tag.name, color || tag.color, tag.id);
  logAction('admin', 'update_tag', tag.name);
  res.json(db.prepare('SELECT * FROM tags WHERE id=?').get(tag.id));
});

app.delete('/api/admin/tag/:id', adminMiddleware, (req, res) => {
  const tag = db.prepare('SELECT * FROM tags WHERE id=?').get(req.params.id);
  if (!tag) return res.status(404).json({ error: 'Tag bulunamadÄ±' });
  db.prepare('DELETE FROM forum_tags WHERE tag_id=?').run(tag.id);
  db.prepare('DELETE FROM tags WHERE id=?').run(tag.id);
  logAction('admin', 'delete_tag', tag.name);
  res.json({ ok: true });
});

