require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // UUID extension
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Kullanıcılar tablosu
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        birth_date DATE,
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'developer', 'admin')),
        avatar_url TEXT,
        bio TEXT,
        show_games BOOLEAN DEFAULT true,
        is_banned BOOLEAN DEFAULT false,
        ban_reason TEXT,
        message_blocked BOOLEAN DEFAULT false,
        friend_blocked BOOLEAN DEFAULT false,
        game_upload_blocked BOOLEAN DEFAULT false,
        last_ip VARCHAR(50),
        last_location TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Geliştirici başvuruları tablosu
    await client.query(`
      CREATE TABLE IF NOT EXISTS developer_applications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        team_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(50) NOT NULL,
        last_name VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL,
        has_previous_games BOOLEAN DEFAULT false,
        previous_game_type VARCHAR(100),
        previous_game_name VARCHAR(100),
        previous_game_description TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        rejection_reason TEXT,
        reviewed_by UUID REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Geliştirici profilleri
    await client.query(`
      CREATE TABLE IF NOT EXISTS developer_profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        team_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        developer_score INTEGER DEFAULT 0,
        payment_unlocked BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Oyun türleri
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_genres (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Varsayılan türleri ekle
    await client.query(`
      INSERT INTO game_genres (name) VALUES
        ('Aksiyon'), ('Macera'), ('RPG'), ('Strateji'), ('Spor'),
        ('Yarış'), ('Simülasyon'), ('Bulmaca'), ('Korku'), ('Indie'),
        ('Çok Oyunculu'), ('MMO'), ('Dövüş'), ('Platform'), ('Shooter')
      ON CONFLICT (name) DO NOTHING
    `);

    // Oyunlar tablosu
    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        developer_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        publisher_name VARCHAR(100),
        genre_id UUID REFERENCES game_genres(id),
        age_rating INTEGER DEFAULT 0,
        price DECIMAL(10,2) DEFAULT 0.00,
        is_free BOOLEAN DEFAULT true,
        logo_url TEXT,
        banner_urls TEXT[] DEFAULT '{}',
        video_urls TEXT[] DEFAULT '{}',
        installer_url TEXT,
        installer_key TEXT,
        download_count INTEGER DEFAULT 0,
        library_count INTEGER DEFAULT 0,
        is_published BOOLEAN DEFAULT false,
        is_hidden BOOLEAN DEFAULT false,
        is_purchase_disabled BOOLEAN DEFAULT false,
        upload_progress INTEGER DEFAULT 0,
        upload_status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Kullanıcı kütüphanesi
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_library (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        game_id UUID REFERENCES games(id) ON DELETE CASCADE,
        is_installed BOOLEAN DEFAULT false,
        install_path TEXT,
        install_date TIMESTAMP,
        last_played TIMESTAMP,
        play_time INTEGER DEFAULT 0,
        added_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, game_id)
      )
    `);

    // Arkadaşlar
    await client.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
        addressee_id UUID REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(requester_id, addressee_id)
      )
    `);

    // Mesajlar
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
        receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_deleted BOOLEAN DEFAULT false,
        delete_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Engellenenler
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(blocker_id, blocked_id)
      )
    `);

    // Aile denetimi
    await client.query(`
      CREATE TABLE IF NOT EXISTS parental_controls (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        is_enabled BOOLEAN DEFAULT false,
        parent_first_name VARCHAR(50),
        parent_last_name VARCHAR(50),
        parent_age INTEGER,
        child_age INTEGER,
        allow_profanity BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Platform ayarları (admin)
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Varsayılan ayarlar
    await client.query(`
      INSERT INTO platform_settings (key, value) VALUES
        ('free_limit_downloads', '500'),
        ('platform_name', 'Demlik Platform'),
        ('maintenance_mode', 'false')
      ON CONFLICT (key) DO NOTHING
    `);

    // Admin kullanıcısı oluştur
    const bcrypt = require('bcryptjs');
    const adminHash = await bcrypt.hash('31622cMs', 12);
    await client.query(`
      INSERT INTO users (username, email, password_hash, role, birth_date)
      VALUES ('oshi', 'oshistans@gmail.com', $1, 'admin', '1990-01-01')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash]);

    await client.query('COMMIT');
    console.log('✅ Veritabanı başarıyla başlatıldı');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Veritabanı başlatma hatası:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
