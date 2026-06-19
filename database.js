const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
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
      created_at TIMESTAMP DEFAULT NOW(),
      last_active TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS levels (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'fas fa-star',
      color TEXT DEFAULT '#dc2626',
      min_forums INTEGER DEFAULT 0,
      min_books INTEGER DEFAULT 0,
      min_comments INTEGER DEFAULT 0,
      min_book_pages INTEGER DEFAULT 0,
      require_any INTEGER DEFAULT 0,
      order_num INTEGER DEFAULT 0,
      daily_forums INTEGER DEFAULT -1,
      daily_books INTEGER DEFAULT -1,
      daily_book_pages INTEGER DEFAULT -1,
      daily_forums_vip INTEGER DEFAULT -1,
      daily_books_vip INTEGER DEFAULT -1,
      daily_book_pages_vip INTEGER DEFAULT -1,
      daily_forums_plus INTEGER DEFAULT -1,
      daily_books_plus INTEGER DEFAULT -1,
      daily_book_pages_plus INTEGER DEFAULT -1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS forums (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      banner_image TEXT DEFAULT '',
      slug TEXT UNIQUE,
      allow_comments INTEGER DEFAULT 1,
      custom_tags TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS forum_views (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      ip TEXT,
      view_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS forum_likes (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      user_id BIGINT,
      UNIQUE(forum_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS forum_comments (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      user_id BIGINT,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(forum_id) REFERENCES forums(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS forum_comment_likes (
      id BIGSERIAL PRIMARY KEY,
      comment_id BIGINT,
      user_id BIGINT,
      UNIQUE(comment_id, user_id),
      FOREIGN KEY(comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#dc2626',
      is_system INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS forum_tags (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      tag_id BIGINT,
      UNIQUE(forum_id, tag_id),
      FOREIGN KEY(forum_id) REFERENCES forums(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS books (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      title TEXT NOT NULL,
      preface TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      slug TEXT UNIQUE,
      page_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS book_chapters (
      id BIGSERIAL PRIMARY KEY,
      book_id BIGINT,
      title TEXT NOT NULL,
      order_num INTEGER DEFAULT 0,
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_pages (
      id BIGSERIAL PRIMARY KEY,
      book_id BIGINT,
      chapter_id BIGINT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      page_num INTEGER DEFAULT 1,
      slug TEXT UNIQUE,
      image_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY(chapter_id) REFERENCES book_chapters(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      owner_id BIGINT,
      type TEXT DEFAULT 'public',
      allow_chat INTEGER DEFAULT 1,
      allow_photos INTEGER DEFAULT 1,
      invite_only INTEGER DEFAULT 0,
      member_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      user_id BIGINT,
      role TEXT DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS moderator_permissions (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      user_id BIGINT,
      can_delete_messages INTEGER DEFAULT 0,
      can_ban_members INTEGER DEFAULT 0,
      can_edit_group INTEGER DEFAULT 0,
      can_manage_invites INTEGER DEFAULT 0,
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_messages (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      user_id BIGINT,
      content TEXT,
      image_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS group_invites (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      invite_code TEXT UNIQUE,
      created_by BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id BIGSERIAL PRIMARY KEY,
      actor TEXT,
      action TEXT,
      target TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT NOT NULL,
      addressee_id BIGINT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id),
      FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(addressee_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id BIGSERIAL PRIMARY KEY,
      blocker_id BIGINT NOT NULL,
      blocked_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(blocker_id, blocked_id),
      FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dm_conversations (
      id BIGSERIAL PRIMARY KEY,
      user1_id BIGINT NOT NULL,
      user2_id BIGINT NOT NULL,
      hidden_by_user1 INTEGER DEFAULT 0,
      hidden_by_user2 INTEGER DEFAULT 0,
      hidden_pass_user1 TEXT DEFAULT '',
      hidden_pass_user2 TEXT DEFAULT '',
      last_message_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user1_id, user2_id),
      FOREIGN KEY(user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(user2_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dm_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL,
      sender_id BIGINT NOT NULL,
      content TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      shared_forum_id BIGINT,
      reply_to_id BIGINT,
      deleted_by_sender INTEGER DEFAULT 0,
      deleted_by_receiver INTEGER DEFAULT 0,
      deleted_for_all INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(shared_forum_id) REFERENCES forums(id) ON DELETE SET NULL,
      FOREIGN KEY(reply_to_id) REFERENCES dm_messages(id) ON DELETE SET NULL
    );

    ALTER TABLE forums ADD COLUMN IF NOT EXISTS allow_sharing INTEGER DEFAULT 1;
    ALTER TABLE forums ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
    ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS read_until_user1 BIGINT DEFAULT 0;
    ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS read_until_user2 BIGINT DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_since TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_id TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_token TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_refresh TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_show INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_expires BIGINT DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
  `);

  // Seed default levels
  const { rows: lvRows } = await query('SELECT COUNT(*) as c FROM levels');
  if (parseInt(lvRows[0].c) === 0) {
    const ins = 'INSERT INTO levels (name,icon,color,min_forums,min_books,min_comments,order_num) VALUES ($1,$2,$3,$4,$5,$6,$7)';
    await query(ins, ['Yeni Üye',   'fas fa-seedling', '#6b7280', 0,  0,  0,   1]);
    await query(ins, ['Aktif Üye',  'fas fa-fire',     '#f97316', 5,  1,  10,  2]);
    await query(ins, ['Katkıcı',    'fas fa-pen',      '#3b82f6', 15, 3,  30,  3]);
    await query(ins, ['Uzman',      'fas fa-crown',    '#8b5cf6', 30, 5,  60,  4]);
    await query(ins, ['Efsane',     'fas fa-dragon',   '#dc2626', 50, 10, 100, 5]);
  }

  // Seed default tags
  const { rows: tagRows } = await query('SELECT COUNT(*) as c FROM tags');
  if (parseInt(tagRows[0].c) === 0) {
    const ins = 'INSERT INTO tags (name,color,is_system) VALUES ($1,$2,1)';
    await query(ins, ['Genel',     '#3b82f6']);
    await query(ins, ['Soru',      '#f97316']);
    await query(ins, ['Tartışma',  '#8b5cf6']);
    await query(ins, ['Haber',     '#dc2626']);
    await query(ins, ['Yardım',    '#10b981']);
    await query(ins, ['Teknoloji', '#06b6d4']);
    await query(ins, ['Sanat',     '#ec4899']);
    await query(ins, ['Edebiyat',  '#6366f1']);
  }

  // Seed admin password
  const { rows: pwRows } = await query("SELECT value FROM settings WHERE key='admin_password'");
  if (pwRows.length === 0) {
    const hash = crypto.createHash('sha256').update('admin123').digest('hex');
    await query('INSERT INTO settings (key,value) VALUES ($1,$2)', ['admin_password', hash]);
  }

  // Seed KVKK
  const { rows: kvkkRows } = await query("SELECT value FROM settings WHERE key='kvkk_text'");
  if (kvkkRows.length === 0) {
    await query('INSERT INTO settings (key,value) VALUES ($1,$2)', ['kvkk_text', `KİŞİSEL VERİLERİN KORUNMASI KANUNU (KVKK) AYDINLATMA METNİ

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
Talepleriniz için platform üzerinden iletişime geçebilirsiniz.`]);
  }

  console.log('PostgreSQL bağlantısı ve tablolar hazır.');
}

module.exports = { query, pool, initDb };
