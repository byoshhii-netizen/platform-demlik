require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { pool, initDB } = require('./database');
const { requireAuth, requireAdmin, requireAuthPage, requireAdminPage } = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'demlik_fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// IP kayıt middleware
app.use(async (req, res, next) => {
  if (req.session.userId) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    try { await pool.query('UPDATE users SET last_ip=$1 WHERE id=$2', [ip, req.session.userId]); } catch {}
  }
  next();
});

// ==================== SAYFA ROUTE'LARI ====================

// Ana sayfa
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/anasayfa.html')));

// Auth sayfaları
app.get('/giris', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/giris.html')));
app.get('/kayit', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/kayit.html')));

// Store
app.get('/magazin', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/magazin.html')));

// Oyun sayfaları
app.get('/oyun/:id', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/oyun.html')));

// Kütüphane
app.get('/kutuphane', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/kutuphane.html')));

// Arkadaşlar
app.get('/arkadaslar', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/arkadaslar.html')));

// Profil
app.get('/profil/:username', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/profil.html')));

// Ayarlar
app.get('/ayarlar', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/ayarlar.html')));
app.get('/ayarlar/profil', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/ayarlar-profil.html')));
app.get('/ayarlar/engellenenler', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/ayarlar-engellenenler.html')));
app.get('/ayarlar/aile-denetimi', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/ayarlar-aile.html')));

// Geliştirici paneli
app.get('/gelistirici', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/gelistirici.html')));
app.get('/gelistirici/dashboard', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/gelistirici-dashboard.html')));
app.get('/gelistirici/oyun-yukle', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/gelistirici-oyun-yukle.html')));
app.get('/gelistirici/oyun/:id/duzenle', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/gelistirici-oyun-duzenle.html')));

// Admin paneli
app.get('/admin', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin.html')));
app.get('/admin/basvurular', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin-basvurular.html')));
app.get('/admin/oyunlar', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin-oyunlar.html')));
app.get('/admin/kullanicilar', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin-kullanicilar.html')));
app.get('/admin/turler', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin-turler.html')));
app.get('/admin/ayarlar', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/pages/admin-ayarlar.html')));

// ==================== API ROUTE'LARI ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/oyunlar', require('./routes/games'));
app.use('/api/kullanicilar', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/gelistirici', require('./routes/developer'));
app.use('/api/arkadaslar', require('./routes/friends'));
app.use('/api/mesajlar', require('./routes/messages'));

// Oturum bilgisi
app.get('/api/ben', async (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  try {
    const r = await pool.query(
      "SELECT id, username, role, email, avatar_url FROM users WHERE id=$1", [req.session.userId]
    );
    if (!r.rows[0]) return res.json({ loggedIn: false });
    // Geliştirici başvuru durumu
    const app2 = await pool.query(
      "SELECT status FROM developer_applications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [req.session.userId]
    );
    res.json({
      loggedIn: true,
      ...r.rows[0],
      devApplicationStatus: app2.rows[0]?.status || null
    });
  } catch { res.json({ loggedIn: false }); }
});

// ==================== BAŞLAT ====================

// Global hata yakalayıcı
app.use((err, req, res, next) => {
  console.error('Hata:', err.stack);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ error: 'Sunucu hatası' });
  } else {
    res.status(500).send('Sunucu hatası oluştu. Lütfen tekrar deneyin.');
  }
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`Demlik Platform: http://localhost:${PORT}`));
}).catch(err => { console.error('Başlatma hatası:', err); process.exit(1); });
