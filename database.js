const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'persistent', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'forum.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  links TEXT DEFAULT '[]',
  level_id INTEGER DEFAULT 1,
  show_level_badge INTEGER DEFAULT 1,
  show_level_color INTEGER DEFAULT 1,
  is_vip INTEGER DEFAULT 0,
  is_plus INTEGER DEFAULT 0,
  name_color TEXT DEFAULT '',
  banned INTEGER DEFAULT 0,
  ban_type TEXT DEFAULT '',
  banned_ip TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  kvkk_accepted INTEGER DEFAULT 0,
  forum_count INTEGER DEFAULT 0,
  book_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  last_active DATETIME DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'fas fa-star',
  color TEXT DEFAULT '#dc2626',
  min_forums INTEGER DEFAULT 0,
  min_books INTEGER DEFAULT 0,
  min_comments INTEGER DEFAULT 0,
  order_num INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS forums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  banner_image TEXT DEFAULT '',
  slug TEXT UNIQUE,
  allow_comments INTEGER DEFAULT 1,
  views INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS forum_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forum_id INTEGER,
  ip TEXT,
  view_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS forum_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forum_id INTEGER,
  user_id INTEGER,
  UNIQUE(forum_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forum_id INTEGER,
  user_id INTEGER,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(forum_id) REFERENCES forums(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT NOT NULL,
  preface TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  slug TEXT UNIQUE,
  page_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  updated_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS book_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  title TEXT NOT NULL,
  order_num INTEGER DEFAULT 0,
  FOREIGN KEY(book_id) REFERENCES books(id)
);

CREATE TABLE IF NOT EXISTS book_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  chapter_id INTEGER,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  page_num INTEGER DEFAULT 1,
  slug TEXT UNIQUE,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(chapter_id) REFERENCES book_chapters(id)
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  owner_id INTEGER,
  type TEXT DEFAULT 'public',
  allow_chat INTEGER DEFAULT 1,
  allow_photos INTEGER DEFAULT 1,
  invite_only INTEGER DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  user_id INTEGER,
  role TEXT DEFAULT 'member',
  joined_at DATETIME DEFAULT (datetime('now','localtime')),
  UNIQUE(group_id, user_id),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS moderator_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  user_id INTEGER,
  can_delete_messages INTEGER DEFAULT 0,
  can_ban_members INTEGER DEFAULT 0,
  can_edit_group INTEGER DEFAULT 0,
  can_manage_invites INTEGER DEFAULT 0,
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  user_id INTEGER,
  content TEXT,
  image_url TEXT DEFAULT '',
  created_at DATETIME DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS group_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  invite_code TEXT UNIQUE,
  created_by INTEGER,
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at DATETIME DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS forum_comment_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER,
  user_id INTEGER,
  UNIQUE(comment_id, user_id),
  FOREIGN KEY(comment_id) REFERENCES forum_comments(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#dc2626',
  is_system INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS forum_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forum_id INTEGER,
  tag_id INTEGER,
  UNIQUE(forum_id, tag_id),
  FOREIGN KEY(forum_id) REFERENCES forums(id),
  FOREIGN KEY(tag_id) REFERENCES tags(id)
);
`);

// image_url kolonu book_pages tablosuna ekle (tablo zaten varsa ALTER TABLE ile)
try { db.exec("ALTER TABLE book_pages ADD COLUMN image_url TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE forums ADD COLUMN custom_tags TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN min_book_pages INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN require_any INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_forums INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_books INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_book_pages INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_forums_vip INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_books_vip INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_book_pages_vip INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_forums_plus INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_books_plus INTEGER DEFAULT -1"); } catch {}
try { db.exec("ALTER TABLE levels ADD COLUMN daily_book_pages_plus INTEGER DEFAULT -1"); } catch {}

const levelCount = db.prepare('SELECT COUNT(*) as c FROM levels').get().c;
if (levelCount === 0) {
  const insertLevel = db.prepare('INSERT INTO levels (name, icon, color, min_forums, min_books, min_comments, order_num) VALUES (?,?,?,?,?,?,?)');
  insertLevel.run('Yeni Üye', 'fas fa-seedling', '#6b7280', 0, 0, 0, 1);
  insertLevel.run('Aktif Üye', 'fas fa-fire', '#f97316', 5, 1, 10, 2);
  insertLevel.run('Katkıcı', 'fas fa-pen', '#3b82f6', 15, 3, 30, 3);
  insertLevel.run('Uzman', 'fas fa-crown', '#8b5cf6', 30, 5, 60, 4);
  insertLevel.run('Efsane', 'fas fa-dragon', '#dc2626', 50, 10, 100, 5);
}

const tagCount = db.prepare('SELECT COUNT(*) as c FROM tags').get().c;
if (tagCount === 0) {
  const insertTag = db.prepare('INSERT INTO tags (name, color, is_system) VALUES (?,?,1)');
  insertTag.run('Genel', '#3b82f6');
  insertTag.run('Soru', '#f97316');
  insertTag.run('Tartışma', '#8b5cf6');
  insertTag.run('Haber', '#dc2626');
  insertTag.run('Yardım', '#10b981');
  insertTag.run('Teknoloji', '#06b6d4');
  insertTag.run('Sanat', '#ec4899');
  insertTag.run('Edebiyat', '#6366f1');
}

const adminPw = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_password');
if (!adminPw) {
  const crypto = require('crypto');
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('admin_password', crypto.createHash('sha256').update('admin123').digest('hex'));
}

const kvkk = db.prepare('SELECT value FROM settings WHERE key=?').get('kvkk_text');
if (!kvkk) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('kvkk_text', `KİŞİSEL VERİLERİN KORUNMASI KANUNU (KVKK) AYDINLATMA METNİ

Demlik Forum olarak, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında kişisel verilerinizin işlenmesine ilişkin sizi bilgilendirmek isteriz.

1. VERİ SORUMLUSU
Demlik Forum platformu, veri sorumlusu sıfatıyla hareket etmektedir.

2. İŞLENEN KİŞİSEL VERİLER
Kullanıcı adı, e-posta adresi, IP adresi, platform içi içerikleriniz (forum gönderileri, kitap sayfaları, grup mesajları) işlenmektedir.

3. KİŞİSEL VERİLERİN İŞLENME AMACI
Kişisel verileriniz; platform hizmetlerinin sunulması, hesap yönetimi, güvenlik ve sahteciliğin önlenmesi amacıyla işlenmektedir.

4. KİŞİSEL VERİLERİN AKTARILMASI
Kişisel verileriniz yasal yükümlülükler dışında üçüncü kişilerle paylaşılmamaktadır.

5. HAKLARINIZ
KVKK'nın 11. maddesi kapsamında; kişisel verilerinize erişim, düzeltme, silme ve işlemenin kısıtlanmasını talep etme haklarına sahipsiniz.

6. İLETİŞİM
Talepleriniz için platform üzerinden iletişime geçebilirsiniz.`);
}

module.exports = db;
