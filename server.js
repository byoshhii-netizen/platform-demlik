const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const slugify = require('slugify');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;
const { query, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudinary config — Railway'de CLOUDINARY_URL env var olarak ekle
// Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ secure: true });
} else if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const USE_CLOUDINARY = !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);

// Fallback: local disk (Railway volume veya geliştirme)
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
if (!USE_CLOUDINARY) {
  try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
}

app.use(express.json());
if (!USE_CLOUDINARY) app.use('/uploads', express.static(UPLOAD_DIR));

// Cloudflare proxy arkasındaysa gerçek IP'yi al
app.set('trust proxy', 1);

const SITE_URL = process.env.SITE_URL || 'https://demlik.up.railway.app';

// ===== RATE LIMITERS =====

// Genel API: dakikada 120 istek
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Lütfen bekleyin.' },
});

// Auth (login/register): 15 dakikada 10 deneme
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika bekleyin.' },
});

// Upload: dakikada 10 yükleme
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla yükleme. Lütfen bekleyin.' },
});

// İçerik oluşturma (forum/kitap/mesaj): dakikada 20
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok hızlı içerik oluşturuyorsunuz. Yavaşlayın.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api/group/:slug/upload', uploadLimiter);
app.use('/api/forums', createLimiter);
app.use('/api/books', createLimiter);
app.use('/api/group/:slug/messages', createLimiter);

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken(userId) {
  return Buffer.from(JSON.stringify({ id: userId, ts: Date.now(), rand: Math.random() })).toString('base64');
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, spotify_token, spotify_refresh, ...rest } = u;
  return rest;
}

function makeSlug(title, id) {
  const base = slugify(title, { lower: true, strict: false, locale: 'tr', replacement: '-' })
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').substring(0, 60);
  return base + '-' + id;
}

async function logAction(actor, action, target = '', detail = '', ip = '') {
  await query('INSERT INTO system_logs (actor,action,target,detail,ip) VALUES ($1,$2,$3,$4,$5)',
    [actor, action, target, detail, ip]);
}

async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Giriş gerekli' });
  const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1', [token]);
  if (!rows.length) return res.status(401).json({ error: 'Giriş gerekli' });
  const { rows: users } = await query('SELECT * FROM users WHERE id=$1', [rows[0].user_id]);
  if (!users.length) return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
  if (users[0].banned) return res.status(403).json({ error: 'Hesabınız yasaklandı' });
  req.user = users[0];
  next();
}

async function optionalAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) {
    const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1', [token]);
    if (rows.length) {
      const { rows: users } = await query('SELECT * FROM users WHERE id=$1', [rows[0].user_id]);
      if (users.length && !users[0].banned) req.user = users[0];
    }
  }
  next();
}

async function adminMiddleware(req, res, next) {
  // IP kontrolü — ADMIN_IPS set edilmişse API'yi de koru
  const allowed = getAdminIPs();
  if (allowed.length > 0) {
    const clientIP = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
    if (!allowed.includes(clientIP)) return res.status(404).json({ error: 'Not found' });
  }
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Admin token gerekli' });
  const { rows } = await query("SELECT value FROM settings WHERE key='admin_password'");
  if (!rows.length || token !== rows[0].value) return res.status(403).json({ error: 'Geçersiz admin token' });
  next();
}

async function updateUserLevel(userId) {
  const { rows: users } = await query('SELECT forum_count, book_count, comment_count FROM users WHERE id=$1', [userId]);
  if (!users.length) return;
  const user = users[0];
  const { rows: bpRows } = await query(
    'SELECT COUNT(*) as c FROM book_pages bp INNER JOIN books b ON bp.book_id=b.id WHERE b.user_id=$1', [userId]);
  const bookPageCount = parseInt(bpRows[0].c);
  const { rows: levels } = await query('SELECT * FROM levels ORDER BY order_num ASC');
  let bestLevel = levels[0];
  for (const lv of levels) {
    const minF  = lv.min_forums     >= 9999999 ? Infinity : (parseInt(lv.min_forums)     || 0);
    const minB  = lv.min_books      >= 9999999 ? Infinity : (parseInt(lv.min_books)      || 0);
    const minC  = lv.min_comments   >= 9999999 ? Infinity : (parseInt(lv.min_comments)   || 0);
    const minBP = (parseInt(lv.min_book_pages) || 0) >= 9999999 ? Infinity : (parseInt(lv.min_book_pages) || 0);

    // Yeni mantık:
    // - Konu tek başına yeterli (min_forums karşılandıysa ✓)
    // - Yorum tek başına yeterli (min_comments karşılandıysa ✓)
    // - Kitap + sayfa ikisi birlikte (min_books VE min_book_pages birlikte karşılanmalı)
    const meetsForums   = user.forum_count   >= minF;
    const meetsComments = user.comment_count >= minC;
    const meetsBook     = user.book_count    >= minB && bookPageCount >= minBP;

    // Herhangi biri yeterliyse seviyeyi karşılamış sayılır
    const meets = meetsForums || meetsComments || meetsBook;
    if (meets) bestLevel = lv;
  }
  await query('UPDATE users SET level_id=$1 WHERE id=$2', [bestLevel.id, userId]);
}

function getDailyLimit(user, lv, type) {
  if (!lv) return -1;
  const suffix = user.is_vip == 1 ? '_vip' : (user.is_plus == 1 ? '_plus' : '');
  const col = `daily_${type}${suffix}`;
  const val = lv[col];
  if (val === undefined || val === null) return parseInt(lv[`daily_${type}`] ?? -1);
  return parseInt(val);
}

async function checkDailyLimit(userId, user, type) {
  const { rows: lvRows } = await query('SELECT * FROM levels WHERE id=$1', [user.level_id]);
  const lv = lvRows[0];
  const limit = getDailyLimit(user, lv, type);
  if (limit === -1 || limit >= 9999999) return null;
  const today = new Date().toISOString().slice(0, 10);
  let countRes;
  if (type === 'forums') {
    countRes = await query("SELECT COUNT(*) as c FROM forums WHERE user_id=$1 AND DATE(created_at)=$2", [userId, today]);
  } else if (type === 'books') {
    countRes = await query("SELECT COUNT(*) as c FROM books WHERE user_id=$1 AND DATE(created_at)=$2", [userId, today]);
  } else if (type === 'book_pages') {
    countRes = await query(
      "SELECT COUNT(*) as c FROM book_pages bp INNER JOIN books b ON bp.book_id=b.id WHERE b.user_id=$1 AND DATE(bp.created_at)=$2",
      [userId, today]);
  }
  const count = parseInt(countRes?.rows[0]?.c || 0);
  if (count >= limit) return `Bugün en fazla ${limit} ${type === 'forums' ? 'konu' : type === 'books' ? 'kitap' : 'kitap sayfası'} oluşturabilirsiniz.`;
  return null;
}

// ===== MULTER / UPLOAD =====
// Memory storage — Cloudinary varsa RAM'den upload, yoksa disk'e yaz
const storage = USE_CLOUDINARY
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, uuidv4() + ext);
      }
    });
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (audio için)
  fileFilter: (req, file, cb) => {
    const allowedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
    const allowedAudio = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/x-wav', 'audio/wave'];
    if (allowedImages.includes(file.mimetype) || allowedAudio.includes(file.mimetype) || file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Sadece resim veya ses dosyaları kabul edilir'));
  }
});

// Yükleme helper'ı — Cloudinary ya da disk
async function handleUpload(file) {
  if (USE_CLOUDINARY) {
    return new Promise((resolve, reject) => {
      if (!file.buffer || file.buffer.length === 0) {
        return reject(new Error('Dosya buffer boş'));
      }
      const ext = path.extname(file.originalname).replace('.', '') || 'jpg';
      const public_id = 'demlik/' + uuidv4();
      const isAudio = file.mimetype && file.mimetype.startsWith('audio/');
      const stream = cloudinary.uploader.upload_stream(
        isAudio
          ? { public_id, resource_type: 'video' } // Cloudinary audio için 'video' resource type kullanır
          : { public_id, resource_type: 'image', quality: 'auto', fetch_format: 'auto' },
        (err, result) => {
          if (err) return reject(new Error('Cloudinary yükleme hatası: ' + (err.message || JSON.stringify(err))));
          if (!result?.secure_url) return reject(new Error('Cloudinary URL alınamadı'));
          resolve(result.secure_url);
        }
      );
      stream.end(file.buffer);
    });
  } else {
    return '/uploads/' + file.filename;
  }
}

// ===== ROBOTS & SITEMAP =====
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /panel-giris\nDisallow: /ayarlar\nSitemap: ${SITE_URL}/sitemap.xml`);
});

app.get('/sitemap.xml', async (req, res) => {
  const [forums, books, groups, users, songs] = await Promise.all([
    query('SELECT slug, title, banner_image, updated_at FROM forums ORDER BY updated_at DESC LIMIT 5000').then(r => r.rows),
    query('SELECT slug, updated_at FROM books ORDER BY updated_at DESC LIMIT 2000').then(r => r.rows),
    query('SELECT slug FROM groups LIMIT 2000').then(r => r.rows),
    query('SELECT username FROM users WHERE banned=0 LIMIT 5000').then(r => r.rows),
    query("SELECT slug, title, cover_url, published_at FROM songs WHERE status='active' ORDER BY published_at DESC LIMIT 2000").then(r => r.rows),
  ]);
  const now = new Date().toISOString();
  const staticUrls = [
    { url: '/',          priority: '1.0', changefreq: 'daily'  },
    { url: '/forum',     priority: '0.9', changefreq: 'hourly' },
    { url: '/kitaplar',  priority: '0.8', changefreq: 'daily'  },
    { url: '/gruplar',   priority: '0.7', changefreq: 'daily'  },
    { url: '/muzikler',  priority: '0.7', changefreq: 'daily'  },
  ].map(u => `  <url><loc>${SITE_URL}${u.url}</loc><lastmod>${now}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n');

  const forumUrls = forums.map(f => {
    const imgTag = f.banner_image
      ? `\n    <image:image><image:loc>${escapeHtml(f.banner_image)}</image:loc><image:title>${escapeHtml(f.title)}</image:title></image:image>`
      : '';
    const mod = f.updated_at ? `\n    <lastmod>${new Date(f.updated_at).toISOString()}</lastmod>` : '';
    return `  <url><loc>${SITE_URL}/forum/${escapeHtml(f.slug)}</loc>${mod}\n    <changefreq>weekly</changefreq><priority>0.8</priority>${imgTag}\n  </url>`;
  }).join('\n');

  const bookUrls = books.map(b => {
    const mod = b.updated_at ? `\n    <lastmod>${new Date(b.updated_at).toISOString()}</lastmod>` : '';
    return `  <url><loc>${SITE_URL}/kitap/${escapeHtml(b.slug)}</loc>${mod}\n    <changefreq>weekly</changefreq><priority>0.7</priority>\n  </url>`;
  }).join('\n');

  const groupUrls = groups.map(g =>
    `  <url><loc>${SITE_URL}/grup/${escapeHtml(g.slug)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`
  ).join('\n');

  const profileUrls = users.map(u =>
    `  <url><loc>${SITE_URL}/profil/${escapeHtml(u.username)}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`
  ).join('\n');

  const songUrls = songs.map(s => {
    const mod = s.published_at ? `\n    <lastmod>${new Date(s.published_at).toISOString()}</lastmod>` : '';
    const imgTag = s.cover_url
      ? `\n    <image:image><image:loc>${escapeHtml(s.cover_url)}</image:loc><image:title>${escapeHtml(s.title)}</image:title></image:image>`
      : '';
    return `  <url><loc>${SITE_URL}/muzik/${escapeHtml(s.slug)}</loc>${mod}\n    <changefreq>monthly</changefreq><priority>0.6</priority>${imgTag}\n  </url>`;
  }).join('\n');

  res.type('application/xml');
  res.set('Cache-Control', 'public, max-age=3600'); // 1 saat cache — sık değişmiyor
  res.send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    staticUrls,
    forumUrls,
    bookUrls,
    groupUrls,
    profileUrls,
    songUrls,
    '</urlset>'
  ].join('\n'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ===== AUTH =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, kvkk_accepted } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
    if (!kvkk_accepted) return res.status(400).json({ error: 'KVKK onayı zorunlu' });
    if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Kullanıcı adı 3-30 karakter olmalı' });
    if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
    const ip = getIp(req);
    const { rows: ipBan } = await query("SELECT id FROM users WHERE banned_ip=$1 AND ban_type='ip'", [ip]);
    if (ipBan.length) return res.status(403).json({ error: 'Bu IP adresi yasaklanmış' });
    const { rows: existing } = await query('SELECT id FROM users WHERE username=$1 OR email=$2', [username, email]);
    if (existing.length) return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta zaten kullanılıyor' });
    const { rows } = await query(
      'INSERT INTO users (username,email,password_hash,kvkk_accepted,ip) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [username, email, hashPassword(password), 1, ip]);
    const user = rows[0];
    const token = generateToken(user.id);
    await query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [token, user.id]);
    await logAction(username, 'register', '', '', ip);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) { res.status(400).json({ error: 'Kayıt başarısız: ' + e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Bilgiler eksik' });
    const ip = getIp(req);
    // Süresi dolmuş hesapları temizle
    await purgeDeletedAccounts();
    const { rows: ipBan } = await query("SELECT id FROM users WHERE banned_ip=$1 AND ban_type='ip'", [ip]);
    if (ipBan.length) return res.status(403).json({ error: 'Bu IP adresi yasaklanmış' });
    const { rows } = await query('SELECT * FROM users WHERE username=$1', [login]);
    const user = rows[0];
    if (!user || user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Hatalı bilgiler' });
    if (user.banned) return res.status(403).json({ error: 'Hesabınız yasaklandı' });
    // Silinme talebi verilmiş hesap — kullanıcıya bildir
    if (user.is_deleted) {
      const deleteAt = new Date(user.delete_requested_at);
      deleteAt.setDate(deleteAt.getDate() + 10);
      return res.status(200).json({
        pending_delete: true,
        delete_at: deleteAt.toISOString(),
        user_id: user.id,
        // geçici token (sadece cancel-delete için)
        temp_token: (() => { const t = generateToken(user.id); query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [t, user.id]); return t; })()
      });
    }
    await query('UPDATE users SET last_active=NOW(), ip=$1 WHERE id=$2', [ip, user.id]);
    const token = generateToken(user.id);
    await query('INSERT INTO sessions (token,user_id) VALUES ($1,$2)', [token, user.id]);
    await logAction(user.username, 'login', '', '', ip);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const { rows: lvRows } = await query('SELECT * FROM levels WHERE id=$1', [req.user.level_id]);
  res.json({ user: sanitizeUser(req.user), level: lvRows[0] || null });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  await query('DELETE FROM sessions WHERE token=$1', [token]);
  res.json({ ok: true });
});

// ===== HESAP SİLME =====

// Silme talebi oluştur (şifre doğrulama zorunlu)
app.post('/api/auth/request-delete', authMiddleware, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Şifre gerekli' });
  if (req.user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Şifre hatalı' });
  // İçerikleri hemen gizle (is_deleted=1), kalıcı silme 10 gün sonra
  await query('UPDATE users SET is_deleted=1, delete_requested_at=NOW() WHERE id=$1', [req.user.id]);
  // Tüm sessionları sil
  await query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);
  await logAction(req.user.username, 'request_account_delete', '');
  res.json({ ok: true });
});

// Silme talebini geri al (giriş yaparken)
app.post('/api/auth/cancel-delete', authMiddleware, async (req, res) => {
  await query('UPDATE users SET is_deleted=0, delete_requested_at=NULL WHERE id=$1', [req.user.id]);
  await logAction(req.user.username, 'cancel_account_delete', '');
  res.json({ ok: true });
});

// 10 gün geçmiş hesapları kalıcı sil (cron-benzeri, her login isteğinde tetiklenir)
async function purgeDeletedAccounts() {
  try {
    const { rows } = await query(
      `SELECT id, username FROM users WHERE is_deleted=1 AND delete_requested_at < NOW() - INTERVAL '10 days'`
    );
    for (const user of rows) {
      await query('DELETE FROM users WHERE id=$1', [user.id]);
      await logAction('system', 'purge_deleted_account', user.username);
    }
  } catch(e) { console.error('purge error:', e.message); }
}


// ===== BİLDİRİM YARDIMCISI =====
async function parseMentionsAndNotify(content, actorUser, type, link, contextTitle = '') {
  const mentions = [...new Set(
    (content.match(/@([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+)/g) || []).map(m => m.slice(1).toLowerCase())
  )];
  for (const username of mentions) {
    if (username.toLowerCase() === actorUser.username.toLowerCase()) continue;
    const { rows } = await query('SELECT id, allow_mentions FROM users WHERE LOWER(username)=$1 AND is_deleted=0', [username]);
    if (!rows.length || !rows[0].allow_mentions) continue;
    const body = type === 'forum_mention'
      ? `@${actorUser.username} sizi bir konuda etiketledi: "${contextTitle}"`
      : `@${actorUser.username} bir mesajında sizi etiketledi`;
    await query(
      'INSERT INTO notifications (user_id, type, actor_username, actor_avatar, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [rows[0].id, type, actorUser.username, actorUser.avatar || '', contextTitle, body, link]
    );
  }
}

// ===== BİLDİRİM ENDPOİNTLERİ =====
app.get('/api/notifications', authMiddleware, async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json(rows);
});

app.get('/api/notifications/unread-count', authMiddleware, async (req, res) => {
  const { rows } = await query(
    'SELECT COUNT(*) as c FROM notifications WHERE user_id=$1 AND is_read=0',
    [req.user.id]
  );
  res.json({ count: parseInt(rows[0].c) });
});

app.post('/api/notifications/read-all', authMiddleware, async (req, res) => {
  await query('UPDATE notifications SET is_read=1 WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
});

app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
  await query('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ===== FORUMS =====
app.get('/api/forums', async (req, res) => {
  const { tag } = req.query;
  let baseQuery = `
    SELECT f.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus, u.is_admin,
      u.title as user_title, u.location as user_location,
      (SELECT COUNT(*) FROM forum_likes WHERE forum_id=f.id) as like_count,
      (SELECT COUNT(*) FROM forum_comments WHERE forum_id=f.id) as comment_count,
      COALESCE((
        SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
        FROM tags t INNER JOIN forum_tags ft ON ft.tag_id=t.id WHERE ft.forum_id=f.id
      ), '[]'::json) as system_tags
    FROM forums f LEFT JOIN users u ON f.user_id=u.id`;

  if (tag) {
    // Sistem etiketi veya custom tag ile filtrele
    baseQuery += ` WHERE (
      EXISTS (SELECT 1 FROM forum_tags ft INNER JOIN tags t ON t.id=ft.tag_id WHERE ft.forum_id=f.id AND LOWER(t.name)=LOWER($1))
      OR LOWER(f.custom_tags) LIKE LOWER($2)
    )`;
    const { rows } = await query(baseQuery + ' ORDER BY f.created_at DESC', [tag, `%${tag}%`]);
    return res.json(rows);
  }

  const { rows } = await query(baseQuery + ' ORDER BY f.created_at DESC');
  res.json(rows);
});

app.get('/api/forum/:slug', optionalAuth, async (req, res) => {
  const { rows } = await query(`
    SELECT f.*, u.username, u.avatar, u.name_color, u.is_vip, u.is_plus, u.level_id, u.is_admin,
      u.title as user_title, u.location as user_location,
      (SELECT COUNT(*) FROM forum_likes WHERE forum_id=f.id) as like_count,
      (SELECT COUNT(*) FROM forum_comments WHERE forum_id=f.id) as comment_count,
      COALESCE((
        SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
        FROM tags t INNER JOIN forum_tags ft ON ft.tag_id=t.id WHERE ft.forum_id=f.id
      ), '[]'::json) as system_tags
    FROM forums f LEFT JOIN users u ON f.user_id=u.id WHERE f.slug=$1`, [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  res.json(rows[0]);
});

app.post('/api/forum/:slug/view', async (req, res) => {
  const ip = getIp(req);
  const { rows: fRows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const fid = fRows[0].id;
  const { rows: vRows } = await query('SELECT * FROM forum_views WHERE forum_id=$1 AND ip=$2', [fid, ip]);
  if (!vRows.length) {
    await query('INSERT INTO forum_views (forum_id,ip,view_count) VALUES ($1,$2,1)', [fid, ip]);
    await query('UPDATE forums SET views=views+1 WHERE id=$1', [fid]);
  } else if (vRows[0].view_count < 3) {
    await query('UPDATE forum_views SET view_count=view_count+1 WHERE id=$1', [vRows[0].id]);
    await query('UPDATE forums SET views=views+1 WHERE id=$1', [fid]);
  }
  res.json({ ok: true });
});

app.post('/api/forums', authMiddleware, async (req, res) => {
  try {
    const { title, content, banner_image, allow_comments, tagIds, customTags } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Başlık ve içerik zorunlu' });
    const limitErr = await checkDailyLimit(req.user.id, req.user, 'forums');
    if (limitErr) return res.status(429).json({ error: limitErr });
    const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
    const customTagsStr = Array.isArray(customTags) ? customTags.join(',') : (customTags || '');
    const { rows } = await query(
      'INSERT INTO forums (user_id,title,content,banner_image,slug,allow_comments,custom_tags) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [req.user.id, title, content, banner_image || '', tempSlug, allow_comments !== false ? 1 : 0, customTagsStr]);
    const id = rows[0].id;
    const realSlug = makeSlug(title, id);
    await query('UPDATE forums SET slug=$1 WHERE id=$2', [realSlug, id]);
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      for (const tid of tagIds) {
        try { await query('INSERT INTO forum_tags (forum_id,tag_id) VALUES ($1,$2)', [id, tid]); } catch {}
      }
    }
    await query('UPDATE users SET forum_count=forum_count+1 WHERE id=$1', [req.user.id]);
    await updateUserLevel(req.user.id);
    await logAction(req.user.username, 'create_forum', realSlug);
    // @mention bildirimleri
    await parseMentionsAndNotify(content + ' ' + title, req.user, 'forum_mention', '/forum/' + realSlug, title).catch(() => {});
    const { rows: fRows } = await query('SELECT * FROM forums WHERE id=$1', [id]);
    res.json(fRows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/forum/:slug', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = fRows[0];
  if (forum.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, content, banner_image, allow_comments, tagIds, customTags } = req.body;
  const customTagsStr = Array.isArray(customTags) ? customTags.join(',') : (customTags !== undefined ? customTags : forum.custom_tags);
  await query('UPDATE forums SET title=$1,content=$2,banner_image=$3,allow_comments=$4,custom_tags=$5,updated_at=NOW() WHERE id=$6',
    [title||forum.title, content||forum.content, banner_image??forum.banner_image,
     allow_comments!==undefined?(allow_comments?1:0):forum.allow_comments, customTagsStr, forum.id]);
  if (tagIds !== undefined) {
    await query('DELETE FROM forum_tags WHERE forum_id=$1', [forum.id]);
    if (Array.isArray(tagIds)) for (const tid of tagIds) { try { await query('INSERT INTO forum_tags (forum_id,tag_id) VALUES ($1,$2)',[forum.id,tid]); } catch {} }
  }
  const { rows } = await query('SELECT * FROM forums WHERE id=$1', [forum.id]);
  res.json(rows[0]);
});

app.delete('/api/forum/:slug', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = fRows[0];
  if (forum.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM forum_comments WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_likes WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_views WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_tags WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forums WHERE id=$1', [forum.id]);
  await query('UPDATE users SET forum_count=GREATEST(0,forum_count-1) WHERE id=$1', [req.user.id]);
  await updateUserLevel(req.user.id);
  await logAction(req.user.username, 'delete_forum', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/forum/:slug/like', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const fid = rows[0].id;
  const { rows: ex } = await query('SELECT id FROM forum_likes WHERE forum_id=$1 AND user_id=$2', [fid, req.user.id]);
  if (ex.length) { await query('DELETE FROM forum_likes WHERE id=$1', [ex[0].id]); res.json({ liked: false }); }
  else { await query('INSERT INTO forum_likes (forum_id,user_id) VALUES ($1,$2)', [fid, req.user.id]); res.json({ liked: true }); }
});

app.get('/api/forum/:slug/liked', optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ liked: false });
  const { rows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.json({ liked: false });
  const { rows: lk } = await query('SELECT id FROM forum_likes WHERE forum_id=$1 AND user_id=$2', [rows[0].id, req.user.id]);
  res.json({ liked: !!lk.length });
});

app.get('/api/forum/:slug/comments', async (req, res) => {
  const { rows: fRows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const { rows } = await query(`
    SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id,
      (SELECT COUNT(*) FROM forum_comment_likes WHERE comment_id=fc.id) as like_count
    FROM forum_comments fc LEFT JOIN users u ON fc.user_id=u.id
    WHERE fc.forum_id=$1 ORDER BY fc.created_at ASC`, [fRows[0].id]);
  res.json(rows);
});

app.post('/api/forum/:slug/comments', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = fRows[0];
  if (!forum.allow_comments) return res.status(403).json({ error: 'Yorumlar kapalı' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Yorum boş olamaz' });
  const { rows } = await query('INSERT INTO forum_comments (forum_id,user_id,content) VALUES ($1,$2,$3) RETURNING id', [forum.id, req.user.id, content.trim()]);
  await query('UPDATE users SET comment_count=comment_count+1 WHERE id=$1', [req.user.id]);
  await updateUserLevel(req.user.id);
  // @mention bildirimleri
  await parseMentionsAndNotify(content, req.user, 'comment_mention', '/forum/' + req.params.slug, forum.title).catch(() => {});
  const { rows: cRows } = await query(`SELECT fc.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id FROM forum_comments fc LEFT JOIN users u ON fc.user_id=u.id WHERE fc.id=$1`, [rows[0].id]);
  res.json(cRows[0]);
});

app.delete('/api/forum/:slug/comments/:id', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM forum_comments WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  if (rows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM forum_comments WHERE id=$1', [rows[0].id]);
  await query('UPDATE users SET comment_count=GREATEST(0,comment_count-1) WHERE id=$1', [req.user.id]);
  await updateUserLevel(req.user.id);
  res.json({ ok: true });
});

app.post('/api/forum/:slug/comments/:id/like', authMiddleware, async (req, res) => {
  const { rows: fRows } = await query('SELECT id FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const { rows: cRows } = await query('SELECT id FROM forum_comments WHERE id=$1 AND forum_id=$2', [req.params.id, fRows[0].id]);
  if (!cRows.length) return res.status(404).json({ error: 'Yorum bulunamadı' });
  const { rows: ex } = await query('SELECT id FROM forum_comment_likes WHERE comment_id=$1 AND user_id=$2', [cRows[0].id, req.user.id]);
  if (ex.length) { await query('DELETE FROM forum_comment_likes WHERE id=$1', [ex[0].id]); res.json({ liked: false }); }
  else { await query('INSERT INTO forum_comment_likes (comment_id,user_id) VALUES ($1,$2)', [cRows[0].id, req.user.id]); res.json({ liked: true }); }
});

app.get('/api/forum/:slug/comments/:id/liked', optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ liked: false });
  const { rows } = await query('SELECT id FROM forum_comment_likes WHERE comment_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ liked: !!rows.length });
});

// ===== TAGS =====
app.get('/api/tags', async (req, res) => {
  const { rows } = await query('SELECT * FROM tags WHERE is_system=1 ORDER BY name ASC');
  res.json(rows);
});

app.get('/api/forum/:slug/tags', async (req, res) => {
  const { rows: fRows } = await query('SELECT id,custom_tags FROM forums WHERE slug=$1', [req.params.slug]);
  if (!fRows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const { rows: sTags } = await query(`SELECT t.* FROM tags t INNER JOIN forum_tags ft ON ft.tag_id=t.id WHERE ft.forum_id=$1`, [fRows[0].id]);
  const customTags = fRows[0].custom_tags ? fRows[0].custom_tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  res.json({ systemTags: sTags, customTags });
});

// ===== BOOKS =====
app.get('/api/books', async (req, res) => {
  const { rows } = await query(`SELECT b.*, u.username, u.avatar, u.name_color FROM books b LEFT JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC`);
  res.json(rows);
});

app.get('/api/book/:slug', async (req, res) => {
  const { rows: bRows } = await query(`SELECT b.*, u.username, u.avatar, u.name_color FROM books b LEFT JOIN users u ON b.user_id=u.id WHERE b.slug=$1`, [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  const { rows: chapters } = await query('SELECT * FROM book_chapters WHERE book_id=$1 ORDER BY order_num ASC', [book.id]);
  const { rows: pages } = await query('SELECT id,title,page_num,slug,chapter_id FROM book_pages WHERE book_id=$1 ORDER BY page_num ASC', [book.id]);
  res.json({ book, chapters, pages });
});

app.post('/api/books', authMiddleware, async (req, res) => {
  try {
    const { title, preface, cover_image } = req.body;
    if (!title) return res.status(400).json({ error: 'Başlık zorunlu' });
    const limitErr = await checkDailyLimit(req.user.id, req.user, 'books');
    if (limitErr) return res.status(429).json({ error: limitErr });
    const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
    const { rows } = await query('INSERT INTO books (user_id,title,preface,cover_image,slug) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.user.id, title, preface||'', cover_image||'', tempSlug]);
    const id = rows[0].id;
    const realSlug = makeSlug(title, id);
    await query('UPDATE books SET slug=$1 WHERE id=$2', [realSlug, id]);
    await query('UPDATE users SET book_count=book_count+1 WHERE id=$1', [req.user.id]);
    await updateUserLevel(req.user.id);
    await logAction(req.user.username, 'create_book', realSlug);
    const { rows: bRows } = await query('SELECT * FROM books WHERE id=$1', [id]);
    res.json(bRows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/book/:slug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, preface, cover_image } = req.body;
  await query('UPDATE books SET title=$1,preface=$2,cover_image=$3,updated_at=NOW() WHERE id=$4',
    [title||book.title, preface??book.preface, cover_image??book.cover_image, book.id]);
  const { rows } = await query('SELECT * FROM books WHERE id=$1', [book.id]);
  res.json(rows[0]);
});

app.delete('/api/book/:slug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM book_pages WHERE book_id=$1', [book.id]);
  await query('DELETE FROM book_chapters WHERE book_id=$1', [book.id]);
  await query('DELETE FROM books WHERE id=$1', [book.id]);
  await query('UPDATE users SET book_count=GREATEST(0,book_count-1) WHERE id=$1', [req.user.id]);
  await updateUserLevel(req.user.id);
  await logAction(req.user.username, 'delete_book', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/book/:slug/pages', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, content, chapter_id, image_url } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Başlık ve içerik zorunlu' });
  const limitErr = await checkDailyLimit(req.user.id, req.user, 'book_pages');
  if (limitErr) return res.status(429).json({ error: limitErr });
  const { rows: cnt } = await query('SELECT COUNT(*) as c FROM book_pages WHERE book_id=$1', [book.id]);
  const pageNum = parseInt(cnt[0].c) + 1;
  const tempSlug = slugify(title, { lower: true, strict: false, locale: 'tr' }).substring(0, 40) + '-' + Date.now();
  const { rows } = await query('INSERT INTO book_pages (book_id,chapter_id,title,content,page_num,slug,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [book.id, chapter_id||null, title, content, pageNum, tempSlug, image_url||'']);
  const id = rows[0].id;
  const realSlug = makeSlug(title, id);
  await query('UPDATE book_pages SET slug=$1 WHERE id=$2', [realSlug, id]);
  await query('UPDATE books SET page_count=page_count+1, updated_at=NOW() WHERE id=$1', [book.id]);
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE id=$1', [id]);
  res.json(pRows[0]);
});

app.get('/api/book/:slug/page/:pageSlug', async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE slug=$1 AND book_id=$2', [req.params.pageSlug, book.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  const page = pRows[0];
  const { rows: prev } = await query('SELECT slug,title FROM book_pages WHERE book_id=$1 AND page_num=$2', [book.id, page.page_num-1]);
  const { rows: next } = await query('SELECT slug,title FROM book_pages WHERE book_id=$1 AND page_num=$2', [book.id, page.page_num+1]);
  res.json({ page, book, prev: prev[0]||null, next: next[0]||null });
});

app.put('/api/book/:slug/page/:pageSlug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE slug=$1 AND book_id=$2', [req.params.pageSlug, book.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  const page = pRows[0];
  const { title, content, chapter_id } = req.body;
  await query('UPDATE book_pages SET title=$1,content=$2,chapter_id=$3 WHERE id=$4',
    [title||page.title, content||page.content, chapter_id??page.chapter_id, page.id]);
  const { rows } = await query('SELECT * FROM book_pages WHERE id=$1', [page.id]);
  res.json(rows[0]);
});

app.delete('/api/book/:slug/page/:pageSlug', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = bRows[0];
  if (book.user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: pRows } = await query('SELECT * FROM book_pages WHERE slug=$1 AND book_id=$2', [req.params.pageSlug, book.id]);
  if (!pRows.length) return res.status(404).json({ error: 'Sayfa bulunamadı' });
  await query('DELETE FROM book_pages WHERE id=$1', [pRows[0].id]);
  await query('UPDATE books SET page_count=GREATEST(0,page_count-1) WHERE id=$1', [book.id]);
  const { rows: remaining } = await query('SELECT id FROM book_pages WHERE book_id=$1 ORDER BY page_num ASC', [book.id]);
  for (let i = 0; i < remaining.length; i++) {
    await query('UPDATE book_pages SET page_num=$1 WHERE id=$2', [i+1, remaining[i].id]);
  }
  res.json({ ok: true });
});

app.post('/api/book/:slug/chapters', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length || bRows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { title, order_num } = req.body;
  if (!title) return res.status(400).json({ error: 'Başlık zorunlu' });
  const { rows } = await query('INSERT INTO book_chapters (book_id,title,order_num) VALUES ($1,$2,$3) RETURNING *',
    [bRows[0].id, title, order_num||0]);
  res.json(rows[0]);
});

app.put('/api/book/:slug/chapter/:id', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length || bRows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: chRows } = await query('SELECT * FROM book_chapters WHERE id=$1 AND book_id=$2', [req.params.id, bRows[0].id]);
  if (!chRows.length) return res.status(404).json({ error: 'Bölüm bulunamadı' });
  const ch = chRows[0];
  const { title, order_num } = req.body;
  await query('UPDATE book_chapters SET title=$1,order_num=$2 WHERE id=$3', [title||ch.title, order_num??ch.order_num, ch.id]);
  const { rows } = await query('SELECT * FROM book_chapters WHERE id=$1', [ch.id]);
  res.json(rows[0]);
});

app.delete('/api/book/:slug/chapter/:id', authMiddleware, async (req, res) => {
  const { rows: bRows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!bRows.length || bRows[0].user_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { rows: chRows } = await query('SELECT * FROM book_chapters WHERE id=$1 AND book_id=$2', [req.params.id, bRows[0].id]);
  if (!chRows.length) return res.status(404).json({ error: 'Bölüm bulunamadı' });
  await query('UPDATE book_pages SET chapter_id=NULL WHERE chapter_id=$1', [chRows[0].id]);
  await query('DELETE FROM book_chapters WHERE id=$1', [chRows[0].id]);
  res.json({ ok: true });
});

// ===== GROUPS =====
app.get('/api/groups', async (req, res) => {
  const { rows } = await query(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id ORDER BY g.created_at DESC`);
  res.json(rows);
});

app.get('/api/group/:slug', optionalAuth, async (req, res) => {
  const { rows } = await query(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id WHERE g.slug=$1`, [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  let isMember = false, role = null;
  if (req.user) {
    const { rows: m } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
    if (m.length) { isMember = true; role = m[0].role; }
  }
  res.json({ group, isMember, role });
});

app.post('/api/groups', authMiddleware, async (req, res) => {
  try {
    const { name, description, cover_image, type, allow_chat, allow_photos, invite_only } = req.body;
    if (!name) return res.status(400).json({ error: 'İsim zorunlu' });
    const tempSlug = slugify(name, { lower: true, strict: false, locale: 'tr' }).substring(0, 60) + '-' + uuidv4().substring(0, 8);
    const { rows } = await query(
      'INSERT INTO groups (name,slug,description,cover_image,owner_id,type,allow_chat,allow_photos,invite_only,member_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING id',
      [name, tempSlug, description||'', cover_image||'', req.user.id, type||'public', allow_chat!==false?1:0, allow_photos!==false?1:0, invite_only?1:0]);
    const id = rows[0].id;
    const realSlug = makeSlug(name, id);
    await query('UPDATE groups SET slug=$1 WHERE id=$2', [realSlug, id]);
    await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [id, req.user.id, 'owner']);
    await logAction(req.user.username, 'create_group', realSlug);
    const { rows: gRows } = await query('SELECT * FROM groups WHERE id=$1', [id]);
    res.json(gRows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/group/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const { name, description, cover_image, type, allow_chat, allow_photos, invite_only } = req.body;
  await query('UPDATE groups SET name=$1,description=$2,cover_image=$3,type=$4,allow_chat=$5,allow_photos=$6,invite_only=$7 WHERE id=$8',
    [name||group.name, description??group.description, cover_image??group.cover_image,
     type||group.type, allow_chat!==undefined?(allow_chat?1:0):group.allow_chat,
     allow_photos!==undefined?(allow_photos?1:0):group.allow_photos,
     invite_only!==undefined?(invite_only?1:0):group.invite_only, group.id]);
  const { rows: gRows } = await query('SELECT * FROM groups WHERE id=$1', [group.id]);
  res.json(gRows[0]);
});

app.delete('/api/group/:slug', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM group_messages WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_members WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_invites WHERE group_id=$1', [group.id]);
  await query('DELETE FROM moderator_permissions WHERE group_id=$1', [group.id]);
  await query('DELETE FROM groups WHERE id=$1', [group.id]);
  await logAction(req.user.username, 'delete_group', req.params.slug);
  res.json({ ok: true });
});

app.post('/api/group/:slug/join', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.type === 'private' || group.invite_only) return res.status(403).json({ error: 'Bu grup sadece davet ile katılabilir' });
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (ex.length) return res.status(400).json({ error: 'Zaten üyesiniz' });
  await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [group.id, req.user.id, 'member']);
  await query('UPDATE groups SET member_count=member_count+1 WHERE id=$1', [group.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/leave', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  if (group.owner_id == req.user.id) return res.status(400).json({ error: 'Grup sahibi ayrılamaz' });
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!ex.length) return res.status(400).json({ error: 'Üye değilsiniz' });
  await query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  await query('UPDATE groups SET member_count=GREATEST(0,member_count-1) WHERE id=$1', [group.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/invite', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  const { rows: m } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!m.length || (m[0].role !== 'owner' && m[0].role !== 'moderator')) return res.status(403).json({ error: 'Yetki yok' });
  const code = uuidv4().substring(0, 8).toUpperCase();
  await query('INSERT INTO group_invites (group_id,invite_code,created_by) VALUES ($1,$2,$3)', [group.id, code, req.user.id]);
  res.json({ invite_code: code });
});

app.post('/api/group/join-invite', authMiddleware, async (req, res) => {
  const { invite_code } = req.body;
  if (!invite_code) return res.status(400).json({ error: 'Kod zorunlu' });
  const { rows } = await query('SELECT * FROM group_invites WHERE invite_code=$1', [invite_code.toUpperCase()]);
  if (!rows.length) return res.status(404).json({ error: 'Geçersiz davet kodu' });
  const invite = rows[0];
  const { rows: ex } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [invite.group_id, req.user.id]);
  if (ex.length) return res.status(400).json({ error: 'Zaten üyesiniz' });
  await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3)', [invite.group_id, req.user.id, 'member']);
  await query('UPDATE groups SET member_count=member_count+1 WHERE id=$1', [invite.group_id]);
  res.json({ ok: true });
});

app.get('/api/group/:slug/members', async (req, res) => {
  const { rows: gRows } = await query('SELECT id FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const { rows } = await query(`SELECT gm.*, u.username, u.avatar, u.name_color, u.is_vip, u.level_id FROM group_members gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.joined_at ASC`, [gRows[0].id]);
  res.json(rows);
});

app.get('/api/group/:slug/messages', optionalAuth, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (group.type === 'private') {
    if (!req.user) return res.status(401).json({ error: 'Giriş gerekli' });
    const { rows: m } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
    if (!m.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  }
  const { rows } = await query(`SELECT gm.*, u.username, u.avatar, u.name_color, u.is_vip FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY gm.created_at ASC LIMIT 200`, [group.id]);
  res.json(rows);
});

app.post('/api/group/:slug/messages', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  if (!group.allow_chat) return res.status(403).json({ error: 'Sohbet kapalı' });
  const { rows: m } = await query('SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  if (!m.length) return res.status(403).json({ error: 'Üye değilsiniz' });
  const { content, image_url } = req.body;
  if (!content?.trim() && !image_url) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const { rows } = await query('INSERT INTO group_messages (group_id,user_id,content,image_url) VALUES ($1,$2,$3,$4) RETURNING id',
    [group.id, req.user.id, content||'', image_url||'']);
  const { rows: msg } = await query(`SELECT gm.*, u.username, u.avatar, u.name_color, u.is_vip FROM group_messages gm LEFT JOIN users u ON gm.user_id=u.id WHERE gm.id=$1`, [rows[0].id]);
  res.json(msg[0]);
});

app.delete('/api/group/:slug/messages/:id', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  const { rows: msgRows } = await query('SELECT * FROM group_messages WHERE id=$1 AND group_id=$2', [req.params.id, group.id]);
  if (!msgRows.length) return res.status(404).json({ error: 'Mesaj bulunamadı' });
  const msg = msgRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const { rows: perm } = await query('SELECT * FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const isMod = member[0]?.role === 'moderator' || member[0]?.role === 'owner';
  // Kendi mesajı, grup sahibi veya moderatör (yetki kaydı yoksa da moderatöre izin ver)
  const canDelete = msg.user_id == req.user.id
    || group.owner_id == req.user.id
    || isMod;
  if (!canDelete) return res.status(403).json({ error: 'Yetki yok' });
  await query('DELETE FROM group_messages WHERE id=$1', [msg.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/moderator/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length || gRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const group = gRows[0];
  const userId = parseInt(req.params.userId);
  const { rows: m } = await query('SELECT * FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, userId]);
  if (!m.length) return res.status(404).json({ error: 'Üye bulunamadı' });
  await query('UPDATE group_members SET role=$1 WHERE group_id=$2 AND user_id=$3', ['moderator', group.id, userId]);
  await query('INSERT INTO moderator_permissions (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [group.id, userId]);
  res.json({ ok: true });
});

app.delete('/api/group/:slug/moderator/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length || gRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  await query('UPDATE group_members SET role=$1 WHERE group_id=$2 AND user_id=$3', ['member', gRows[0].id, userId]);
  await query('DELETE FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [gRows[0].id, userId]);
  res.json({ ok: true });
});

app.put('/api/group/:slug/moderator/:userId/permissions', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length || gRows[0].owner_id != req.user.id) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  const { can_delete_messages, can_ban_members, can_edit_group, can_manage_invites } = req.body;
  await query(`INSERT INTO moderator_permissions (group_id,user_id,can_delete_messages,can_ban_members,can_edit_group,can_manage_invites)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (group_id,user_id) DO UPDATE SET can_delete_messages=EXCLUDED.can_delete_messages,
    can_ban_members=EXCLUDED.can_ban_members, can_edit_group=EXCLUDED.can_edit_group, can_manage_invites=EXCLUDED.can_manage_invites`,
    [gRows[0].id, userId, can_delete_messages?1:0, can_ban_members?1:0, can_edit_group?1:0, can_manage_invites?1:0]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/ban/:userId', authMiddleware, async (req, res) => {
  const { rows: gRows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!gRows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = gRows[0];
  const { rows: member } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const { rows: perm } = await query('SELECT * FROM moderator_permissions WHERE group_id=$1 AND user_id=$2', [group.id, req.user.id]);
  const canBan = group.owner_id==req.user.id || (member[0]?.role==='moderator' && perm[0]?.can_ban_members);
  if (!canBan) return res.status(403).json({ error: 'Yetki yok' });
  const userId = parseInt(req.params.userId);
  await query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, userId]);
  await query('UPDATE groups SET member_count=GREATEST(0,member_count-1) WHERE id=$1', [group.id]);
  res.json({ ok: true });
});

app.post('/api/group/:slug/upload', authMiddleware, upload.single('image'), async (req, res) => {
  const { rows } = await query('SELECT allow_photos FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length || !rows[0].allow_photos) return res.status(403).json({ error: 'Fotoğraf yükleme kapalı' });
  if (!req.file) return res.status(400).json({ error: 'Dosya bulunamadı' });
  try {
    const url = await handleUpload(req.file);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Yükleme hatası: ' + e.message });
  }
});

// ===== PROFILE =====
app.get('/api/profile/:username', async (req, res) => {
  const { rows: users } = await query('SELECT * FROM users WHERE username=$1', [req.params.username]);
  if (!users.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const user = users[0];
  const [forums, books, groups, level, levels, bpCount] = await Promise.all([
    query('SELECT * FROM forums WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]).then(r => r.rows),
    query('SELECT * FROM books WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [user.id]).then(r => r.rows),
    query(`SELECT g.* FROM groups g INNER JOIN group_members gm ON g.id=gm.group_id WHERE gm.user_id=$1 LIMIT 20`, [user.id]).then(r => r.rows),
    query('SELECT * FROM levels WHERE id=$1', [user.level_id]).then(r => r.rows[0] || null),
    query('SELECT * FROM levels ORDER BY order_num ASC').then(r => r.rows),
    query('SELECT COUNT(*) as c FROM book_pages bp INNER JOIN books b ON bp.book_id=b.id WHERE b.user_id=$1', [user.id]).then(r => parseInt(r.rows[0].c)),
  ]);
  res.json({ user: sanitizeUser(user), forums, books, groups, level, levels, book_page_count: bpCount });
});

app.put('/api/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
  const { bio, links, name_color, show_level_badge, show_level_color, title, location, allow_mentions } = req.body;
  let newAvatar = req.user.avatar;
  if (req.file) {
    try {
      newAvatar = await handleUpload(req.file);
    } catch (e) {
      return res.status(500).json({ error: 'Avatar yükleme hatası: ' + e.message });
    }
  }
  const newLinks = links ? (typeof links === 'string' ? links : JSON.stringify(links)) : req.user.links;
  await query('UPDATE users SET bio=$1,links=$2,name_color=$3,show_level_badge=$4,show_level_color=$5,avatar=$6,title=$7,location=$8,allow_mentions=$9 WHERE id=$10',
    [bio??req.user.bio, newLinks, name_color??req.user.name_color,
     show_level_badge!==undefined?(show_level_badge?1:0):req.user.show_level_badge,
     show_level_color!==undefined?(show_level_color?1:0):req.user.show_level_color,
     newAvatar, title??req.user.title??'', location??req.user.location??'',
     allow_mentions!==undefined?(allow_mentions?1:0):(req.user.allow_mentions??1),
     req.user.id]);
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  res.json(sanitizeUser(rows[0]));
});

app.put('/api/profile/password', authMiddleware, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) return res.status(400).json({ error: 'Eski ve yeni şifre zorunlu' });
  if (req.user.password_hash !== hashPassword(old_password)) return res.status(401).json({ error: 'Eski şifre yanlış' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter' });
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(new_password), req.user.id]);
  res.json({ ok: true });
});

app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya bulunamadı' });
  try {
    const url = await handleUpload(req.file);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Yükleme hatası: ' + e.message });
  }
});

// ===== ADMIN =====
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users ORDER BY created_at DESC');
  res.json(rows.map(u => sanitizeUser(u)));
});

app.get('/api/admin/user/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json(sanitizeUser(rows[0]));
});

app.put('/api/admin/user/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const user = rows[0];
  const { username, email, password, is_vip, is_plus, name_color, level_id } = req.body;
  const newPwHash = password ? hashPassword(password) : user.password_hash;
  await query('UPDATE users SET username=$1,email=$2,password_hash=$3,is_vip=$4,is_plus=$5,name_color=$6,level_id=$7 WHERE id=$8',
    [username||user.username, email||user.email, newPwHash,
     is_vip!==undefined?(is_vip?1:0):user.is_vip, is_plus!==undefined?(is_plus?1:0):user.is_plus,
     name_color??user.name_color, level_id||user.level_id, user.id]);
  await logAction('admin', 'edit_user', user.username);
  const { rows: updated } = await query('SELECT * FROM users WHERE id=$1', [user.id]);
  res.json(sanitizeUser(updated[0]));
});

app.post('/api/admin/user/:id/ban', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const user = rows[0];
  const { ban_type } = req.body;
  await query('UPDATE users SET banned=1,ban_type=$1,banned_ip=$2 WHERE id=$3',
    [ban_type||'soft', ban_type==='ip' ? user.ip : '', user.id]);
  await logAction('admin', 'ban_user', user.username, ban_type||'soft');
  res.json({ ok: true });
});

app.post('/api/admin/user/:id/unban', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query("UPDATE users SET banned=0,ban_type='',banned_ip='' WHERE id=$1", [req.params.id]);
  await logAction('admin', 'unban_user', rows[0].username);
  res.json({ ok: true });
});

app.delete('/api/admin/user/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  await logAction('admin', 'delete_user', rows[0].username);
  res.json({ ok: true });
});

app.get('/api/admin/forums', adminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT f.*, u.username FROM forums f LEFT JOIN users u ON f.user_id=u.id ORDER BY f.created_at DESC`);
  res.json(rows);
});

app.put('/api/admin/forum/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM forums WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = rows[0];
  const { title, content, allow_comments } = req.body;
  await query('UPDATE forums SET title=$1,content=$2,allow_comments=$3 WHERE id=$4',
    [title||forum.title, content||forum.content, allow_comments!==undefined?(allow_comments?1:0):forum.allow_comments, forum.id]);
  const { rows: updated } = await query('SELECT * FROM forums WHERE id=$1', [forum.id]);
  res.json(updated[0]);
});

app.delete('/api/admin/forum/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM forums WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Konu bulunamadı' });
  const forum = rows[0];
  await query('DELETE FROM forum_comments WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_likes WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_views WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forum_tags WHERE forum_id=$1', [forum.id]);
  await query('DELETE FROM forums WHERE id=$1', [forum.id]);
  if (forum.user_id) await query('UPDATE users SET forum_count=GREATEST(0,forum_count-1) WHERE id=$1', [forum.user_id]);
  await logAction('admin', 'delete_forum', forum.slug);
  res.json({ ok: true });
});

app.get('/api/admin/books', adminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT b.*, u.username FROM books b LEFT JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC`);
  res.json(rows);
});

app.delete('/api/admin/book/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM books WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kitap bulunamadı' });
  const book = rows[0];
  await query('DELETE FROM book_pages WHERE book_id=$1', [book.id]);
  await query('DELETE FROM book_chapters WHERE book_id=$1', [book.id]);
  await query('DELETE FROM books WHERE id=$1', [book.id]);
  if (book.user_id) await query('UPDATE users SET book_count=GREATEST(0,book_count-1) WHERE id=$1', [book.user_id]);
  await logAction('admin', 'delete_book', book.slug);
  res.json({ ok: true });
});

app.get('/api/admin/groups', adminMiddleware, async (req, res) => {
  const { rows } = await query(`SELECT g.*, u.username as owner_name FROM groups g LEFT JOIN users u ON g.owner_id=u.id ORDER BY g.created_at DESC`);
  res.json(rows);
});

app.delete('/api/admin/group/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Grup bulunamadı' });
  const group = rows[0];
  await query('DELETE FROM group_messages WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_members WHERE group_id=$1', [group.id]);
  await query('DELETE FROM group_invites WHERE group_id=$1', [group.id]);
  await query('DELETE FROM moderator_permissions WHERE group_id=$1', [group.id]);
  await query('DELETE FROM groups WHERE id=$1', [group.id]);
  await logAction('admin', 'delete_group', group.slug);
  res.json({ ok: true });
});

app.get('/api/admin/levels', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM levels ORDER BY order_num ASC');
  res.json(rows);
});

app.post('/api/admin/levels', adminMiddleware, async (req, res) => {
  const { name, icon, color, min_forums, min_books, min_book_pages, min_comments, require_any, order_num,
    daily_forums, daily_books, daily_book_pages, daily_forums_vip, daily_books_vip, daily_book_pages_vip,
    daily_forums_plus, daily_books_plus, daily_book_pages_plus } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim zorunlu' });
  const { rows } = await query(`INSERT INTO levels (name,icon,color,min_forums,min_books,min_book_pages,min_comments,require_any,order_num,
    daily_forums,daily_books,daily_book_pages,daily_forums_vip,daily_books_vip,daily_book_pages_vip,
    daily_forums_plus,daily_books_plus,daily_book_pages_plus) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [name, icon||'fas fa-star', color||'#dc2626', min_forums||0, min_books||0, min_book_pages||0,
     min_comments||0, require_any?1:0, order_num||0, daily_forums??-1, daily_books??-1, daily_book_pages??-1,
     daily_forums_vip??-1, daily_books_vip??-1, daily_book_pages_vip??-1,
     daily_forums_plus??-1, daily_books_plus??-1, daily_book_pages_plus??-1]);
  res.json(rows[0]);
});

app.put('/api/admin/level/:id', adminMiddleware, async (req, res) => {
  const { rows: lvRows } = await query('SELECT * FROM levels WHERE id=$1', [req.params.id]);
  if (!lvRows.length) return res.status(404).json({ error: 'Seviye bulunamadı' });
  const lv = lvRows[0];
  const { name, icon, color, min_forums, min_books, min_book_pages, min_comments, require_any, order_num,
    daily_forums, daily_books, daily_book_pages, daily_forums_vip, daily_books_vip, daily_book_pages_vip,
    daily_forums_plus, daily_books_plus, daily_book_pages_plus } = req.body;
  await query(`UPDATE levels SET name=$1,icon=$2,color=$3,min_forums=$4,min_books=$5,min_book_pages=$6,min_comments=$7,
    require_any=$8,order_num=$9,daily_forums=$10,daily_books=$11,daily_book_pages=$12,
    daily_forums_vip=$13,daily_books_vip=$14,daily_book_pages_vip=$15,
    daily_forums_plus=$16,daily_books_plus=$17,daily_book_pages_plus=$18 WHERE id=$19`,
    [name||lv.name, icon||lv.icon, color||lv.color,
     min_forums??lv.min_forums, min_books??lv.min_books, min_book_pages??(lv.min_book_pages||0), min_comments??lv.min_comments,
     require_any!==undefined?(require_any?1:0):(lv.require_any||0), order_num??lv.order_num,
     daily_forums??(lv.daily_forums??-1), daily_books??(lv.daily_books??-1), daily_book_pages??(lv.daily_book_pages??-1),
     daily_forums_vip??(lv.daily_forums_vip??-1), daily_books_vip??(lv.daily_books_vip??-1), daily_book_pages_vip??(lv.daily_book_pages_vip??-1),
     daily_forums_plus??(lv.daily_forums_plus??-1), daily_books_plus??(lv.daily_books_plus??-1), daily_book_pages_plus??(lv.daily_book_pages_plus??-1),
     lv.id]);
  const { rows } = await query('SELECT * FROM levels WHERE id=$1', [lv.id]);
  res.json(rows[0]);
});

app.delete('/api/admin/level/:id', adminMiddleware, async (req, res) => {
  await query('DELETE FROM levels WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/tags', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM tags ORDER BY is_system DESC, name ASC');
  res.json(rows);
});

app.post('/api/admin/tags', adminMiddleware, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim zorunlu' });
  try {
    const { rows } = await query('INSERT INTO tags (name,color,is_system) VALUES ($1,$2,1) RETURNING *', [name.trim(), color||'#dc2626']);
    await logAction('admin', 'create_tag', name);
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/tag/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM tags WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Tag bulunamadı' });
  const { name, color } = req.body;
  await query('UPDATE tags SET name=$1,color=$2 WHERE id=$3', [name||rows[0].name, color||rows[0].color, rows[0].id]);
  await logAction('admin', 'update_tag', rows[0].name);
  const { rows: updated } = await query('SELECT * FROM tags WHERE id=$1', [rows[0].id]);
  res.json(updated[0]);
});

app.delete('/api/admin/tag/:id', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM tags WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Tag bulunamadı' });
  await query('DELETE FROM forum_tags WHERE tag_id=$1', [rows[0].id]);
  await query('DELETE FROM tags WHERE id=$1', [rows[0].id]);
  await logAction('admin', 'delete_tag', rows[0].name);
  res.json({ ok: true });
});

app.get('/api/admin/logs', adminMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const { rows } = await query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json(rows);
});

app.get('/api/admin/settings', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM settings');
  res.json(Object.fromEntries(rows.map(s => [s.key, s.value])));
});

app.post('/api/admin/settings', adminMiddleware, async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key zorunlu' });
  // admin_password için hash işlemi client tarafında yapılıyor, server direkt kaydeder
  await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, value]);
  res.json({ ok: true });
});

// Logo dosya yükleme (cihazdan)
app.post('/api/admin/upload-logo', adminMiddleware, upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya bulunamadı' });
  const mime = req.file.mimetype;
  if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Sadece resim dosyası yükleyebilirsiniz' });
  try {
    const url = await handleUpload(req.file);
    await query("INSERT INTO settings (key,value) VALUES ('site_logo',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [url]);
    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ error: 'Logo yükleme hatası: ' + e.message });
  }
});

app.get('/api/kvkk', async (req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key='kvkk_text'");
  res.json({ text: rows[0]?.value || '' });
});

app.get('/api/public-settings', async (req, res) => {
  const keys = ['footer_created_visible', 'footer_copyright_text'];
  const result = {};
  for (const k of keys) {
    const { rows } = await query('SELECT value FROM settings WHERE key=$1', [k]);
    result[k] = rows[0]?.value || null;
  }
  res.json(result);
});

// ===== ADMİN YETKİLİ YÖNETİMİ =====
app.post('/api/admin/user/:id/set-admin', adminMiddleware, async (req, res) => {
  const { is_admin } = req.body;
  const { rows } = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const adminSince = is_admin ? 'NOW()' : 'NULL';
  await query(`UPDATE users SET is_admin=$1, admin_since=${adminSince} WHERE id=$2`, [is_admin ? 1 : 0, req.params.id]);
  await logAction('admin', is_admin ? 'grant_admin' : 'revoke_admin', rows[0].username);
  res.json({ ok: true });
});

// ===== MÜZİK SİSTEMİ =====
function makeSongSlug(title, id) {
  const base = slugify(title, { lower: true, strict: false, locale: 'tr', replacement: '-' })
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').substring(0, 60);
  return base + '-' + id;
}

// Artist başvurusu
app.post('/api/artist/apply', authMiddleware, upload.single('sample_file'), async (req, res) => {
  const { genre, sample_song_url, note } = req.body;
  if (!genre) return res.status(400).json({ error: 'Tür gerekli' });
  if (!sample_song_url && !req.file) return res.status(400).json({ error: 'Örnek şarkı gerekli' });
  const { rows: existing } = await query('SELECT id, status FROM artist_applications WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [req.user.id]);
  if (existing.length && existing[0].status === 'pending') return res.status(400).json({ error: 'Zaten bekleyen bir başvurunuz var' });
  let sampleFile = '';
  if (req.file) { try { sampleFile = await handleUpload(req.file); } catch {} }
  const { rows } = await query(
    'INSERT INTO artist_applications (user_id, genre, sample_song_url, sample_song_file, note) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, genre, sample_song_url || '', sampleFile, note || '']
  );
  res.json(rows[0]);
});

app.get('/api/artist/my-application', authMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM artist_applications WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [req.user.id]);
  res.json(rows[0] || null);
});

// Şarkı yükleme (sadece artist)
app.post('/api/songs', authMiddleware, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  const { song_type, title, artist_name, distributor, genre, lyrics, share_reason, rules_accepted } = req.body;
  // Kendi şarkısı için artist rozeti zorunlu, başkasının şarkısı için değil
  if ((song_type === 'own' || !song_type) && !req.user.is_artist) {
    return res.status(403).json({ error: 'Kendi şarkını yüklemek için artist rozeti gerekli' });
  }
  if (!rules_accepted) return res.status(400).json({ error: 'Kuralları kabul etmelisiniz' });
  if (!title || !artist_name) return res.status(400).json({ error: 'Başlık ve sanatçı adı gerekli' });
  if (!req.files?.audio?.[0]) return res.status(400).json({ error: 'Ses dosyası gerekli' });
  let audio_url = '', cover_url = '';
  try { audio_url = await handleUpload(req.files.audio[0]); } catch (e) { return res.status(500).json({ error: 'Ses yüklenemedi: ' + e.message }); }
  if (req.files?.cover?.[0]) { try { cover_url = await handleUpload(req.files.cover[0]); } catch {} }
  const { rows } = await query(
    `INSERT INTO songs (uploader_id, song_type, title, artist_name, distributor, genre, lyrics, cover_url, audio_url, share_reason, slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'tmp') RETURNING id`,
    [req.user.id, song_type || 'own', title, artist_name, distributor || '', genre || '', lyrics || '', cover_url, audio_url, share_reason || '']
  );
  const id = rows[0].id;
  const slug = makeSongSlug(title, id);
  await query('UPDATE songs SET slug=$1 WHERE id=$2', [slug, id]);
  await logAction(req.user.username, 'upload_song', slug);
  res.json({ ok: true, slug });
});

// Tüm şarkılar (liste)
app.get('/api/songs', async (req, res) => {
  // Süresi dolan banları otomatik aktife al
  await query(`UPDATE songs SET status='active', ban_reason='', ban_until=NULL WHERE status='suspended' AND ban_until IS NOT NULL AND ban_until < NOW()`);
  const { q, genre, artist, distributor } = req.query;
  let where = "WHERE s.status='active'";
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (s.title ILIKE $${params.length} OR s.artist_name ILIKE $${params.length} OR s.lyrics ILIKE $${params.length} OR s.distributor ILIKE $${params.length})`;
  }
  if (genre && !q) { params.push(`%${genre}%`); where += ` AND s.genre ILIKE $${params.length}`; }
  if (artist && !q) { params.push(`%${artist}%`); where += ` AND s.artist_name ILIKE $${params.length}`; }
  if (distributor && !q) { params.push(`%${distributor}%`); where += ` AND s.distributor ILIKE $${params.length}`; }
  const { rows } = await query(
    `SELECT s.id, s.title, s.artist_name, s.distributor, s.genre, s.cover_url, s.audio_url,
            s.play_count, s.slug, s.song_type, s.published_at, s.share_reason,
            u.username as uploader, u.avatar as uploader_avatar
     FROM songs s LEFT JOIN users u ON s.uploader_id=u.id
     ${where} ORDER BY s.published_at DESC LIMIT 100`,
    params
  );
  res.json(rows);
});

// Tek şarkı
app.get('/api/songs/:slug', async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.username as uploader, u.avatar as uploader_avatar, u.is_artist
     FROM songs s LEFT JOIN users u ON s.uploader_id=u.id
     WHERE s.slug=$1`,
    [req.params.slug]
  );
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  res.json(rows[0]);
});

// Dinlenme sayısı artır
app.post('/api/songs/:slug/play', async (req, res) => {
  await query('UPDATE songs SET play_count=play_count+1 WHERE slug=$1', [req.params.slug]);
  res.json({ ok: true });
});

// Yarı dinleme sayacı — şarkının %50'sine ulaşınca çağrılır
app.post('/api/songs/:slug/play-half', async (req, res) => {
  await query('UPDATE songs SET play_count=play_count+1 WHERE slug=$1', [req.params.slug]);
  res.json({ ok: true });
});

// Admin: tüm şarkılar
app.get('/api/admin/songs', adminMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.username as uploader FROM songs s LEFT JOIN users u ON s.uploader_id=u.id ORDER BY s.created_at DESC`
  );
  res.json(rows);
});

// Kullanıcı: kendi şarkısını güncelle
app.put('/api/songs/:id', authMiddleware, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  const { rows } = await query('SELECT * FROM songs WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  const song = rows[0];
  if (song.uploader_id !== req.user.id) return res.status(403).json({ error: 'Bu şarkıyı düzenleme yetkiniz yok' });
  const { title, artist_name, genre, lyrics, share_reason, distributor } = req.body;
  let audio_url = song.audio_url, cover_url = song.cover_url;
  if (req.files?.audio?.[0]) { try { audio_url = await handleUpload(req.files.audio[0]); } catch {} }
  if (req.files?.cover?.[0]) { try { cover_url = await handleUpload(req.files.cover[0]); } catch {} }
  await query(
    `UPDATE songs SET title=$1, artist_name=$2, genre=$3, lyrics=$4, share_reason=$5,
     distributor=$6, audio_url=$7, cover_url=$8 WHERE id=$9`,
    [title || song.title, artist_name || song.artist_name, genre ?? song.genre,
     lyrics ?? song.lyrics, share_reason ?? song.share_reason,
     distributor ?? song.distributor, audio_url, cover_url, song.id]
  );
  await logAction(req.user.username, 'edit_song', song.slug);
  res.json({ ok: true, slug: song.slug });
});

// Admin: şarkı güncelle
app.put('/api/admin/songs/:id', adminMiddleware, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  const { title, artist_name, distributor, genre, lyrics, play_count, status } = req.body;
  const song = (await query('SELECT * FROM songs WHERE id=$1', [req.params.id])).rows[0];
  if (!song) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  let audio_url = song.audio_url, cover_url = song.cover_url;
  if (req.files?.audio?.[0]) { try { audio_url = await handleUpload(req.files.audio[0]); } catch {} }
  if (req.files?.cover?.[0]) { try { cover_url = await handleUpload(req.files.cover[0]); } catch {} }
  await query(
    `UPDATE songs SET title=$1, artist_name=$2, distributor=$3, genre=$4, lyrics=$5,
     play_count=$6, status=$7, audio_url=$8, cover_url=$9 WHERE id=$10`,
    [title || song.title, artist_name || song.artist_name, distributor ?? song.distributor,
     genre ?? song.genre, lyrics ?? song.lyrics, parseInt(play_count) || song.play_count,
     status || song.status, audio_url, cover_url, req.params.id]
  );
  res.json({ ok: true });
});

// Admin: şarkı sil
app.delete('/api/admin/songs/:id', adminMiddleware, async (req, res) => {
  await query('DELETE FROM songs WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Admin: artist başvuruları
app.get('/api/admin/artist-applications', adminMiddleware, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.username, u.avatar FROM artist_applications a
     LEFT JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC`
  );
  res.json(rows);
});

// Admin: başvuru onayla/reddet
app.post('/api/admin/artist-applications/:id/review', adminMiddleware, async (req, res) => {
  const { status } = req.body; // accepted | rejected
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum' });
  const { rows } = await query('SELECT * FROM artist_applications WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Başvuru bulunamadı' });
  await query('UPDATE artist_applications SET status=$1, reviewed_at=NOW() WHERE id=$2', [status, req.params.id]);
  if (status === 'accepted') {
    await query('UPDATE users SET is_artist=1, artist_since=NOW() WHERE id=$1', [rows[0].user_id]);
  }
  res.json({ ok: true });
});

// ===== ADMIN: ARTİSTLER =====

// Tüm artistler listesi
app.get('/api/admin/artists', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.username, u.email, u.avatar, u.is_artist, u.artist_since,
           u.artist_display_name, u.artist_bio, u.artist_genre, u.artist_website,
           u.banned,
           COUNT(s.id) AS song_count,
           SUM(s.play_count) AS total_plays
    FROM users u
    LEFT JOIN songs s ON s.uploader_id = u.id AND s.status != 'deleted'
    WHERE u.is_artist = 1
    GROUP BY u.id
    ORDER BY u.artist_since DESC
  `);
  res.json(rows);
});

// Artist bilgilerini düzenle
app.put('/api/admin/artists/:id', adminMiddleware, async (req, res) => {
  const { artist_display_name, artist_bio, artist_genre, artist_website, is_artist } = req.body;
  const { rows } = await query('SELECT id FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query(`
    UPDATE users SET
      artist_display_name = COALESCE($1, artist_display_name),
      artist_bio          = COALESCE($2, artist_bio),
      artist_genre        = COALESCE($3, artist_genre),
      artist_website      = COALESCE($4, artist_website),
      is_artist           = $5
    WHERE id = $6
  `, [
    artist_display_name ?? null,
    artist_bio ?? null,
    artist_genre ?? null,
    artist_website ?? null,
    is_artist !== undefined ? (is_artist ? 1 : 0) : 1,
    req.params.id
  ]);
  await logAction('admin', 'edit_artist', req.params.id);
  res.json({ ok: true });
});

// Artist'in şarkıları
app.get('/api/admin/artists/:id/songs', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT s.id, s.title, s.artist_name, s.genre, s.cover_url, s.audio_url,
           s.play_count, s.slug, s.status, s.song_type, s.distributor,
           s.ban_reason, s.ban_until, s.created_at
    FROM songs s
    WHERE s.uploader_id = $1
    ORDER BY s.created_at DESC
  `, [req.params.id]);
  res.json(rows);
});

// Şarkıya ban uygula (süreli veya kalıcı)
app.post('/api/admin/songs/:id/ban', adminMiddleware, async (req, res) => {
  const { reason, duration_days } = req.body;
  // duration_days: sayı ise süreli, 0 veya yoksa kalıcı (null)
  const banUntil = duration_days && parseInt(duration_days) > 0
    ? new Date(Date.now() + parseInt(duration_days) * 86400000).toISOString()
    : null;
  const { rows } = await query('SELECT id, slug FROM songs WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  await query(
    'UPDATE songs SET status=$1, ban_reason=$2, ban_until=$3 WHERE id=$4',
    ['suspended', reason || '', banUntil, req.params.id]
  );
  await logAction('admin', 'ban_song', rows[0].slug + (banUntil ? ` (${duration_days}g)` : ' (kalıcı)'));
  res.json({ ok: true, ban_until: banUntil });
});

// Şarkı banını kaldır
app.post('/api/admin/songs/:id/unban', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT id, slug FROM songs WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Şarkı bulunamadı' });
  await query(
    'UPDATE songs SET status=$1, ban_reason=$2, ban_until=$3 WHERE id=$4',
    ['active', '', null, req.params.id]
  );
  await logAction('admin', 'unban_song', rows[0].slug);
  res.json({ ok: true });
});


// Şarkı yükleme kuralları
app.get('/api/music-rules', async (req, res) => {
  const { rows: own } = await query("SELECT value FROM settings WHERE key='music_own_rules'");
  const { rows: other } = await query("SELECT value FROM settings WHERE key='music_other_rules'");
  res.json({
    own_rules: own[0]?.value || 'Kendi şarkılarınızı yüklerken telif hakkına sahip olmanız gerekmektedir.',
    other_rules: other[0]?.value || 'Başkasının şarkısını paylaşırken kaynak belirtmek zorunludur.'
  });
});

// SEO route'ları müzik için
app.get('/muzikler', (req, res) => res.send(injectMeta('Müzikler – Demlik', 'Demlik müzik platformu', `${SITE_URL}/muzikler`, '')));
app.get('/muzik/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM songs WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const s = rows[0];
  res.send(injectMeta(`${s.title} – ${s.artist_name} | Demlik`, `${s.artist_name} - ${s.title}`, `${SITE_URL}/muzik/${s.slug}`, s.cover_url));
});
app.get('/artist-basvuru', (req, res) => res.send(injectMeta('Artist Başvurusu – Demlik', 'Demlik artist rozetine başvur', `${SITE_URL}/artist-basvuru`, '')));
app.get('/artist-panel', (req, res) => res.send(injectMeta('Artist Panel – Demlik', 'Şarkı yükle ve yönet', `${SITE_URL}/artist-panel`, '')));
app.get('/sarki-yukle', (req, res) => res.send(injectMeta('Şarkı Paylaş – Demlik', 'Başkasının şarkısını topluluğa paylaş', `${SITE_URL}/sarki-yukle`, '')));

// ===== ADMIN YETKİ SİSTEMİ =====
app.get('/api/admin/permissions/:userId', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM admin_permissions WHERE user_id=$1', [req.params.userId]);
  res.json(rows[0] || null);
});

app.post('/api/admin/permissions/:userId', adminMiddleware, async (req, res) => {
  const uid = req.params.userId;
  const {
    can_ban_users, can_delete_content, can_edit_content,
    can_manage_levels, can_manage_tags, can_manage_announcements,
    can_view_logs, can_manage_settings, can_manage_admins, can_view_users
  } = req.body;
  // Kullanıcıyı admin yap (is_admin=1 yoksa set et)
  await query('UPDATE users SET is_admin=1 WHERE id=$1', [uid]);
  const { rows: existing } = await query('SELECT id FROM admin_permissions WHERE user_id=$1', [uid]);
  if (existing.length) {
    await query(`UPDATE admin_permissions SET
      can_ban_users=$1, can_delete_content=$2, can_edit_content=$3,
      can_manage_levels=$4, can_manage_tags=$5, can_manage_announcements=$6,
      can_view_logs=$7, can_manage_settings=$8, can_manage_admins=$9, can_view_users=$10
      WHERE user_id=$11`,
      [can_ban_users?1:0, can_delete_content?1:0, can_edit_content?1:0,
       can_manage_levels?1:0, can_manage_tags?1:0, can_manage_announcements?1:0,
       can_view_logs?1:0, can_manage_settings?1:0, can_manage_admins?1:0, can_view_users?1:0, uid]);
  } else {
    await query(`INSERT INTO admin_permissions
      (user_id, can_ban_users, can_delete_content, can_edit_content, can_manage_levels,
       can_manage_tags, can_manage_announcements, can_view_logs, can_manage_settings, can_manage_admins, can_view_users)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [uid, can_ban_users?1:0, can_delete_content?1:0, can_edit_content?1:0,
       can_manage_levels?1:0, can_manage_tags?1:0, can_manage_announcements?1:0,
       can_view_logs?1:0, can_manage_settings?1:0, can_manage_admins?1:0, can_view_users?1:0]);
  }
  await logAction('admin', 'set_permissions', uid);
  res.json({ ok: true });
});

// ===== DUYURU SİSTEMİ =====
app.get('/api/announcements', async (req, res) => {
  const { rows } = await query(`SELECT * FROM announcements WHERE active=1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC`);
  res.json(rows);
});

app.get('/api/admin/announcements', adminMiddleware, async (req, res) => {
  const { rows } = await query('SELECT * FROM announcements ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/admin/announcements', adminMiddleware, async (req, res) => {
  const { title, content, bg_color, text_color, border_color, position, size, duration_type, duration_value } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Başlık ve içerik gerekli' });
  let expires_at = null;
  if (duration_value && parseInt(duration_value) > 0) {
    const ms = {
      seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000
    }[duration_type] || 86400000;
    expires_at = new Date(Date.now() + parseInt(duration_value) * ms);
  }
  const { rows } = await query(
    `INSERT INTO announcements (title, content, bg_color, text_color, border_color, position, size, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, content, bg_color||'#dc2626', text_color||'#ffffff', border_color||'#991b1b',
     position||'top', size||'normal', expires_at]
  );
  res.json(rows[0]);
});

app.put('/api/admin/announcements/:id', adminMiddleware, async (req, res) => {
  const { title, content, bg_color, text_color, border_color, position, size, active, duration_type, duration_value } = req.body;
  let expires_at_sql = '';
  const params = [title, content, bg_color, text_color, border_color, position, size, active?1:0];
  if (duration_value && parseInt(duration_value) > 0) {
    const ms = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[duration_type] || 86400000;
    params.push(new Date(Date.now() + parseInt(duration_value) * ms));
    expires_at_sql = `, expires_at=$${params.length}`;
  }
  params.push(req.params.id);
  await query(
    `UPDATE announcements SET title=$1,content=$2,bg_color=$3,text_color=$4,border_color=$5,position=$6,size=$7,active=$8${expires_at_sql} WHERE id=$${params.length}`,
    params
  );
  const { rows } = await query('SELECT * FROM announcements WHERE id=$1', [req.params.id]);
  res.json(rows[0]);
});

app.delete('/api/admin/announcements/:id', adminMiddleware, async (req, res) => {
  await query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ===== ADMİN: KULLANICI PROFİL ERİŞİM KONTROLÜ =====
app.get('/api/admin/my-perms', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Yetkisiz' });
  const { rows } = await query('SELECT * FROM admin_permissions WHERE user_id=$1', [req.user.id]);
  // tam admin ise tüm yetkiler var
  const isSuperAdmin = !rows.length;
  res.json({
    is_super_admin: isSuperAdmin,
    permissions: rows[0] || {
      can_ban_users:1, can_delete_content:1, can_edit_content:1,
      can_manage_levels:1, can_manage_tags:1, can_manage_announcements:1,
      can_view_logs:1, can_manage_settings:1, can_manage_admins:1, can_view_users:1
    }
  });
});

// ===== SITE AYARLARI (logo vb.) =====
app.get('/api/settings/public', async (req, res) => {
  const { rows } = await query("SELECT key, value FROM settings WHERE key IN ('site_logo','site_name','site_description')");
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

// ===== SPOTİFY OAuth =====
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_REDIRECT = (process.env.SITE_URL || 'https://demlik.up.railway.app') + '/api/spotify/callback';

app.get('/api/spotify/connect', authMiddleware, (req, res) => {
  const scopes = 'user-read-currently-playing user-read-playback-state';
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT)}&state=${req.user.id}`;
  res.redirect(url);
});

// Token'sız erişim için: token query param ile
app.get('/api/spotify/connect-redirect', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/ayarlar?spotify=error');
  const { rows } = await query('SELECT user_id FROM sessions WHERE token=$1', [token]);
  if (!rows.length) return res.redirect('/ayarlar?spotify=error');
  const scopes = 'user-read-currently-playing user-read-playback-state';
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT)}&state=${rows[0].user_id}`;
  res.redirect(url);
});

app.get('/api/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/ayarlar?spotify=error');
  const userId = parseInt(state);
  if (!userId) return res.redirect('/ayarlar?spotify=error');
  try {
    const tokenRes = await new Promise((resolve, reject) => {
      const body = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT)}`;
      const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
      const options = {
        hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) }
      };
      const req2 = require('https').request(options, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      });
      req2.on('error', reject); req2.write(body); req2.end();
    });
    if (!tokenRes.access_token) return res.redirect('/ayarlar?spotify=error');
    const expires = Date.now() + (tokenRes.expires_in * 1000);
    await query('UPDATE users SET spotify_token=$1, spotify_refresh=$2, spotify_expires=$3, spotify_show=1 WHERE id=$4',
      [tokenRes.access_token, tokenRes.refresh_token || '', expires, userId]);
    res.redirect('/ayarlar?spotify=ok');
  } catch (e) {
    res.redirect('/ayarlar?spotify=error');
  }
});

app.post('/api/spotify/disconnect', authMiddleware, async (req, res) => {
  await query("UPDATE users SET spotify_token='', spotify_refresh='', spotify_expires=0 WHERE id=$1", [req.user.id]);
  res.json({ ok: true });
});

app.put('/api/spotify/visibility', authMiddleware, async (req, res) => {
  const { show } = req.body;
  await query('UPDATE users SET spotify_show=$1 WHERE id=$2', [show ? 1 : 0, req.user.id]);
  res.json({ ok: true });
});

async function refreshSpotifyToken(userId, refreshToken) {
  return new Promise((resolve, reject) => {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const options = {
      hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) }
    };
    const req2 = require('https').request(options, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', async () => {
        try {
          const data = JSON.parse(d);
          if (data.access_token) {
            const expires = Date.now() + (data.expires_in * 1000);
            await query('UPDATE users SET spotify_token=$1, spotify_expires=$2 WHERE id=$3', [data.access_token, expires, userId]);
            resolve(data.access_token);
          } else { reject(new Error('refresh failed')); }
        } catch (e) { reject(e); }
      });
    });
    req2.on('error', reject); req2.write(body); req2.end();
  });
}

app.get('/api/spotify/now-playing/:username', async (req, res) => {
  const { rows } = await query('SELECT spotify_token, spotify_refresh, spotify_expires, spotify_show FROM users WHERE username=$1', [req.params.username]);
  if (!rows.length || !rows[0].spotify_token || !rows[0].spotify_show) return res.json({ playing: false });
  let token = rows[0].spotify_token;
  const uid_rows = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  const uid = uid_rows.rows[0]?.id;
  // Token süresi dolmuşsa yenile
  if (Date.now() > parseInt(rows[0].spotify_expires) - 60000) {
    try { token = await refreshSpotifyToken(uid, rows[0].spotify_refresh); } catch { return res.json({ playing: false }); }
  }
  // Spotify API'den şu an çalınanı al
  const result = await new Promise(resolve => {
    const options = {
      hostname: 'api.spotify.com', path: '/v1/me/player/currently-playing',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req2 = require('https').request(options, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode === 204 || !d) return resolve({ playing: false });
        try {
          const data = JSON.parse(d);
          if (!data.item || !data.is_playing) return resolve({ playing: false });
          resolve({
            playing: true,
            title: data.item.name,
            artist: data.item.artists.map(a => a.name).join(', '),
            album_art: data.item.album?.images?.[0]?.url || '',
            url: data.item.external_urls?.spotify || '',
            progress_ms: data.progress_ms || 0,
            duration_ms: data.item.duration_ms || 0
          });
        } catch { resolve({ playing: false }); }
      });
    });
    req2.on('error', () => resolve({ playing: false })); req2.end();
  });
  res.json(result);
});

// ===== SEO META INJECT =====
// ===== ADMIN IP WHITELIST =====
function getAdminIPs() {
  const env = process.env.ADMIN_IPS || '';
  if (!env.trim()) return [];
  return env.split(',').map(ip => ip.trim()).filter(Boolean);
}

function adminIPCheck(req, res, next) {
  const allowed = getAdminIPs();
  if (allowed.length === 0) return next(); // env set edilmemişse geliştirme modunda aç
  const clientIP = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || '').split(',')[0].trim();
  if (allowed.includes(clientIP)) return next();
  return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
}

app.get('/panel-giris', adminIPCheck, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/panel', adminIPCheck, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

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

app.get('/giris', (req, res) => res.send(injectMeta('Giriş – Demlik', 'Demlik hesabına giriş yap.', `${SITE_URL}/giris`, '')));
app.get('/kayit', (req, res) => res.send(injectMeta('Kayıt Ol – Demlik', "Demlik'e ücretsiz kaydol.", `${SITE_URL}/kayit`, '')));
app.get('/forum', (req, res) => {
  const tag = req.query.tag || '';
  res.send(injectMeta(tag ? `${tag} Konuları – Demlik` : 'Konular – Demlik',
    tag ? `Demlik'te ${tag} etiketli konular.` : 'Demlik topluluğunun konularını keşfet.',
    `${SITE_URL}/forum${tag ? '?tag='+encodeURIComponent(tag) : ''}`, ''));
});
app.get('/kitaplar', (req, res) => res.send(injectMeta('E-Kitaplar – Demlik', "Demlik yazarlarının e-kitaplarını oku.", `${SITE_URL}/kitaplar`, '')));
app.get('/gruplar', (req, res) => res.send(injectMeta('Gruplar – Demlik', "Demlik'teki gruplara katıl.", `${SITE_URL}/gruplar`, '')));
app.get('/ayarlar', (req, res) => res.send(injectMeta('Ayarlar – Demlik', 'Hesap ayarlarını düzenle.', `${SITE_URL}/ayarlar`, '')));
app.get('/mesajlar', (req, res) => res.send(injectMeta('Mesajlar – Demlik', 'Özel mesajlarınız.', `${SITE_URL}/mesajlar`, '')));
app.get('/mesajlar/:username', (req, res) => res.send(injectMeta('Mesajlar – Demlik', 'Özel mesajlarınız.', `${SITE_URL}/mesajlar/${req.params.username}`, '')));
app.get('/arkadaslar', (req, res) => res.send(injectMeta('Arkadaşlar – Demlik', 'Arkadaş listesi.', `${SITE_URL}/arkadaslar`, '')));

app.get('/forum/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM forums WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const forum = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((forum.content || '').substring(0, 160).replace(/\n/g, ' '));
  const imgTag = forum.banner_image
    ? `<meta property="og:image" content="${escapeHtml(forum.banner_image)}" /><meta name="twitter:image" content="${escapeHtml(forum.banner_image)}" /><meta name="twitter:card" content="summary_large_image" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(forum.title)} – Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:title" content="${escapeHtml(forum.title)} – Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${SITE_URL}/forum/${escapeHtml(forum.slug)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}
    <script type="application/ld+json">${JSON.stringify({ '@context':'https://schema.org','@type':'DiscussionForumPosting','headline':forum.title,'url':`${SITE_URL}/forum/${forum.slug}`,'datePublished':forum.created_at,'author':{'@type':'Person','name':forum.username||'Anonim'},'publisher':{'@type':'Organization','name':'Demlik','url':SITE_URL} })}</script>`;
  res.send(html.replace('<title>Demlik</title>', meta));
});

app.get('/kitap/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM books WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const book = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((book.preface || book.title + ' – Demlik').substring(0, 160));
  const imgTag = book.cover_image
    ? `<meta property="og:image" content="${escapeHtml(book.cover_image)}" /><meta name="twitter:image" content="${escapeHtml(book.cover_image)}" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(book.title)} – Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/kitap/${escapeHtml(book.slug)}" />
    <meta property="og:title" content="${escapeHtml(book.title)} – Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:type" content="book" />
    <meta property="og:url" content="${SITE_URL}/kitap/${escapeHtml(book.slug)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}`;
  res.send(html.replace('<title>Demlik</title>', meta));
});

app.get('/grup/:slug', async (req, res) => {
  const { rows } = await query('SELECT * FROM groups WHERE slug=$1', [req.params.slug]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const group = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((group.description || group.name + ' – Demlik topluluğu grubu.').substring(0, 160));
  const imgTag = group.cover_image
    ? `<meta property="og:image" content="${escapeHtml(group.cover_image)}" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(group.name)} – Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/grup/${escapeHtml(group.slug)}" />
    <meta property="og:title" content="${escapeHtml(group.name)} – Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${SITE_URL}/grup/${escapeHtml(group.slug)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}`;
  res.send(html.replace('<title>Demlik</title>', meta));
});

app.get('/profil/:username', async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE username=$1', [req.params.username]);
  if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  const user = rows[0];
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const desc = escapeHtml((user.bio || `${user.username} adlı kullanıcının Demlik profili.`).substring(0, 160));
  const imgTag = user.avatar
    ? `<meta property="og:image" content="${escapeHtml(user.avatar)}" />`
    : `<meta property="og:image" content="${SITE_URL}/demlik.png" />`;
  const meta = `<title>${escapeHtml(user.username)} – Demlik</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${SITE_URL}/profil/${escapeHtml(user.username)}" />
    <meta property="og:title" content="${escapeHtml(user.username)} – Demlik" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${SITE_URL}/profil/${escapeHtml(user.username)}" />
    <meta property="og:site_name" content="Demlik" />
    ${imgTag}`;
  res.send(html.replace('<title>Demlik</title>', meta));
});


// ===== KULLANICI ARAMA =====
app.get('/api/search/users', async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json([]);
  const { rows } = await query(`SELECT id, username, avatar, name_color FROM users WHERE username ILIKE $1 AND banned=0 LIMIT 20`, [`%${q}%`]);
  res.json(rows);
});

// ===== ARKADAŞLIK =====
app.get('/api/friends', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT f.*, 
      CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END as other_id,
      CASE WHEN f.requester_id=$1 THEN u2.username ELSE u1.username END as other_username,
      CASE WHEN f.requester_id=$1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
      CASE WHEN f.requester_id=$1 THEN u2.name_color ELSE u1.name_color END as other_name_color,
      CASE WHEN f.requester_id=$1 THEN COALESCE(u2.is_deleted,0) ELSE COALESCE(u1.is_deleted,0) END as other_is_deleted
    FROM friendships f
    LEFT JOIN users u1 ON f.requester_id=u1.id
    LEFT JOIN users u2 ON f.addressee_id=u2.id
    WHERE (f.requester_id=$1 OR f.addressee_id=$1)
  `, [uid]);
  res.json(rows);
});

app.post('/api/friends/request/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const targetId = target[0].id;
  if (targetId == req.user.id) return res.status(400).json({ error: 'Kendinize istek gönderemezsiniz' });
  // Engel kontrolü
  const { rows: blk } = await query('SELECT id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)', [req.user.id, targetId]);
  if (blk.length) return res.status(403).json({ error: 'Bu kullanıcıyla işlem yapılamaz' });
  const { rows: ex } = await query('SELECT * FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)', [req.user.id, targetId]);
  if (ex.length) return res.status(400).json({ error: 'Zaten istek gönderilmiş veya arkadaşsınız' });
  await query('INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,$3)', [req.user.id, targetId, 'pending']);
  res.json({ ok: true });
});

app.post('/api/friends/respond/:id', authMiddleware, async (req, res) => {
  const { action } = req.body; // accept | reject
  const { rows } = await query('SELECT * FROM friendships WHERE id=$1 AND addressee_id=$2', [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'İstek bulunamadı' });
  if (action === 'accept') {
    await query("UPDATE friendships SET status='accepted', updated_at=NOW() WHERE id=$1", [rows[0].id]);
  } else {
    await query('DELETE FROM friendships WHERE id=$1', [rows[0].id]);
  }
  res.json({ ok: true });
});

app.delete('/api/friends/:id', authMiddleware, async (req, res) => {
  await query('DELETE FROM friendships WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2)', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ===== ENGELLEME =====
app.post('/api/block/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const targetId = target[0].id;
  if (targetId == req.user.id) return res.status(400).json({ error: 'Kendinizi engelleyemezsiniz' });
  // Arkadaşlığı sil
  await query('DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)', [req.user.id, targetId]);
  await query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, targetId]);
  res.json({ ok: true });
});

app.delete('/api/block/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [req.user.id, target[0].id]);
  res.json({ ok: true });
});

app.get('/api/blocks', authMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT b.*, u.username, u.avatar, COALESCE(u.is_deleted,0) as is_deleted FROM blocks b
    JOIN users u ON b.blocked_id=u.id
    WHERE b.blocker_id=$1 ORDER BY b.created_at DESC
  `, [req.user.id]);
  res.json(rows);
});

// ===== MESAJLAR (DM) =====
app.get('/api/conversations', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT c.*,
      CASE WHEN c.user1_id=$1 THEN u2.username ELSE u1.username END as other_username,
      CASE WHEN c.user1_id=$1 THEN u2.avatar ELSE u1.avatar END as other_avatar,
      CASE WHEN c.user1_id=$1 THEN u2.id ELSE u1.id END as other_id,
      CASE WHEN c.user1_id=$1 THEN u2.name_color ELSE u1.name_color END as other_name_color,
      (SELECT content FROM dm_messages WHERE conversation_id=c.id AND deleted_for_all=0 ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM dm_messages WHERE conversation_id=c.id AND sender_id!=$1 AND 
        CASE WHEN c.user1_id=$1 THEN deleted_by_receiver=0 ELSE deleted_by_sender=0 END
        AND deleted_for_all=0
        AND id > CASE WHEN c.user1_id=$1 THEN COALESCE(c.read_until_user1,0) ELSE COALESCE(c.read_until_user2,0) END
      ) as unread_count
    FROM dm_conversations c
    JOIN users u1 ON c.user1_id=u1.id
    JOIN users u2 ON c.user2_id=u2.id
    WHERE (c.user1_id=$1 AND c.hidden_by_user1=0) OR (c.user2_id=$1 AND c.hidden_by_user2=0)
    ORDER BY c.last_message_at DESC
  `, [uid]);
  res.json(rows);
});

app.get('/api/conversations/unread-count', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { rows } = await query(`
    SELECT COUNT(*) as c FROM dm_conversations c
    WHERE ((c.user1_id=$1 AND c.hidden_by_user1=0) OR (c.user2_id=$1 AND c.hidden_by_user2=0))
    AND EXISTS (
      SELECT 1 FROM dm_messages m WHERE m.conversation_id=c.id AND m.sender_id!=$1
      AND CASE WHEN c.user1_id=$1 THEN m.deleted_by_receiver=0 ELSE m.deleted_by_sender=0 END
      AND m.deleted_for_all=0
      AND m.id > CASE WHEN c.user1_id=$1 THEN COALESCE(c.read_until_user1,0) ELSE COALESCE(c.read_until_user2,0) END
    )
  `, [uid]);
  res.json({ count: parseInt(rows[0].c) });
});

app.get('/api/conversation/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id,username,avatar,name_color FROM users WHERE username=$1', [req.params.username]);  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  let { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) {
    const { rows: newConv } = await query('INSERT INTO dm_conversations (user1_id, user2_id) VALUES ($1,$2) RETURNING *', [u1, u2]);
    convRows = newConv;
  }
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const isHidden = isUser1 ? conv.hidden_by_user1 : conv.hidden_by_user2;
  const hiddenPass = isUser1 ? conv.hidden_pass_user1 : conv.hidden_pass_user2;
  const { rows: msgs } = await query(`
    SELECT m.*, 
      u.username as sender_username, u.avatar as sender_avatar, u.name_color as sender_name_color,
      f.title as forum_title, f.slug as forum_slug, f.banner_image as forum_banner,
      r.content as reply_content, ru.username as reply_username,
      m.read_at
    FROM dm_messages m
    JOIN users u ON m.sender_id=u.id
    LEFT JOIN forums f ON m.shared_forum_id=f.id
    LEFT JOIN dm_messages r ON m.reply_to_id=r.id
    LEFT JOIN users ru ON r.sender_id=ru.id
    WHERE m.conversation_id=$1
      AND ($2=1 OR m.deleted_by_sender=0 OR m.sender_id!=$3)
      AND ($2=1 OR m.deleted_by_receiver=0 OR m.sender_id=$3)
    ORDER BY m.created_at ASC
  `, [conv.id, 0, uid]);

  // Konuşma açılınca read_until güncelle (son mesaj ID'si)
  if (msgs.length) {
    const lastId = msgs[msgs.length - 1].id;
    if (isUser1) {
      await query('UPDATE dm_conversations SET read_until_user1=$1 WHERE id=$2 AND read_until_user1 < $1', [lastId, conv.id]);
    } else {
      await query('UPDATE dm_conversations SET read_until_user2=$1 WHERE id=$2 AND read_until_user2 < $1', [lastId, conv.id]);
    }
  }

  res.json({ conv, other, messages: msgs, isHidden, hasPassword: !!hiddenPass });
});

// Mesajları okundu işaretle
app.post('/api/conversation/:username/mark-read', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT id FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.json({ ok: true });
  // Karşı tarafın mesajlarını okundu yap
  await query('UPDATE dm_messages SET read_at=NOW() WHERE conversation_id=$1 AND sender_id=$2 AND read_at IS NULL',
    [convRows[0].id, other.id]);
  res.json({ ok: true });
});

app.post('/api/conversation/:username/messages', authMiddleware, upload.single('image'), async (req, res) => {  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  // Engel kontrolü
  const { rows: blk } = await query('SELECT id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)', [uid, other.id]);
  if (blk.length) return res.status(403).json({ error: 'Bu kullanıcıyla mesajlaşamazsınız' });
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  let { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) {
    const { rows: nc } = await query('INSERT INTO dm_conversations (user1_id, user2_id) VALUES ($1,$2) RETURNING *', [u1, u2]);
    convRows = nc;
  }
  const conv = convRows[0];
  // Gizliliği aç (karşı taraftan mesaj geldi)
  if (conv.user1_id == other.id && conv.hidden_by_user1) {
    await query('UPDATE dm_conversations SET hidden_by_user1=0 WHERE id=$1', [conv.id]);
  } else if (conv.user2_id == other.id && conv.hidden_by_user2) {
    await query('UPDATE dm_conversations SET hidden_by_user2=0 WHERE id=$1', [conv.id]);
  }
  const { content, shared_forum_id, reply_to_id } = req.body;
  let image_url = '';
  if (req.file) {
    try { image_url = await handleUpload(req.file); } catch (e) {}
  }
  if (!content?.trim() && !image_url && !shared_forum_id) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const { rows: msgRows } = await query(
    'INSERT INTO dm_messages (conversation_id, sender_id, content, image_url, shared_forum_id, reply_to_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [conv.id, uid, content||'', image_url, shared_forum_id||null, reply_to_id||null]
  );
  await query('UPDATE dm_conversations SET last_message_at=NOW() WHERE id=$1', [conv.id]);
  // Forum paylaşım sayısını artır
  if (shared_forum_id) {
    await query('UPDATE forums SET share_count=COALESCE(share_count,0)+1 WHERE id=$1', [shared_forum_id]);
  }
  // DM @mention bildirimleri
  if (content?.trim()) {
    await parseMentionsAndNotify(content, req.user, 'dm_mention', '/mesajlar/' + req.params.username).catch(() => {});
  }
  const { rows: full } = await query(`
    SELECT m.*, u.username as sender_username, u.avatar as sender_avatar, u.name_color as sender_name_color,
      f.title as forum_title, f.slug as forum_slug, f.banner_image as forum_banner,
      r.content as reply_content, ru.username as reply_username
    FROM dm_messages m JOIN users u ON m.sender_id=u.id
    LEFT JOIN forums f ON m.shared_forum_id=f.id
    LEFT JOIN dm_messages r ON m.reply_to_id=r.id
    LEFT JOIN users ru ON r.sender_id=ru.id
    WHERE m.id=$1
  `, [msgRows[0].id]);
  res.json(full[0]);
});

app.post('/api/conversation/:username/hide', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const passHash = password ? require('crypto').createHash('sha256').update(password).digest('hex') : '';
  if (isUser1) {
    await query('UPDATE dm_conversations SET hidden_by_user1=1, hidden_pass_user1=$1 WHERE id=$2', [passHash, conv.id]);
  } else {
    await query('UPDATE dm_conversations SET hidden_by_user2=1, hidden_pass_user2=$1 WHERE id=$2', [passHash, conv.id]);
  }
  res.json({ ok: true });
});

app.post('/api/conversation/:username/unhide', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const storedHash = isUser1 ? conv.hidden_pass_user1 : conv.hidden_pass_user2;
  if (storedHash) {
    const inputHash = require('crypto').createHash('sha256').update(password||'').digest('hex');
    if (inputHash !== storedHash) return res.status(403).json({ error: 'Yanlış şifre' });
  }
  if (isUser1) {
    await query('UPDATE dm_conversations SET hidden_by_user1=0 WHERE id=$1', [conv.id]);
  } else {
    await query('UPDATE dm_conversations SET hidden_by_user2=0 WHERE id=$1', [conv.id]);
  }
  res.json({ ok: true });
});

app.post('/api/conversation/:username/set-password', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  const passHash = password ? require('crypto').createHash('sha256').update(password).digest('hex') : '';
  if (isUser1) {
    await query('UPDATE dm_conversations SET hidden_pass_user1=$1 WHERE id=$2', [passHash, conv.id]);
  } else {
    await query('UPDATE dm_conversations SET hidden_pass_user2=$1 WHERE id=$2', [passHash, conv.id]);
  }
  res.json({ ok: true });
});

app.delete('/api/messages/:id', authMiddleware, async (req, res) => {
  const { mode } = req.body; // 'me' | 'all'
  const { rows } = await query('SELECT * FROM dm_messages WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Mesaj bulunamadı' });
  const msg = rows[0];
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE id=$1', [msg.conversation_id]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isOwn = msg.sender_id == req.user.id;
  if (mode === 'all' && !isOwn) return res.status(403).json({ error: 'Sadece kendi mesajınızı herkesten silebilirsiniz' });
  if (mode === 'all') {
    await query('UPDATE dm_messages SET deleted_for_all=1 WHERE id=$1', [msg.id]);
  } else {
    if (msg.sender_id == req.user.id) {
      await query('UPDATE dm_messages SET deleted_by_sender=1 WHERE id=$1', [msg.id]);
    } else {
      await query('UPDATE dm_messages SET deleted_by_receiver=1 WHERE id=$1', [msg.id]);
    }
  }
  res.json({ ok: true });
});

app.post('/api/messages/delete-bulk', authMiddleware, async (req, res) => {
  const { ids, mode } = req.body; // ids: array, mode: 'me'|'all'
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ID listesi gerekli' });
  for (const id of ids) {
    const { rows } = await query('SELECT * FROM dm_messages WHERE id=$1', [id]);
    if (!rows.length) continue;
    const msg = rows[0];
    const isOwn = msg.sender_id == req.user.id;
    if (mode === 'all' && !isOwn) continue; // sadece kendi mesajlarını herkesten sil
    if (mode === 'all') {
      await query('UPDATE dm_messages SET deleted_for_all=1 WHERE id=$1', [id]);
    } else {
      if (isOwn) await query('UPDATE dm_messages SET deleted_by_sender=1 WHERE id=$1', [id]);
      else await query('UPDATE dm_messages SET deleted_by_receiver=1 WHERE id=$1', [id]);
    }
  }
  res.json({ ok: true });
});

app.delete('/api/conversation/:username', authMiddleware, async (req, res) => {
  const { rows: target } = await query('SELECT id FROM users WHERE username=$1', [req.params.username]);
  if (!target.length) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const other = target[0];
  const uid = req.user.id;
  const u1 = Math.min(uid, other.id), u2 = Math.max(uid, other.id);
  const { rows: convRows } = await query('SELECT * FROM dm_conversations WHERE user1_id=$1 AND user2_id=$2', [u1, u2]);
  if (!convRows.length) return res.status(404).json({ error: 'Konuşma bulunamadı' });
  const conv = convRows[0];
  const isUser1 = conv.user1_id == uid;
  // Sadece kendi tarafından gizle (soft delete)
  if (isUser1) await query('UPDATE dm_conversations SET hidden_by_user1=2 WHERE id=$1', [conv.id]);
  else await query('UPDATE dm_conversations SET hidden_by_user2=2 WHERE id=$1', [conv.id]);
  res.json({ ok: true });
});

// ===== ADMIN: MESAJLARI OKU =====
app.get('/api/admin/conversations', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT c.id, u1.username as user1, u2.username as user2, c.last_message_at,
      (SELECT COUNT(*) FROM dm_messages WHERE conversation_id=c.id) as message_count
    FROM dm_conversations c
    JOIN users u1 ON c.user1_id=u1.id
    JOIN users u2 ON c.user2_id=u2.id
    ORDER BY c.last_message_at DESC LIMIT 200
  `);
  res.json(rows);
});

app.get('/api/admin/conversations/:id/messages', adminMiddleware, async (req, res) => {
  const { rows } = await query(`
    SELECT m.*, u.username as sender_username
    FROM dm_messages m JOIN users u ON m.sender_id=u.id
    WHERE m.conversation_id=$1 ORDER BY m.created_at ASC
  `, [req.params.id]);
  res.json(rows);
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== BAŞLAT =====
initDb().then(() => {
  app.listen(PORT, () => console.log(`Demlik calisiyor: http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB başlatma hatası:', err);
  process.exit(1);
});
