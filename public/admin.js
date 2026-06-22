// ===== DEMLIK ADMIN PANEL =====
let adminToken = sessionStorage.getItem('admin_token') || '';
let currentSection = 'dashboard';

function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }

function toast(msg, type = 'success') {
  const c = $('#toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(dt) {
  if (!dt) return '-';
  const now = new Date(), d = new Date(dt);
  const sec = Math.floor((now - d) / 1000);
  if (sec < 60) return 'az önce';
  if (sec < 3600) return Math.floor(sec / 60) + ' dk önce';
  if (sec < 86400) return Math.floor(sec / 3600) + ' sa önce';
  return d.toLocaleDateString('tr-TR');
}

function formatDate(dt) {
  if (!dt) return '-';
  return new Date(dt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function adminApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken, ...(options.headers || {}) };
  const res = await fetch('/api/admin' + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

function showModal(title, bodyHTML) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#modal-overlay').classList.remove('hidden');
}
function hideModal() { $('#modal-overlay').classList.add('hidden'); }

$('#modal-close').addEventListener('click', hideModal);
$('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) hideModal(); });

// ===== AUTH =====
if (adminToken) showPanel();
$('#admin-login-btn').addEventListener('click', tryLogin);
$('#admin-pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

async function tryLogin() {
  const pw = $('#admin-pw-input').value;
  if (!pw) return;
  const msgBuf = new TextEncoder().encode(pw);
  const hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
  const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
  adminToken = hashHex;
  sessionStorage.setItem('admin_token', adminToken);
  try {
    await adminApi('/settings');
    showPanel();
  } catch {
    adminToken = ''; sessionStorage.removeItem('admin_token');
    $('#admin-login-err').textContent = 'Hatalı şifre';
  }
}

function showPanel() {
  $('#login-screen').style.display = 'none';
  $('#admin-panel').classList.add('visible');
  loadTopbarStats();
  setupNav();
  loadSection('dashboard');
}

$('#admin-logout-btn').addEventListener('click', () => {
  adminToken = ''; sessionStorage.removeItem('admin_token');
  location.reload();
});

function setupNav() {
  $$('.adm-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.adm-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      loadSection(item.dataset.section);
    });
  });
}

async function loadTopbarStats() {
  try {
    const users = await adminApi('/users');
    const forums = await adminApi('/forums');
    const el = $('#adm-topbar-stats');
    if (el) el.innerHTML = `
      <span><i class="fas fa-users" style="color:#5865F2;margin-right:4px"></i>${users.length} üye</span>
      <span><i class="fas fa-comments" style="color:#dc2626;margin-right:4px"></i>${forums.length} konu</span>`;
  } catch {}
}

function loadSection(section) {
  currentSection = section;
  const main = $('#admin-main');
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  const map = {
    dashboard: renderDashboard, users: renderUsers,
    forums: renderForums, books: renderBooks, groups: renderGroups, artists: renderArtists,
    levels: renderLevels, tags: renderTags, logs: renderLogs,
    settings: renderSettings, messages: renderAdminMessages,
    announcements: renderAnnouncements,
    songs: renderAdminSongs, 'artist-apps': renderArtistApps
  };
  if (map[section]) map[section](main);
}

// ===== DASHBOARD =====
async function renderDashboard(main) {
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  
  // Her isteği ayrı ayrı çek, biri patlarsa diğerleri etkilenmesin
  const [users, forums, books, groups, logs] = await Promise.all([
    adminApi('/users').catch(() => []),
    adminApi('/forums').catch(() => []),
    adminApi('/books').catch(() => []),
    adminApi('/groups').catch(() => []),
    adminApi('/logs?limit=5').catch(() => []),
  ]);

  const banned = Array.isArray(users) ? users.filter(u => u.banned).length : 0;
  const admins = Array.isArray(users) ? users.filter(u => u.is_admin).length : 0;

  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-chart-line"></i></div> Dashboard</div>
    </div>
    <div class="adm-stats">
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#5865F2"></div>
        <div class="adm-stat-icon" style="color:#7c87f5"><i class="fas fa-users"></i></div>
        <div class="adm-stat-num">${Array.isArray(users) ? users.length : 0}</div>
        <div class="adm-stat-label">Toplam Üye</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#dc2626"></div>
        <div class="adm-stat-icon" style="color:#ef4444"><i class="fas fa-comments"></i></div>
        <div class="adm-stat-num">${Array.isArray(forums) ? forums.length : 0}</div>
        <div class="adm-stat-label">Toplam Konu</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#22c55e"></div>
        <div class="adm-stat-icon" style="color:#4ade80"><i class="fas fa-book"></i></div>
        <div class="adm-stat-num">${Array.isArray(books) ? books.length : 0}</div>
        <div class="adm-stat-label">Toplam Kitap</div>
      </div>
      <div class="adm-stat-card">
        <div class="adm-stat-glow" style="background:#f97316"></div>
        <div class="adm-stat-icon" style="color:#fb923c"><i class="fas fa-users-cog"></i></div>
        <div class="adm-stat-num">${Array.isArray(groups) ? groups.length : 0}</div>
        <div class="adm-stat-label">Toplam Grup</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="card">
        <div class="card-header"><span><i class="fas fa-shield" style="color:#5865F2;margin-right:8px"></i>Sistem Özeti</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg4);border-radius:8px">
            <span style="font-size:13px">Banlı Üye</span><span class="badge badge-red">${banned}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg4);border-radius:8px">
            <span style="font-size:13px">Admin Sayısı</span><span class="badge badge-blue">${admins}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg4);border-radius:8px">
            <span style="font-size:13px">Gruplar</span><span class="badge badge-gray">${Array.isArray(groups) ? groups.length : 0}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-history" style="color:#f97316;margin-right:8px"></i>Son İşlemler</span></div>
        <div class="card-body" style="padding:8px">
          ${Array.isArray(logs) && logs.length ? logs.map(l => `
            <div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px">
              <span style="color:var(--red2);font-weight:600">${escHtml(l.actor)}</span>
              <span style="color:var(--text2);margin:0 4px">→</span>
              <span>${escHtml(l.action)}</span>
              <span style="float:right;color:var(--text3)">${timeAgo(l.created_at)}</span>
            </div>`).join('') : '<div style="padding:20px;text-align:center;color:var(--text3)">Henüz log yok</div>'}
        </div>
      </div>
    </div>`;
}

// ===== USERS =====
async function renderUsers(main) {
  let users = [];
  try { users = await adminApi('/users'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users"></i></div> Kullanıcılar</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users"></i></div> Kullanıcılar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${users.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="user-search" placeholder="Kullanıcı, e-posta, IP ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Kullanıcı</th><th>E-posta</th><th>Seviye</th><th>İstatistik</th><th>IP</th><th>Kayıt</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="users-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderUsersTable(users);
  $('#user-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderUsersTable(users.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.ip||'').includes(q)));
  });
}

function renderUsersTable(users) {
  const tbody = $('#users-tbody'); if (!tbody) return;
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px">Kullanıcı bulunamadı</td></tr>'; return; }
  tbody.innerHTML = users.map(u => `<tr>
    <td style="color:var(--text3);font-size:11px">#${u.id}</td>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        ${u.avatar ? `<img src="${escHtml(u.avatar)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />` : `<div style="width:28px;height:28px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:11px"><i class="fas fa-user"></i></div>`}
        <div>
          <div style="font-weight:600;font-size:13px">${escHtml(u.username)}</div>
          <div style="font-size:10px;color:var(--text3)">${u.is_admin ? '<span style="color:#7c87f5"><i class="fas fa-shield"></i> Admin</span>' : ''} ${u.is_vip ? '<span style="color:#facc15">VIP</span>' : ''} ${u.is_plus ? '<span style="color:#a855f7">Plus</span>' : ''}</div>
        </div>
      </div>
    </td>
    <td style="font-size:12px;color:var(--text2)">${escHtml(u.email)}</td>
    <td><span class="badge badge-gray">${u.level_id||1}</span></td>
    <td style="font-size:12px;color:var(--text2)">
      <span title="Forum"><i class="fas fa-comments" style="color:var(--red2)"></i> ${u.forum_count}</span>
      <span title="Kitap" style="margin:0 6px"><i class="fas fa-book" style="color:#4ade80"></i> ${u.book_count}</span>
      <span title="Yorum"><i class="fas fa-comment" style="color:#7c87f5"></i> ${u.comment_count}</span>
    </td>
    <td style="font-size:11px;color:var(--text3)">${escHtml(u.ip||'-')}</td>
    <td style="font-size:11px">${timeAgo(u.created_at)}</td>
    <td>${u.banned ? '<span class="badge badge-red"><i class="fas fa-ban"></i> Banlı</span>' : '<span class="badge badge-green"><i class="fas fa-check"></i> Aktif</span>'}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-outline btn-xs edit-user-btn" data-id="${u.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
        <button class="btn btn-blue btn-xs perm-user-btn" data-id="${u.id}" title="Yetkiler"><i class="fas fa-shield"></i></button>
        ${u.banned
          ? `<button class="btn btn-green btn-xs unban-user-btn" data-id="${u.id}" title="Ban Kaldır"><i class="fas fa-unlock"></i></button>`
          : `<button class="btn btn-danger btn-xs ban-user-btn" data-id="${u.id}" title="Banla"><i class="fas fa-ban"></i></button>`}
        <button class="btn btn-danger btn-xs del-user-btn" data-id="${u.id}" title="Sil"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.edit-user-btn');
    const ban = e.target.closest('.ban-user-btn');
    const unban = e.target.closest('.unban-user-btn');
    const del = e.target.closest('.del-user-btn');
    const perm = e.target.closest('.perm-user-btn');
    if (edit) { const u = users.find(x => x.id == edit.dataset.id); if (u) showEditUserModal(u); }
    if (ban) showBanModal(ban.dataset.id);
    if (unban) { if (!confirm('Ban kaldırılsın mı?')) return; try { await adminApi('/user/'+unban.dataset.id+'/unban',{method:'POST'}); toast('Ban kaldırıldı'); loadSection('users'); } catch(e){toast(e.message,'error');} }
    if (del) { if (!confirm('Kullanıcı kalıcı silinsin mi?')) return; try { await adminApi('/user/'+del.dataset.id,{method:'DELETE'}); toast('Silindi'); loadSection('users'); } catch(e){toast(e.message,'error');} }
    if (perm) { const u = users.find(x => x.id == perm.dataset.id); if (u) showPermModal(u); }
  });
}

function showEditUserModal(user) {
  showModal('Kullanıcı Düzenle — ' + user.username, `
    <div class="form-row">
      <div class="form-group"><label>Kullanıcı Adı</label><input id="eu-username" value="${escHtml(user.username)}" /></div>
      <div class="form-group"><label>E-posta</label><input id="eu-email" type="email" value="${escHtml(user.email)}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Yeni Şifre (boş=değişme)</label><input id="eu-pw" type="password" placeholder="••••••" /></div>
      <div class="form-group"><label>Seviye ID</label><input id="eu-level" type="number" value="${user.level_id||1}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Ünvan</label><input id="eu-title" value="${escHtml(user.title||'')}" placeholder="Örn: Yazılımcı" /></div>
      <div class="form-group"><label>İsim Rengi</label><input id="eu-color" type="color" value="${user.name_color||'#f5f5f5'}" style="height:38px;cursor:pointer" /></div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <label class="checkbox-label"><input type="checkbox" id="eu-vip" ${user.is_vip?'checked':''} /> VIP</label>
      <label class="checkbox-label"><input type="checkbox" id="eu-plus" ${user.is_plus?'checked':''} /> Plus</label>
      <label class="checkbox-label"><input type="checkbox" id="eu-admin" ${user.is_admin?'checked':''} /> <i class="fas fa-shield" style="color:#7c87f5"></i> Admin Yetkilisi</label>
    </div>
    <button class="btn btn-primary" id="eu-submit" style="width:100%;justify-content:center">Kaydet</button>
    <div id="eu-error" class="form-error mt-4"></div>
  `);
  $('#eu-submit').addEventListener('click', async () => {
    const wasAdmin = !!user.is_admin, isAdmin = $('#eu-admin').checked;
    const body = { username: $('#eu-username').value.trim(), email: $('#eu-email').value.trim(),
      is_vip: $('#eu-vip').checked, is_plus: $('#eu-plus').checked,
      name_color: $('#eu-color').value, level_id: parseInt($('#eu-level').value)||1,
      title: $('#eu-title').value.trim() };
    const pw = $('#eu-pw').value; if (pw) body.password = pw;
    try {
      await adminApi('/user/'+user.id, {method:'PUT', body:JSON.stringify(body)});
      if (isAdmin !== wasAdmin) await adminApi('/user/'+user.id+'/set-admin', {method:'POST', body:JSON.stringify({is_admin:isAdmin})});
      toast('Kullanıcı güncellendi'); hideModal(); loadSection('users');
    } catch (e) { $('#eu-error').textContent = e.message; }
  });
}

function showBanModal(userId) {
  showModal('Kullanıcıyı Banla', `
    <div class="form-group"><label>Ban Türü</label>
      <select id="ban-type">
        <option value="soft">Soft Ban (hesap kilitli)</option>
        <option value="ip">IP Ban (IP engeli)</option>
      </select>
    </div>
    <button class="btn btn-primary" id="ban-submit" style="width:100%;justify-content:center"><i class="fas fa-ban"></i> Banla</button>
    <div id="ban-error" class="form-error mt-4"></div>
  `);
  $('#ban-submit').addEventListener('click', async () => {
    try { await adminApi('/user/'+userId+'/ban',{method:'POST',body:JSON.stringify({ban_type:$('#ban-type').value})}); toast('Banlandı'); hideModal(); loadSection('users'); }
    catch (e) { $('#ban-error').textContent = e.message; }
  });
}

async function showPermModal(user) {
  let perms = null;
  try { perms = await adminApi('/permissions/' + user.id); } catch {}
  const p = perms || {};
  const isSuperAdmin = !perms && user.is_admin;
  const permDefs = [
    { key:'can_view_users', label:'Üyeleri Görüntüle', desc:'Üye listesini görebilir', icon:'fas fa-users' },
    { key:'can_ban_users', label:'Üye Yasakla/Kaldır', desc:'Ban atabilir, kaldırabilir', icon:'fas fa-ban' },
    { key:'can_delete_content', label:'İçerik Sil', desc:'Forum, kitap, yorum silebilir', icon:'fas fa-trash' },
    { key:'can_edit_content', label:'İçerik Düzenle', desc:'Forum ve kitap düzenleyebilir', icon:'fas fa-edit' },
    { key:'can_manage_levels', label:'Seviyeleri Yönet', desc:'Seviye ekle/düzenle/sil', icon:'fas fa-layer-group' },
    { key:'can_manage_tags', label:'Etiketleri Yönet', desc:'Etiket ekle/düzenle/sil', icon:'fas fa-tags' },
    { key:'can_manage_announcements', label:'Duyuru Yönet', desc:'Duyuru oluştur/düzenle/sil', icon:'fas fa-bullhorn' },
    { key:'can_view_logs', label:'Log Görüntüle', desc:'Sistem loglarını okuyabilir', icon:'fas fa-history' },
    { key:'can_manage_settings', label:'Site Ayarları', desc:'Site ayarlarını değiştirebilir', icon:'fas fa-cog' },
    { key:'can_manage_admins', label:'Admin Yönet', desc:'Admin atayabilir/alabilir', icon:'fas fa-shield' },
  ];
  showModal(`Yetki Düzenleme — ${user.username}`, `
    ${isSuperAdmin ? `
    <div style="margin-bottom:16px;padding:12px 14px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:10px;font-size:12px;color:#facc15">
      <i class="fas fa-crown" style="margin-right:6px"></i>
      <strong>Bu kullanıcı şu an SÜPERADMİN.</strong> Yetki kaydı yokken tüm yetkilere sahiptir.
      Aşağıdan kısıtlı yetki kaydı oluşturabilirsin — bu durumda sadece seçtiğin yetkiler geçerli olur.
    </div>` : `
    <div style="margin-bottom:16px;padding:10px 14px;background:rgba(88,101,242,0.1);border:1px solid rgba(88,101,242,0.2);border-radius:10px;font-size:12px">
      <i class="fas fa-info-circle" style="color:#7c87f5;margin-right:6px"></i>
      Kaydet'e basınca kullanıcıya <strong>is_admin=1</strong> atanır ve sadece işaretli yetkiler verilir.
      Tüm yetkiler verirsen süperadmin gibi çalışır.
    </div>`}
    <div class="perm-grid" id="perm-grid">
      ${permDefs.map(d => `
        <div class="perm-item">
          <input type="checkbox" id="perm-${d.key}" ${(isSuperAdmin || p[d.key]) ? 'checked' : ''} />
          <div>
            <span class="perm-label"><i class="${d.icon}" style="margin-right:5px;color:var(--red2)"></i>${d.label}</span>
            <span class="perm-desc">${d.desc}</span>
          </div>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" id="perm-all-btn" style="flex:1;justify-content:center"><i class="fas fa-check-double"></i> Tümünü Ver</button>
      <button class="btn btn-outline" id="perm-none-btn" style="flex:1;justify-content:center"><i class="fas fa-times"></i> Tümünü Al</button>
    </div>
    <button class="btn btn-blue" id="perm-save-btn" style="width:100%;justify-content:center;margin-top:8px"><i class="fas fa-save"></i> Kaydet &amp; Adminliği Etkinleştir</button>
    <div id="perm-error" class="form-error mt-4"></div>
  `);
  $('#perm-all-btn').addEventListener('click', () => permDefs.forEach(d => { const el=$('#perm-'+d.key); if(el) el.checked=true; }));
  $('#perm-none-btn').addEventListener('click', () => permDefs.forEach(d => { const el=$('#perm-'+d.key); if(el) el.checked=false; }));
  $('#perm-save-btn').addEventListener('click', async () => {
    const body = {}; permDefs.forEach(d => { body[d.key] = $('#perm-'+d.key)?.checked ? 1 : 0; });
    try { await adminApi('/permissions/'+user.id, {method:'POST', body:JSON.stringify(body)}); toast('Yetkiler kaydedildi'); hideModal(); }
    catch (e) { $('#perm-error').textContent = e.message; }
  });
}

// ===== FORUMS =====
async function renderForums(main) {
  let forums = [];
  try { forums = await adminApi('/forums'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-comments"></i></div> Konular</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-comments"></i></div> Konular <span style="font-size:13px;font-weight:400;color:var(--text2)">(${forums.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="forum-search" placeholder="Başlık veya kullanıcı ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Başlık</th><th>Yazar</th><th>Görüntülenme</th><th>Beğeni</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="forums-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const renderTable = (list) => {
    const tbody = $('#forums-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:32px">Konu bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(f => `<tr>
      <td style="color:var(--text3);font-size:12px">#${f.id}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(f.title)}">${escHtml(f.title)}</td>
      <td><span style="color:var(--blue2)">${escHtml(f.username||'—')}</span></td>
      <td style="font-size:12px;color:var(--text2)">${f.views||0} <i class="fas fa-eye" style="font-size:10px"></i></td>
      <td style="font-size:12px;color:var(--text2)">${f.like_count||0} <i class="fas fa-heart" style="font-size:10px;color:#ef4444"></i></td>
      <td style="color:var(--text3);font-size:12px">${timeAgo(f.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-xs edit-forum-btn" data-id="${f.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-xs del-forum-btn" data-id="${f.id}"><i class="fas fa-trash"></i> Sil</button>
        </div>
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('.edit-forum-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = forums.find(x => x.id == btn.dataset.id);
        if (!f) return;
        showModal(`✏️ Konu Düzenle — #${f.id}`, `
          <div class="form-group"><label>Başlık</label><input id="ef-title" value="${escHtml(f.title)}" /></div>
          <div class="form-row">
            <div class="form-group"><label>Görüntülenme</label><input id="ef-views" type="number" value="${f.views||0}" /></div>
          </div>
          <div id="ef-err" class="form-error"></div>
          <button class="btn btn-primary" id="ef-save" style="width:100%;justify-content:center;margin-top:12px"><i class="fas fa-save"></i> Kaydet</button>
        `);
        $('#ef-save').addEventListener('click', async () => {
          const btn2 = $('#ef-save'); const err = $('#ef-err');
          btn2.disabled = true; btn2.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>';
          try {
            const body = {
              title: $('#ef-title').value.trim() || f.title,
              views: parseInt($('#ef-views').value) || 0
            };
            await adminApi('/forum/'+f.id, { method:'PUT', body:JSON.stringify(body) });
            toast('Konu güncellendi');
            const idx = forums.findIndex(x => x.id == f.id);
            if (idx !== -1) { forums[idx] = { ...forums[idx], ...body }; }
            hideModal(); renderTable(forums);
          } catch(e) { err.textContent = e.message; btn2.disabled=false; btn2.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
        });
      });
    });
    tbody.querySelectorAll('.del-forum-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu konuyu silmek istediğine emin misin?')) return;
        try { await adminApi('/forum/'+btn.dataset.id, {method:'DELETE'}); toast('Konu silindi'); forums = forums.filter(f=>f.id!=btn.dataset.id); renderTable(forums); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  renderTable(forums);
  $('#forum-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(forums.filter(f => f.title.toLowerCase().includes(q) || (f.username||'').toLowerCase().includes(q)));
  });
}

// ===== BOOKS =====
async function renderBooks(main) {
  let books = [];
  try { books = await adminApi('/books'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-book"></i></div> Kitaplar</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-book"></i></div> Kitaplar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${books.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="book-search" placeholder="Başlık veya kullanıcı ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Başlık</th><th>Yazar</th><th>Sayfa</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="books-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const renderTable = (list) => {
    const tbody = $('#books-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:32px">Kitap bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(b => `<tr>
      <td style="color:var(--text3);font-size:12px">#${b.id}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(b.title)}">${escHtml(b.title)}</td>
      <td><span style="color:var(--blue2)">${escHtml(b.username||'—')}</span></td>
      <td style="color:var(--text3);font-size:12px">${b.page_count||0}</td>
      <td style="color:var(--text3);font-size:12px">${timeAgo(b.created_at)}</td>
      <td><button class="btn btn-danger btn-xs del-book-btn" data-id="${b.id}"><i class="fas fa-trash"></i> Sil</button></td>
    </tr>`).join('');
    tbody.querySelectorAll('.del-book-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu kitabı silmek istediğine emin misin?')) return;
        try { await adminApi('/book/'+btn.dataset.id, {method:'DELETE'}); toast('Kitap silindi'); books = books.filter(b=>b.id!=btn.dataset.id); renderTable(books); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  renderTable(books);
  $('#book-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(books.filter(b => b.title.toLowerCase().includes(q) || (b.username||'').toLowerCase().includes(q)));
  });
}

// ===== GROUPS =====
async function renderGroups(main) {
  let groups = [];
  try { groups = await adminApi('/groups'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users-cog"></i></div> Gruplar</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-users-cog"></i></div> Gruplar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${groups.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="group-search" placeholder="Grup adı veya sahibi ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Grup Adı</th><th>Sahibi</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="groups-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const renderTable = (list) => {
    const tbody = $('#groups-tbody'); if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:32px">Grup bulunamadı</td></tr>'; return; }
    tbody.innerHTML = list.map(g => `<tr>
      <td style="color:var(--text3);font-size:12px">#${g.id}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(g.name)}">${escHtml(g.name)}</td>
      <td><span style="color:var(--blue2)">${escHtml(g.owner_name||'—')}</span></td>
      <td style="color:var(--text3);font-size:12px">${timeAgo(g.created_at)}</td>
      <td><button class="btn btn-danger btn-xs del-group-btn" data-id="${g.id}"><i class="fas fa-trash"></i> Sil</button></td>
    </tr>`).join('');
    tbody.querySelectorAll('.del-group-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu grubu silmek istediğine emin misin?')) return;
        try { await adminApi('/group/'+btn.dataset.id, {method:'DELETE'}); toast('Grup silindi'); groups = groups.filter(g=>g.id!=btn.dataset.id); renderTable(groups); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  renderTable(groups);
  $('#group-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(groups.filter(g => g.name.toLowerCase().includes(q) || (g.owner_name||'').toLowerCase().includes(q)));
  });
}

// ===== ARTISTS =====
async function renderArtists(main) {
  let artists = [];
  try { artists = await adminApi('/artists'); } catch (e) {
    main.innerHTML = `<div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-microphone-alt"></i></div> Artistler</div></div><div class="card"><div class="card-body" style="color:var(--red2);padding:20px"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div></div>`;
    return;
  }

  const renderTable = (list) => {
    const tbody = $('#artists-tbody'); if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:32px"><i class="fas fa-microphone-slash" style="font-size:28px;margin-bottom:8px;display:block"></i>Artist bulunamadı</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(a => `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${a.avatar ? `<img src="${escHtml(a.avatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--border-red)" />`
            : `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--red),#7f1d1d);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px"><i class="fas fa-microphone-alt"></i></div>`}
          <div>
            <div style="font-weight:600;font-size:13px">${escHtml(a.username)}</div>
            ${a.artist_display_name ? `<div style="font-size:11px;color:var(--text3)">${escHtml(a.artist_display_name)}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(a.artist_genre||'—')}</td>
      <td>
        <div style="font-size:13px;font-weight:600;color:var(--purple)">${a.song_count||0}</div>
        <div style="font-size:10px;color:var(--text3)">${Number(a.total_plays||0).toLocaleString('tr-TR')} dinlenme</div>
      </td>
      <td style="font-size:11px;color:var(--text3)">${a.artist_since ? formatDate(a.artist_since) : '—'}</td>
      <td>${a.banned ? '<span class="badge badge-red"><i class="fas fa-ban"></i> Banlı</span>' : '<span class="badge badge-green"><i class="fas fa-check"></i> Aktif</span>'}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-blue btn-xs view-artist-songs-btn" data-id="${a.id}" data-name="${escHtml(a.username)}" title="Şarkılarını Gör"><i class="fas fa-music"></i> Şarkılar</button>
          <button class="btn btn-outline btn-xs edit-artist-btn" data-id="${a.id}" title="Bilgileri Düzenle"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-xs revoke-artist-btn" data-id="${a.id}" data-name="${escHtml(a.username)}" title="Artist Rozetini Kaldır"><i class="fas fa-microphone-slash"></i></button>
        </div>
      </td>
    </tr>`).join('');

    tbody.querySelectorAll('.view-artist-songs-btn').forEach(btn => {
      btn.addEventListener('click', () => showArtistSongsModal(btn.dataset.id, btn.dataset.name));
    });
    tbody.querySelectorAll('.edit-artist-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = artists.find(x => x.id == btn.dataset.id);
        if (a) showEditArtistModal(a, artists, renderTable);
      });
    });
    tbody.querySelectorAll('.revoke-artist-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`${btn.dataset.name} kullanıcısının artist rozeti kaldırılsın mı?`)) return;
        try {
          await adminApi('/artists/'+btn.dataset.id, { method:'PUT', body:JSON.stringify({ is_artist: 0 }) });
          toast('Artist rozeti kaldırıldı');
          artists = artists.filter(a => a.id != btn.dataset.id);
          renderTable(artists);
        } catch(e) { toast(e.message, 'error'); }
      });
    });
  };

  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title">
        <div class="icon-pill"><i class="fas fa-microphone-alt"></i></div>
        Artistler
        <span style="font-size:13px;font-weight:400;color:var(--text2)">(${artists.length})</span>
      </div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="artist-search" placeholder="Artist veya kullanıcı ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Artist</th><th>Tür</th><th>Şarkılar</th><th>Artist'ten beri</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="artists-tbody"></tbody>
        </table>
      </div>
    </div>`;

  renderTable(artists);
  $('#artist-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTable(artists.filter(a =>
      a.username.toLowerCase().includes(q) ||
      (a.artist_display_name||'').toLowerCase().includes(q) ||
      (a.artist_genre||'').toLowerCase().includes(q)
    ));
  });
}

async function showArtistSongsModal(artistId, artistName) {
  showModal(`🎵 ${artistName} — Şarkılar`, `<div class="loading-center" style="padding:40px"><div class="spinner"></div></div>`);
  let songs = [];
  try { songs = await adminApi('/artists/'+artistId+'/songs'); } catch(e) {
    $('#modal-body').innerHTML = `<div style="color:var(--red2);padding:20px">${escHtml(e.message)}</div>`; return;
  }

  const renderSongs = (list) => {
    const wrap = $('#artist-songs-wrap'); if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = '<div style="text-align:center;color:var(--text3);padding:32px"><i class="fas fa-music" style="font-size:28px;margin-bottom:8px;display:block"></i>Şarkı yok</div>';
      return;
    }
    wrap.innerHTML = list.map(s => {
      const isBanned = s.status === 'suspended';
      const banExpired = s.ban_until && new Date(s.ban_until) < new Date();
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        ${s.cover_url
          ? `<img src="${escHtml(s.cover_url)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0" />`
          : `<div style="width:44px;height:44px;border-radius:8px;background:var(--bg4);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text3)"><i class="fas fa-music"></i></div>`}
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.title)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">
            ${escHtml(s.artist_name)}${s.genre ? ` · ${escHtml(s.genre)}` : ''} · ${s.play_count} dinlenme
          </div>
          ${isBanned ? `<div style="font-size:10px;color:var(--red2);margin-top:2px">
            <i class="fas fa-ban"></i> ${escHtml(s.ban_reason||'Ban')}
            ${s.ban_until && !banExpired
              ? ` · <span style="color:var(--orange)">${new Date(s.ban_until).toLocaleDateString('tr-TR')} tarihine kadar</span>`
              : s.ban_until ? ' <span style="color:var(--text3)">(süresi doldu)</span>' : ' <span style="color:var(--text3)">(kalıcı)</span>'}
          </div>` : ''}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          ${isBanned && !banExpired
            ? `<button class="btn btn-green btn-xs song-unban-btn" data-id="${s.id}"><i class="fas fa-unlock"></i> Banı Kaldır</button>`
            : `<button class="btn btn-danger btn-xs song-ban-btn" data-id="${s.id}" data-title="${escHtml(s.title)}"><i class="fas fa-ban"></i> Ban</button>`}
          <span style="font-size:10px;color:var(--text3)">${timeAgo(s.created_at)}</span>
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('.song-ban-btn').forEach(btn => {
      btn.addEventListener('click', () => showSongBanModal(btn.dataset.id, btn.dataset.title, songs, renderSongs));
    });
    wrap.querySelectorAll('.song-unban-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Banı kaldırmak istediğine emin misin?')) return;
        try {
          await adminApi('/songs/'+btn.dataset.id+'/unban', { method:'POST' });
          toast('Ban kaldırıldı');
          const s = songs.find(x => x.id == btn.dataset.id);
          if (s) { s.status = 'active'; s.ban_reason = ''; s.ban_until = null; }
          renderSongs(songs);
        } catch(e) { toast(e.message, 'error'); }
      });
    });
  };

  $('#modal-body').innerHTML = `
    <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;color:var(--text2)">${songs.length} şarkı</span>
      <div class="adm-search" style="max-width:200px"><i class="fas fa-search"></i><input id="asong-search" type="text" placeholder="Ara..." style="min-width:0" /></div>
    </div>
    <div id="artist-songs-wrap"></div>`;
  renderSongs(songs);

  $('#asong-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderSongs(songs.filter(s => s.title.toLowerCase().includes(q) || s.artist_name.toLowerCase().includes(q)));
  });
}

function showSongBanModal(songId, songTitle, songs, renderSongs) {
  showModal(`🚫 Şarkı Banla — ${songTitle}`, `
    <div style="background:rgba(220,38,38,0.07);border:1px solid var(--border-red);border-radius:10px;padding:14px;margin-bottom:16px;font-size:12px;color:var(--text2)">
      <i class="fas fa-info-circle" style="color:var(--red2);margin-right:6px"></i>
      Ban uygulanan şarkı dinleyicilere gösterilmez. Süreli ban bitince otomatik aktife döner.
    </div>
    <div class="form-group">
      <label>Ban Sebebi</label>
      <input id="ban-reason" placeholder="Telif ihlali, uygunsuz içerik..." />
    </div>
    <div class="form-group">
      <label>Ban Süresi</label>
      <select id="ban-duration">
        <option value="0">Kalıcı (elle kaldırana kadar)</option>
        <option value="1">1 Gün</option>
        <option value="3">3 Gün</option>
        <option value="7">7 Gün</option>
        <option value="14">14 Gün</option>
        <option value="30">30 Gün</option>
        <option value="custom">Özel Gün Sayısı...</option>
      </select>
    </div>
    <div id="custom-days-wrap" class="form-group hidden">
      <label>Gün Sayısı</label>
      <input id="custom-days" type="number" min="1" placeholder="Örn: 60" />
    </div>
    <div id="ban-preview" style="font-size:12px;margin-bottom:16px;padding:8px 12px;border-radius:8px;background:var(--bg4)"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-outline" id="ban-cancel-btn" style="flex:1;justify-content:center">İptal</button>
      <button class="btn btn-primary" id="ban-confirm-btn" style="flex:1;justify-content:center"><i class="fas fa-ban"></i> Banı Uygula</button>
    </div>
    <div id="ban-err" class="form-error mt-4"></div>
  `);

  const updatePreview = () => {
    const d = $('#ban-duration').value;
    const days = d === 'custom' ? parseInt($('#custom-days')?.value)||0 : parseInt(d);
    const p = $('#ban-preview');
    if (!p) return;
    if (!days) {
      p.innerHTML = '<i class="fas fa-infinity" style="color:var(--red2);margin-right:6px"></i><span style="color:var(--red2)">Kalıcı ban — admin elle kaldırana kadar devam eder</span>';
    } else {
      const until = new Date(Date.now() + days * 86400000);
      p.innerHTML = `<i class="fas fa-clock" style="color:var(--orange);margin-right:6px"></i><span style="color:var(--orange)">Bitiş: ${until.toLocaleDateString('tr-TR', {day:'2-digit',month:'long',year:'numeric'})}</span>`;
    }
  };
  updatePreview();

  $('#ban-duration').addEventListener('change', () => {
    $('#custom-days-wrap').classList.toggle('hidden', $('#ban-duration').value !== 'custom');
    updatePreview();
  });
  $('#custom-days')?.addEventListener('input', updatePreview);
  $('#ban-cancel-btn').addEventListener('click', hideModal);

  $('#ban-confirm-btn').addEventListener('click', async () => {
    const btn = $('#ban-confirm-btn'); const err = $('#ban-err');
    const reason = $('#ban-reason').value.trim();
    const d = $('#ban-duration').value;
    const days = d === 'custom' ? parseInt($('#custom-days')?.value)||0 : parseInt(d);
    if (!reason) { err.textContent = 'Ban sebebi zorunlu'; return; }
    btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>';
    try {
      await adminApi('/songs/'+songId+'/ban', { method:'POST', body:JSON.stringify({ reason, duration_days: days }) });
      toast('Şarkıya ban uygulandı');
      hideModal();
      const s = songs.find(x => x.id == songId);
      if (s) { s.status='suspended'; s.ban_reason=reason; s.ban_until=days>0?new Date(Date.now()+days*86400000).toISOString():null; }
      if (renderSongs) renderSongs(songs);
    } catch(e) { err.textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-ban"></i> Banı Uygula'; }
  });
}

function showEditArtistModal(artist, list, renderTable) {
  showModal(`✏️ Artist Düzenle — ${escHtml(artist.username)}`, `
    <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg4);border-radius:10px;margin-bottom:16px">
      ${artist.avatar
        ? `<img src="${escHtml(artist.avatar)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover" />`
        : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--red),#7f1d1d);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px"><i class="fas fa-microphone-alt"></i></div>`}
      <div>
        <div style="font-weight:700">${escHtml(artist.username)}</div>
        <div style="font-size:11px;color:var(--text3)">Artist'ten beri: ${artist.artist_since ? formatDate(artist.artist_since) : '—'}</div>
      </div>
    </div>
    <div class="form-group">
      <label>Sahne Adı / Display Name</label>
      <input id="ea-display" value="${escHtml(artist.artist_display_name||'')}" placeholder="Kullanıcı adından farklı sanatçı adı..." />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Müzik Türü</label>
        <input id="ea-genre" value="${escHtml(artist.artist_genre||'')}" placeholder="Pop, Rock, Hip-Hop..." />
      </div>
      <div class="form-group">
        <label>Website / Sosyal Medya</label>
        <input id="ea-website" value="${escHtml(artist.artist_website||'')}" placeholder="https://..." />
      </div>
    </div>
    <div class="form-group">
      <label>Artist Bio</label>
      <textarea id="ea-bio" rows="3" placeholder="Artist hakkında kısa açıklama...">${escHtml(artist.artist_bio||'')}</textarea>
    </div>
    <div style="background:rgba(220,38,38,0.07);border:1px solid var(--border-red);border-radius:10px;padding:12px;margin-bottom:16px">
      <label class="checkbox-label" style="margin:0">
        <input type="checkbox" id="ea-is-artist" ${artist.is_artist ? 'checked' : ''} />
        <span><i class="fas fa-microphone-alt" style="color:var(--red2);margin-right:6px"></i> Artist rozeti aktif</span>
      </label>
      <div style="font-size:11px;color:var(--text3);margin-top:6px;margin-left:26px">Rozeti kaldırırsan kullanıcı yeni şarkı yükleyemez. Mevcut şarkılar silinmez.</div>
    </div>
    <button class="btn btn-primary" id="ea-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
    <div id="ea-err" class="form-error mt-4"></div>
  `);

  $('#ea-save').addEventListener('click', async () => {
    const btn = $('#ea-save'); const err = $('#ea-err');
    btn.disabled=true; btn.innerHTML='<div class="spinner" style="width:14px;height:14px"></div> Kaydediliyor...';
    try {
      const body = {
        artist_display_name: $('#ea-display').value.trim(),
        artist_genre: $('#ea-genre').value.trim(),
        artist_website: $('#ea-website').value.trim(),
        artist_bio: $('#ea-bio').value.trim(),
        is_artist: $('#ea-is-artist').checked ? 1 : 0
      };
      await adminApi('/artists/'+artist.id, { method:'PUT', body:JSON.stringify(body) });
      toast('Artist bilgileri güncellendi');
      const idx = list.findIndex(a => a.id == artist.id);
      if (idx !== -1) {
        if (!body.is_artist) { list.splice(idx, 1); }
        else { list[idx] = { ...list[idx], ...body }; }
      }
      hideModal();
      if (renderTable) renderTable(list);
    } catch(e) { err.textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
  });
}

// ===== LEVELS =====
async function renderLevels(main) {
  let levels = [];
  try { levels = await adminApi('/levels'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  const renderTable = () => {
    const tbody = $('#levels-tbody'); if (!tbody) return;
    if (!levels.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:32px">Seviye yok</td></tr>'; return; }
    tbody.innerHTML = levels.map(l => `<tr>
      <td><span style="font-size:18px">${escHtml(l.icon||'')}</span></td>
      <td style="font-weight:600">${escHtml(l.name)}</td>
      <td><span class="badge" style="background:${escHtml(l.color||'#666')};color:#fff;border:none">${escHtml(l.color||'—')}</span></td>
      <td style="font-size:12px;color:var(--text2)">Forum: ${l.min_forums||0} / Kitap: ${l.min_books||0} / Sayfa: ${l.min_book_pages||0}</td>
      <td style="font-size:12px;color:var(--text2)">${l.order_num}</td>
      <td>
        <button class="btn btn-danger btn-xs del-level-btn" data-id="${l.id}"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('');
    tbody.querySelectorAll('.del-level-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu seviyeyi silmek istediğine emin misin?')) return;
        try { await adminApi('/level/'+btn.dataset.id, {method:'DELETE'}); toast('Seviye silindi'); levels = levels.filter(l=>l.id!=btn.dataset.id); renderTable(); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-layer-group"></i></div> Seviyeler</div>
      <button class="btn btn-primary btn-sm" id="new-level-btn"><i class="fas fa-plus"></i> Yeni Seviye</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>İkon</th><th>İsim</th><th>Renk</th><th>Koşullar</th><th>Sıra</th><th>İşlem</th></tr></thead>
          <tbody id="levels-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderTable();
  $('#new-level-btn').addEventListener('click', () => {
    showModal('Yeni Seviye Ekle', `
      <div class="form-group"><label>İsim</label><input id="lv-name" /></div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label>İkon <span style="font-size:11px;color:var(--text3)">(FA class veya emoji)</span></label>
          <div style="display:flex;gap:8px;align-items:center">
            <div id="lv-icon-preview" style="width:36px;height:36px;background:var(--bg4);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
              <i class="fas fa-star"></i>
            </div>
            <input id="lv-icon" placeholder="fas fa-star veya ⭐" value="fas fa-star" style="flex:1" />
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="lv-icon-picker-btn" style="margin-top:6px;width:100%"><i class="fas fa-icons"></i> İkon Seç</button>
          <div id="lv-icon-grid" style="display:none;max-height:220px;overflow-y:auto;background:var(--bg4);border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px"></div>
        </div>
        <div class="form-group" style="flex:0 0 100px">
          <label>Renk</label>
          <input id="lv-color" type="color" value="#dc2626" style="height:36px;padding:2px;cursor:pointer" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Min. Forum</label><input id="lv-forums" type="number" value="0" /></div>
        <div class="form-group"><label>Min. Kitap</label><input id="lv-books" type="number" value="0" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Min. Kitap Sayfası</label><input id="lv-pages" type="number" value="0" /></div>
        <div class="form-group"><label>Sıra</label><input id="lv-order" type="number" value="${levels.length+1}" /></div>
      </div>
      <div id="lv-err" class="form-error"></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:12px" id="lv-save-btn"><i class="fas fa-save"></i> Kaydet</button>
    `);

    // İkon önizleme güncelleyici
    const iconInput = $('#lv-icon');
    const iconPreview = $('#lv-icon-preview');
    const iconGrid = $('#lv-icon-grid');
    let gridOpen = false;

    const updatePreview = () => {
      const v = iconInput.value.trim();
      if (v.startsWith('fa')) {
        iconPreview.innerHTML = `<i class="${escHtml(v)}"></i>`;
      } else {
        iconPreview.textContent = v || '?';
      }
    };
    iconInput.addEventListener('input', updatePreview);

    // İkon grid'ini aç/kapat
    const FA_ICONS = [
      'fas fa-star','fas fa-fire','fas fa-crown','fas fa-gem','fas fa-bolt','fas fa-heart',
      'fas fa-shield','fas fa-dragon','fas fa-feather','fas fa-pen','fas fa-book',
      'fas fa-seedling','fas fa-leaf','fas fa-tree','fas fa-mountain','fas fa-sun',
      'fas fa-moon','fas fa-cloud','fas fa-snowflake','fas fa-wind',
      'fas fa-trophy','fas fa-medal','fas fa-award','fas fa-certificate',
      'fas fa-graduation-cap','fas fa-user-graduate','fas fa-user',
      'fas fa-robot','fas fa-skull','fas fa-ghost','fas fa-hat-wizard',
      'fas fa-rocket','fas fa-satellite','fas fa-meteor','fas fa-globe',
      'fas fa-map-pin','fas fa-compass','fas fa-binoculars',
      'fas fa-code','fas fa-laptop-code','fas fa-terminal','fas fa-bug',
      'fas fa-music','fas fa-headphones','fas fa-microphone','fas fa-guitar',
      'fas fa-camera','fas fa-palette','fas fa-brush','fas fa-film',
      'fas fa-gamepad','fas fa-dice','fas fa-chess',
      'fas fa-coffee','fas fa-mug-hot','fas fa-beer',
      'fas fa-dumbbell','fas fa-running','fas fa-bicycle','fas fa-futbol',
      'fas fa-car','fas fa-plane','fas fa-ship',
      'fas fa-cat','fas fa-dog','fas fa-fish','fas fa-horse',
      'fas fa-circle','fas fa-square','fas fa-diamond','fas fa-infinity'
    ];

    $('#lv-icon-picker-btn').addEventListener('click', () => {
      gridOpen = !gridOpen;
      if (gridOpen) {
        iconGrid.style.display = 'grid';
        iconGrid.innerHTML = FA_ICONS.map(ic => `
          <button type="button" class="icon-pick-btn" data-icon="${ic}" title="${ic}"
            style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .15s">
            <i class="${ic}"></i>
          </button>`).join('');
        iconGrid.querySelectorAll('.icon-pick-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            iconInput.value = btn.dataset.icon;
            updatePreview();
            iconGrid.style.display = 'none';
            gridOpen = false;
            // Seçilen ikonu vurgula
            iconGrid.querySelectorAll('.icon-pick-btn').forEach(b => b.style.background = 'var(--bg3)');
            btn.style.background = 'rgba(220,38,38,0.2)';
          });
          btn.addEventListener('mouseover', () => btn.style.background = 'rgba(220,38,38,0.1)');
          btn.addEventListener('mouseout', () => btn.style.background = 'var(--bg3)');
        });
      } else {
        iconGrid.style.display = 'none';
      }
    });

    $('#lv-save-btn').addEventListener('click', async () => {
      const err = $('#lv-err');
      const name = $('#lv-name').value.trim();
      if (!name) { err.textContent='İsim zorunlu'; return; }
      try {
        const body = { name, icon:$('#lv-icon').value.trim()||'fas fa-star', color:$('#lv-color').value, min_forums:+$('#lv-forums').value, min_books:+$('#lv-books').value, min_book_pages:+$('#lv-pages').value, order_num:+$('#lv-order').value };
        const nl = await adminApi('/levels', {method:'POST', body:JSON.stringify(body)});
        levels.push(nl); renderTable(); hideModal(); toast('Seviye eklendi');
      } catch(e) { err.textContent=e.message; }
    });
  });
}

// ===== TAGS =====
async function renderTags(main) {
  let tags = [];
  try { tags = await adminApi('/tags'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  const renderTable = () => {
    const tbody = $('#tags-tbody'); if (!tbody) return;
    if (!tags.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:32px">Etiket yok</td></tr>'; return; }
    tbody.innerHTML = tags.map(t => `<tr>
      <td><span class="badge" style="background:${escHtml(t.color||'#666')}22;color:${escHtml(t.color||'#aaa')};border:1px solid ${escHtml(t.color||'#666')}44">${escHtml(t.name)}</span></td>
      <td style="font-size:12px;color:var(--text3)">${escHtml(t.color||'—')}</td>
      <td>${t.is_system ? '<span class="badge badge-blue">Sistem</span>' : '<span class="badge badge-gray">Özel</span>'}</td>
      <td><button class="btn btn-danger btn-xs del-tag-btn" data-id="${t.id}" ${t.is_system?'disabled':''} title="${t.is_system?'Sistem etiketi silinemez':'Sil'}"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('');
    tbody.querySelectorAll('.del-tag-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu etiketi silmek istediğine emin misin?')) return;
        try { await adminApi('/tag/'+btn.dataset.id, {method:'DELETE'}); toast('Etiket silindi'); tags = tags.filter(t=>t.id!=btn.dataset.id); renderTable(); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-tags"></i></div> Etiketler</div>
      <button class="btn btn-primary btn-sm" id="new-tag-btn"><i class="fas fa-plus"></i> Yeni Etiket</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Etiket</th><th>Renk</th><th>Tür</th><th>İşlem</th></tr></thead>
          <tbody id="tags-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderTable();
  $('#new-tag-btn').addEventListener('click', () => {
    showModal('Yeni Etiket Ekle', `
      <div class="form-group"><label>İsim</label><input id="tag-name" /></div>
      <div class="form-group"><label>Renk</label><input id="tag-color" type="color" value="#5865F2" /></div>
      <div id="tag-err" class="form-error"></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:12px" id="tag-save-btn"><i class="fas fa-save"></i> Kaydet</button>
    `);
    $('#tag-save-btn').addEventListener('click', async () => {
      const err = $('#tag-err');
      const name = $('#tag-name').value.trim();
      if (!name) { err.textContent='İsim zorunlu'; return; }
      try {
        const nt = await adminApi('/tags', {method:'POST', body:JSON.stringify({name, color:$('#tag-color').value})});
        tags.push(nt); renderTable(); hideModal(); toast('Etiket eklendi');
      } catch(e) { err.textContent=e.message; }
    });
  });
}

// ===== LOGS =====
async function renderLogs(main) {
  let logs = [];
  try { logs = await adminApi('/logs'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-history"></i></div> Sistem Logları <span style="font-size:13px;font-weight:400;color:var(--text2)">(${logs.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="log-search" placeholder="Eylem veya aktör ara..." style="min-width:240px" /></div>
    </div>
    <div class="card">
      <div id="logs-list">
        ${logs.length ? logs.map(l => `
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;gap:10px">
            <span style="color:var(--red2);font-weight:600;min-width:100px">${escHtml(l.actor)}</span>
            <span style="color:var(--text2);font-size:11px;margin-right:4px"><i class="fas fa-arrow-right"></i></span>
            <span style="flex:1">${escHtml(l.action)}${l.target?' <span style="color:var(--text3)">→ '+escHtml(l.target)+'</span>':''}</span>
            <span style="color:var(--text3);font-size:11px;white-space:nowrap">${timeAgo(l.created_at)}</span>
          </div>`).join('') : '<div style="padding:32px;text-align:center;color:var(--text3)">Log yok</div>'}
      </div>
    </div>`;
  $('#log-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = logs.filter(l => l.actor.toLowerCase().includes(q) || l.action.toLowerCase().includes(q));
    $('#logs-list').innerHTML = filtered.length ? filtered.map(l => `
      <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;gap:10px">
        <span style="color:var(--red2);font-weight:600;min-width:100px">${escHtml(l.actor)}</span>
        <span style="color:var(--text2);font-size:11px;margin-right:4px"><i class="fas fa-arrow-right"></i></span>
        <span style="flex:1">${escHtml(l.action)}${l.target?' <span style="color:var(--text3)">→ '+escHtml(l.target)+'</span>':''}</span>
        <span style="color:var(--text3);font-size:11px;white-space:nowrap">${timeAgo(l.created_at)}</span>
      </div>`).join('') : '<div style="padding:32px;text-align:center;color:var(--text3)">Sonuç bulunamadı</div>';
  });
}

// ===== MESSAGES =====
async function renderAdminMessages(main) {
  let convs = [];
  try { convs = await adminApi('/conversations'); } catch (e) {
    main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return;
  }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-envelope"></i></div> Mesajlar <span style="font-size:13px;font-weight:400;color:var(--text2)">(${convs.length})</span></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Kullanıcı 1</th><th>Kullanıcı 2</th><th>Son Mesaj</th><th>İşlem</th></tr></thead>
          <tbody>
            ${convs.length ? convs.map(c => `<tr>
              <td style="color:var(--text3);font-size:12px">#${c.id}</td>
              <td style="color:var(--blue2)">${escHtml(c.user1||'—')}</td>
              <td style="color:var(--blue2)">${escHtml(c.user2||'—')}</td>
              <td style="color:var(--text3);font-size:12px">${timeAgo(c.last_message_at)}</td>
              <td><button class="btn btn-outline btn-xs view-conv-btn" data-id="${c.id}" data-u1="${escHtml(c.user1||'')}" data-u2="${escHtml(c.user2||'')}"><i class="fas fa-eye"></i> Gör</button></td>
            </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:32px">Konuşma bulunamadı</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  main.querySelectorAll('.view-conv-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const msgs = await adminApi('/conversations/'+btn.dataset.id+'/messages');
        const u1 = btn.dataset.u1, u2 = btn.dataset.u2;
        showModal(`${u1} ↔ ${u2}`, `
          <div style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 0">
            ${msgs.length ? msgs.map(m => `
              <div style="padding:8px 12px;border-radius:8px;background:var(--bg4);font-size:13px">
                <span style="color:var(--blue2);font-weight:600">${escHtml(m.sender_username)}</span>
                <span style="color:var(--text3);font-size:11px;margin-left:8px">${timeAgo(m.created_at)}</span>
                <div style="margin-top:4px;color:var(--text)">${escHtml(m.content)}</div>
              </div>`).join('') : '<div style="color:var(--text3);text-align:center;padding:20px">Mesaj yok</div>'}
          </div>
        `);
      } catch(e) { toast(e.message, 'error'); }
    });
  });
}

// ===== DUYURULAR =====
async function renderAnnouncements(main) {
  let anns = [];
  try { anns = await adminApi('/announcements'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return; }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-bullhorn"></i></div> Duyurular</div>
      <button class="btn btn-primary btn-sm" id="ann-new-btn"><i class="fas fa-plus"></i> Yeni Duyuru</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Başlık</th><th>Konum</th><th>Boyut</th><th>Bitiş</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="ann-tbody"></tbody>
        </table>
      </div>
    </div>`;
  renderAnnTable(anns);
  $('#ann-new-btn').addEventListener('click', () => showAnnModal(null, anns));
}

function renderAnnTable(anns) {
  const tbody = $('#ann-tbody'); if (!tbody) return;
  if (!anns.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:32px">Duyuru yok</td></tr>'; return; }
  tbody.innerHTML = anns.map(a => `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:12px;height:12px;border-radius:3px;background:${escHtml(a.bg_color)};border:1px solid ${escHtml(a.border_color)};flex-shrink:0"></div>
        <strong>${escHtml(a.title)}</strong>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.content)}</div>
    </td>
    <td><span class="badge badge-gray">${a.position||'top'}</span></td>
    <td><span class="badge badge-gray">${a.size||'normal'}</span></td>
    <td style="font-size:11px;color:var(--text2)">${a.expires_at ? formatDate(a.expires_at) : '∞ Süresiz'}</td>
    <td>${a.active ? '<span class="badge badge-green"><i class="fas fa-circle" style="font-size:8px"></i> Aktif</span>' : '<span class="badge badge-gray">Pasif</span>'}</td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-outline btn-xs ann-edit-btn" data-id="${a.id}"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-xs ann-del-btn" data-id="${a.id}"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');
  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.ann-edit-btn');
    const del = e.target.closest('.ann-del-btn');
    if (edit) { const a = anns.find(x => x.id == edit.dataset.id); if (a) showAnnModal(a, anns); }
    if (del) { if (!confirm('Duyuru silinsin mi?')) return; try { await adminApi('/announcements/'+del.dataset.id, {method:'DELETE'}); toast('Silindi'); loadSection('announcements'); } catch(e){toast(e.message,'error');} }
  });
}

function showAnnModal(ann, anns) {
  const isEdit = !!ann;
  showModal(isEdit ? 'Duyuru Düzenle' : 'Yeni Duyuru', `
    <div class="form-group"><label>Başlık</label><input id="ann-title" value="${escHtml(ann?.title||'')}" placeholder="Duyuru başlığı..." /></div>
    <div class="form-group"><label>İçerik</label><textarea id="ann-content" rows="3" placeholder="Duyuru metni...">${escHtml(ann?.content||'')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Arka Plan Rengi</label><input id="ann-bg" type="color" value="${ann?.bg_color||'#dc2626'}" style="height:38px;cursor:pointer" /></div>
      <div class="form-group"><label>Yazı Rengi</label><input id="ann-text-color" type="color" value="${ann?.text_color||'#ffffff'}" style="height:38px;cursor:pointer" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Kenarlık Rengi</label><input id="ann-border" type="color" value="${ann?.border_color||'#991b1b'}" style="height:38px;cursor:pointer" /></div>
      <div class="form-group"><label>Konum</label>
        <select id="ann-pos">
          <option value="top" ${ann?.position==='top'?'selected':''}>Üst</option>
          <option value="bottom" ${ann?.position==='bottom'?'selected':''}>Alt</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Boyut</label>
        <select id="ann-size">
          <option value="small" ${ann?.size==='small'?'selected':''}>Küçük</option>
          <option value="normal" ${ann?.size==='normal'||!ann?.size?'selected':''}>Normal</option>
          <option value="large" ${ann?.size==='large'?'selected':''}>Büyük</option>
        </select>
      </div>
      <div class="form-group"><label>Durum</label>
        <select id="ann-active">
          <option value="1" ${ann?.active!==0?'selected':''}>Aktif</option>
          <option value="0" ${ann?.active===0?'selected':''}>Pasif</option>
        </select>
      </div>
    </div>
    <div style="background:var(--bg4);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Süre Ayarı</div>
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group" style="margin-bottom:0"><label>Değer (0 = süresiz)</label><input id="ann-dur-val" type="number" min="0" value="0" /></div>
        <div class="form-group" style="margin-bottom:0"><label>Birim</label>
          <select id="ann-dur-type">
            <option value="seconds">Saniye</option>
            <option value="minutes">Dakika</option>
            <option value="hours" selected>Saat</option>
            <option value="days">Gün</option>
          </select>
        </div>
      </div>
    </div>
    <div id="ann-preview" style="margin-bottom:16px"></div>
    <button class="btn btn-primary" id="ann-save-btn" style="width:100%;justify-content:center">${isEdit?'Güncelle':'Oluştur'}</button>
    <div id="ann-error" class="form-error mt-4"></div>
  `);

  function updatePreview() {
    const pre = $('#ann-preview'); if (!pre) return;
    const bg = $('#ann-bg')?.value||'#dc2626', tc = $('#ann-text-color')?.value||'#fff', bc = $('#ann-border')?.value||'#991b1b';
    const title = $('#ann-title')?.value||'Başlık', content = $('#ann-content')?.value||'İçerik';
    pre.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Önizleme</div>
      <div style="background:${bg};color:${tc};border:2px solid ${bc};border-radius:8px;padding:10px 14px;font-size:13px">
        <strong>${escHtml(title)}</strong> <span>${escHtml(content)}</span>
      </div>`;
  }
  ['#ann-bg','#ann-text-color','#ann-border','#ann-title','#ann-content'].forEach(sel => { const el=$(sel); if(el) el.addEventListener('input', updatePreview); });
  updatePreview();

  $('#ann-save-btn').addEventListener('click', async () => {
    const body = {
      title: $('#ann-title').value.trim(), content: $('#ann-content').value.trim(),
      bg_color: $('#ann-bg').value, text_color: $('#ann-text-color').value,
      border_color: $('#ann-border').value, position: $('#ann-pos').value,
      size: $('#ann-size').value, active: parseInt($('#ann-active').value),
      duration_type: $('#ann-dur-type').value, duration_value: $('#ann-dur-val').value
    };
    if (!body.title || !body.content) { $('#ann-error').textContent = 'Başlık ve içerik zorunlu'; return; }
    try {
      if (isEdit) await adminApi('/announcements/'+ann.id, {method:'PUT', body:JSON.stringify(body)});
      else await adminApi('/announcements', {method:'POST', body:JSON.stringify(body)});
      toast(isEdit ? 'Duyuru güncellendi' : 'Duyuru oluşturuldu'); hideModal(); loadSection('announcements');
    } catch (e) { $('#ann-error').textContent = e.message; }
  });
}

// ===== ADMIN: MÜZİKLER =====
async function renderAdminSongs(main) {
  let songs = [];
  try { songs = await adminApi('/songs'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return; }
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title"><div class="icon-pill"><i class="fas fa-music"></i></div> Müzikler <span style="font-size:13px;font-weight:400;color:var(--text2)">(${songs.length})</span></div>
      <div class="adm-search"><i class="fas fa-search"></i><input type="text" id="song-search" placeholder="Şarkı, sanatçı, dağıtıcı ara..." style="min-width:220px" /></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Kapak</th><th>Başlık / Sanatçı</th><th>Tür</th><th>Dağıtıcı</th><th>Dinlenme</th><th>Durum</th><th>Yükleyen</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="songs-tbody"></tbody>
        </table>
      </div>
    </div>`;
  const render = (list) => {
    const t = document.getElementById('songs-tbody'); if (!t) return;
    if (!list.length) { t.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px">Şarkı yok</td></tr>'; return; }
    t.innerHTML = list.map(s => `<tr>
      <td>${s.cover_url ? `<img src="${escHtml(s.cover_url)}" style="width:40px;height:40px;border-radius:6px;object-fit:cover" />` : `<div style="width:40px;height:40px;border-radius:6px;background:var(--bg4);display:flex;align-items:center;justify-content:center;color:var(--text3)"><i class="fas fa-music"></i></div>`}</td>
      <td>
        <div style="font-weight:600;font-size:13px">${escHtml(s.title)}</div>
        <div style="font-size:11px;color:var(--text2)">${escHtml(s.artist_name)}</div>
      </td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(s.genre||'-')}</td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(s.distributor||'-')}</td>
      <td style="font-size:12px">${s.play_count}</td>
      <td>${s.status === 'active' ? '<span class="badge badge-green">Aktif</span>' : s.status === 'suspended' ? '<span class="badge badge-red">Askıda</span>' : `<span class="badge badge-gray">${escHtml(s.status)}</span>`}</td>
      <td style="font-size:11px;color:var(--text2)">${escHtml(s.uploader||'-')}</td>
      <td style="font-size:11px;color:var(--text3)">${timeAgo(s.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-outline btn-xs es-btn" data-id="${s.id}" title="Düzenle"><i class="fas fa-edit"></i></button>
          ${s.status === 'active'
            ? `<button class="btn btn-danger btn-xs sus-btn" data-id="${s.id}" title="Askıya Al"><i class="fas fa-pause"></i></button>`
            : `<button class="btn btn-green btn-xs unsus-btn" data-id="${s.id}" title="Aktife Al"><i class="fas fa-play"></i></button>`}
          <button class="btn btn-danger btn-xs ds-btn" data-id="${s.id}" title="Sil"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');

    t.addEventListener('click', async e => {
      const es = e.target.closest('.es-btn');
      const sus = e.target.closest('.sus-btn');
      const unsus = e.target.closest('.unsus-btn');
      const ds = e.target.closest('.ds-btn');
      if (es) { const s = list.find(x => x.id == es.dataset.id); if (s) showSongEditModal(s); }
      if (sus) {
        if (!confirm('Şarkı askıya alınsın mı?')) return;
        try { await adminApi('/songs/'+sus.dataset.id, {method:'PUT', body:JSON.stringify({status:'suspended'})}); toast('Askıya alındı'); loadSection('songs'); } catch(e){toast(e.message,'error');}
      }
      if (unsus) {
        try { await adminApi('/songs/'+unsus.dataset.id, {method:'PUT', body:JSON.stringify({status:'active'})}); toast('Aktife alındı'); loadSection('songs'); } catch(e){toast(e.message,'error');}
      }
      if (ds) { if (!confirm('Şarkı kalıcı silinsin mi?')) return; try { await adminApi('/songs/'+ds.dataset.id, {method:'DELETE'}); toast('Silindi'); loadSection('songs'); } catch(e){toast(e.message,'error');} }
    });
  };
  render(songs);
  document.getElementById('song-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    render(songs.filter(s => s.title.toLowerCase().includes(q) || s.artist_name.toLowerCase().includes(q) || (s.distributor||'').toLowerCase().includes(q)));
  });
}

function showSongEditModal(song) {
  showModal(`Şarkı Düzenle — ${escHtml(song.title)}`, `
    <div class="form-row">
      <div class="form-group"><label>Şarkı Adı</label><input id="se-title" value="${escHtml(song.title)}" /></div>
      <div class="form-group"><label>Sanatçı Adı</label><input id="se-artist" value="${escHtml(song.artist_name)}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Dağıtıcı</label><input id="se-dist" value="${escHtml(song.distributor||'')}" /></div>
      <div class="form-group"><label>Tür</label><input id="se-genre" value="${escHtml(song.genre||'')}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Dinlenme Sayısı</label><input id="se-plays" type="number" value="${song.play_count}" /></div>
      <div class="form-group"><label>Durum</label>
        <select id="se-status">
          <option value="active" ${song.status==='active'?'selected':''}>Aktif</option>
          <option value="suspended" ${song.status==='suspended'?'selected':''}>Askıda</option>
          <option value="deleted" ${song.status==='deleted'?'selected':''}>Silindi</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Şarkı Sözleri</label><textarea id="se-lyrics" rows="6">${escHtml(song.lyrics||'')}</textarea></div>
    <div class="form-group"><label>Yeni Ses Dosyası (boş bırak = değişme)</label>
      <input type="file" id="se-audio" accept="audio/*" style="background:var(--bg3);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px" />
    </div>
    <div class="form-group"><label>Yeni Kapak Fotoğrafı (boş bırak = değişme)</label>
      <input type="file" id="se-cover" accept="image/*" style="background:var(--bg3);border:1px dashed var(--border);padding:8px;cursor:pointer;border-radius:8px" />
    </div>
    <button class="btn btn-primary" id="se-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
    <div id="se-msg" class="form-error mt-4"></div>
  `);
  document.getElementById('se-save').addEventListener('click', async () => {
    const btn = document.getElementById('se-save');
    btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Kaydediliyor...';
    const fd = new FormData();
    fd.append('title', document.getElementById('se-title').value.trim());
    fd.append('artist_name', document.getElementById('se-artist').value.trim());
    fd.append('distributor', document.getElementById('se-dist').value.trim());
    fd.append('genre', document.getElementById('se-genre').value.trim());
    fd.append('lyrics', document.getElementById('se-lyrics').value.trim());
    fd.append('play_count', document.getElementById('se-plays').value);
    fd.append('status', document.getElementById('se-status').value);
    const af = document.getElementById('se-audio').files[0]; if(af) fd.append('audio', af);
    const cf = document.getElementById('se-cover').files[0]; if(cf) fd.append('cover', cf);
    try {
      const res = await fetch('/api/admin/songs/'+song.id, { method:'PUT', headers:{'X-Admin-Token':adminToken}, body:fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Hata');
      toast('Şarkı güncellendi'); hideModal(); loadSection('songs');
    } catch(e) { document.getElementById('se-msg').textContent=e.message; btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Kaydet'; }
  });
}

// ===== ADMIN: ARTİST BAŞVURULARI =====
async function renderArtistApps(main) {
  let apps = [];
  try { apps = await adminApi('/artist-applications'); } catch (e) { main.innerHTML = `<p style="color:var(--red2);padding:20px">${e.message}</p>`; return; }
  const pending = apps.filter(a => a.status === 'pending');
  const others = apps.filter(a => a.status !== 'pending');
  main.innerHTML = `
    <div class="adm-section-header">
      <div class="adm-section-title">
        <div class="icon-pill"><i class="fas fa-microphone"></i></div>
        Artist Başvuruları
        ${pending.length ? `<span class="adm-nav-badge">${pending.length}</span>` : ''}
      </div>
    </div>
    ${pending.length ? `
    <div style="margin-bottom:24px">
      <div style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">⏳ Bekleyen (${pending.length})</div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kullanıcı</th><th>Tür</th><th>Örnek</th><th>Not</th><th>Tarih</th><th>İşlem</th></tr></thead>
            <tbody id="pending-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>` : '<div class="card" style="margin-bottom:20px"><div class="card-body" style="text-align:center;color:var(--text3);padding:30px"><i class="fas fa-check-circle" style="font-size:28px;margin-bottom:8px;color:var(--green)"></i><div>Bekleyen başvuru yok</div></div></div>'}
    ${others.length ? `
    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Geçmiş Başvurular</div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Kullanıcı</th><th>Tür</th><th>Durum</th><th>İnceleme</th><th>Tarih</th></tr></thead>
            <tbody>${others.map(a => `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  ${a.avatar ? `<img src="${escHtml(a.avatar)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />` : `<div style="width:28px;height:28px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center"><i class="fas fa-user" style="font-size:11px"></i></div>`}
                  <strong>${escHtml(a.username)}</strong>
                </div>
              </td>
              <td style="font-size:12px">${escHtml(a.genre)}</td>
              <td>${a.status === 'accepted' ? '<span class="badge badge-green"><i class="fas fa-check"></i> Onaylandı</span>' : '<span class="badge badge-red"><i class="fas fa-times"></i> Reddedildi</span>'}</td>
              <td style="font-size:11px;color:var(--text3)">${a.reviewed_at ? timeAgo(a.reviewed_at) : '-'}</td>
              <td style="font-size:11px;color:var(--text3)">${timeAgo(a.created_at)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>` : ''}`;

  const pt = document.getElementById('pending-tbody');
  if (pt && pending.length) {
    pt.innerHTML = pending.map(a => `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          ${a.avatar ? `<img src="${escHtml(a.avatar)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover" />` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center"><i class="fas fa-user" style="font-size:12px"></i></div>`}
          <div>
            <div style="font-weight:600;font-size:13px">${escHtml(a.username)}</div>
            <div style="font-size:10px;color:var(--text3)">#${a.user_id}</div>
          </div>
        </div>
      </td>
      <td style="font-size:12px">${escHtml(a.genre)}</td>
      <td>
        ${a.sample_song_url ? `<a href="${escHtml(a.sample_song_url)}" target="_blank" class="btn btn-outline btn-xs"><i class="fas fa-external-link-alt"></i> URL</a>` : ''}
        ${a.sample_song_file ? `<a href="${escHtml(a.sample_song_file)}" target="_blank" class="btn btn-outline btn-xs"><i class="fas fa-music"></i> Dosya</a>` : ''}
      </td>
      <td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.note||'-')}</td>
      <td style="font-size:11px;color:var(--text3)">${timeAgo(a.created_at)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-green btn-sm approve-app-btn" data-id="${a.id}" data-uid="${a.user_id}">
            <i class="fas fa-check"></i> Onayla
          </button>
          <button class="btn btn-danger btn-sm reject-app-btn" data-id="${a.id}">
            <i class="fas fa-times"></i> Reddet
          </button>
        </div>
      </td>
    </tr>`).join('');

    pt.addEventListener('click', async e => {
      const approve = e.target.closest('.approve-app-btn');
      const reject = e.target.closest('.reject-app-btn');
      if (approve) {
        if (!confirm('Başvuru onaylansın mı? Kullanıcıya artist rozeti verilecek.')) return;
        try {
          await adminApi('/artist-applications/'+approve.dataset.id+'/review', { method:'POST', body:JSON.stringify({status:'accepted'}) });
          toast('✓ Artist rozeti verildi!'); loadSection('artist-apps');
        } catch(e) { toast(e.message, 'error'); }
      }
      if (reject) {
        if (!confirm('Başvuru reddedilsin mi?')) return;
        try {
          await adminApi('/artist-applications/'+reject.dataset.id+'/review', { method:'POST', body:JSON.stringify({status:'rejected'}) });
          toast('Başvuru reddedildi'); loadSection('artist-apps');
        } catch(e) { toast(e.message, 'error'); }
      }
    });
  }
}

// ===== SETTINGS =====
async function renderSettings(main) {
  let settings = {};
  try { const rows = await adminApi('/settings'); settings = rows; } catch {}

  main.innerHTML = `
    <div class="adm-section-header"><div class="adm-section-title"><div class="icon-pill"><i class="fas fa-cog"></i></div> Site Ayarları</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-header"><span><i class="fas fa-palette" style="color:var(--red2);margin-right:8px"></i>Genel</span></div>
        <div class="card-body">
          <div class="form-group"><label>Site Adı</label><input id="s-sitename" value="${escHtml(settings['site_name']||'Demlik')}" /></div>
          <div class="form-group">
            <label>Site Logosu</label>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
              <div id="logo-preview" style="width:52px;height:52px;border-radius:10px;border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg4)">
                ${settings['site_logo'] ? `<img src="${escHtml(settings['site_logo'])}" style="width:100%;height:100%;object-fit:contain" />` : `<i class="fas fa-image" style="color:var(--text3)"></i>`}
              </div>
              <div style="flex:1">
                <div style="font-size:12px;color:var(--text2);margin-bottom:6px">PNG, JPG veya SVG yükleyin</div>
                <label for="logo-file-input" class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
                  <i class="fas fa-upload"></i> Dosya Seç
                </label>
                <input type="file" id="logo-file-input" accept="image/*" style="display:none" />
              </div>
            </div>
            <div id="logo-filename" style="font-size:11px;color:var(--text3);margin-bottom:6px"></div>
            <button class="btn btn-primary btn-sm" id="logo-upload-btn" style="display:none"><i class="fas fa-check"></i> Logoyu Kaydet</button>
            <div id="logo-msg" class="form-error mt-4"></div>
          </div>
          <div class="form-group"><label>Site Açıklaması</label><textarea id="s-desc" rows="3">${escHtml(settings['site_description']||'')}</textarea></div>
          <button class="btn btn-primary" id="s-general-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-general-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-lock" style="color:var(--red2);margin-right:8px"></i>Güvenlik</span></div>
        <div class="card-body">
          <div class="form-group"><label>Yeni Admin Şifresi</label><input id="s-newpw" type="password" placeholder="Boş bırakırsan değişmez" /></div>
          <div class="form-group"><label>Şifreyi Onayla</label><input id="s-newpw2" type="password" placeholder="••••••" /></div>
          <button class="btn btn-primary" id="s-pw-save" style="width:100%;justify-content:center"><i class="fas fa-key"></i> Şifreyi Güncelle</button>
          <div id="s-pw-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-file-alt" style="color:var(--red2);margin-right:8px"></i>Footer</span></div>
        <div class="card-body">
          <div class="form-group"><label>Footer Yazısı</label><input id="s-footer" value="${escHtml(settings['footer_copyright_text']||'')}" placeholder="© Copyright 2026" /></div>
          <label class="checkbox-label" style="margin-bottom:12px">
            <input type="checkbox" id="s-footer-created" ${settings['footer_created_visible']!=='0'?'checked':''} />
            "Created By" yazısını göster
          </label>
          <button class="btn btn-primary" id="s-footer-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-footer-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-shield-halved" style="color:var(--red2);margin-right:8px"></i>KVKK Metni</span></div>
        <div class="card-body">
          <div class="form-group"><textarea id="s-kvkk" rows="5">${escHtml(settings['kvkk_text']||'')}</textarea></div>
          <button class="btn btn-primary" id="s-kvkk-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-kvkk-msg" class="form-error mt-4"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span><i class="fas fa-music" style="color:var(--red2);margin-right:8px"></i>Şarkı Yayınlama Kuralları</span></div>
        <div class="card-body">
          <div class="form-group"><label>Kendi Şarkım – Kurallar</label><textarea id="s-music-own" rows="4">${escHtml(settings['music_own_rules']||'')}</textarea></div>
          <button class="btn btn-primary btn-sm" id="s-music-own-save" style="width:100%;justify-content:center;margin-bottom:16px"><i class="fas fa-save"></i> Kaydet</button>
          <div class="form-group"><label>Başkasının Şarkısı – Kurallar</label><textarea id="s-music-other" rows="4">${escHtml(settings['music_other_rules']||'')}</textarea></div>
          <button class="btn btn-primary btn-sm" id="s-music-other-save" style="width:100%;justify-content:center"><i class="fas fa-save"></i> Kaydet</button>
          <div id="s-music-msg" class="form-error mt-4"></div>
        </div>
      </div>
    </div>`;

  // Logo upload
  const logoInput = document.getElementById('logo-file-input');
  logoInput.addEventListener('change', () => {
    const file = logoInput.files[0]; if (!file) return;
    document.getElementById('logo-filename').textContent = file.name + ' (' + (file.size/1024).toFixed(1) + ' KB)';
    document.getElementById('logo-upload-btn').style.display = 'inline-flex';
    const reader = new FileReader();
    reader.onload = e => { const p=document.getElementById('logo-preview'); if(p) p.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:contain" />`; };
    reader.readAsDataURL(file);
  });
  document.getElementById('logo-upload-btn').addEventListener('click', async () => {
    const file = logoInput.files[0]; const msgEl = document.getElementById('logo-msg');
    if (!file) { msgEl.textContent='Dosya seçin'; return; }
    const btn = document.getElementById('logo-upload-btn');
    btn.disabled=true; btn.innerHTML='<div class="spinner" style="width:14px;height:14px"></div> Yükleniyor...';
    msgEl.textContent='';
    try {
      const fd = new FormData(); fd.append('logo', file);
      const res = await fetch('/api/admin/upload-logo', { method:'POST', headers:{'X-Admin-Token':adminToken}, body:fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Hata');
      toast('Logo güncellendi!'); msgEl.style.color='var(--green)'; msgEl.textContent='✓ Kaydedildi';
    } catch(e) { msgEl.style.color='var(--red2)'; msgEl.textContent=e.message; }
    finally { btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> Logoyu Kaydet'; }
  });

  async function saveSetting(key, value, msgEl) {
    try {
      await fetch('/api/admin/settings', { method:'POST', headers:{'Content-Type':'application/json','X-Admin-Token':adminToken}, body:JSON.stringify({key,value}) });
      toast('Kaydedildi');
    } catch(e) { if(msgEl) msgEl.textContent=e.message; }
  }

  document.getElementById('s-general-save').addEventListener('click', async () => {
    const msg = document.getElementById('s-general-msg');
    await saveSetting('site_name', document.getElementById('s-sitename').value.trim(), msg);
    await saveSetting('site_description', document.getElementById('s-desc').value.trim(), msg);
  });
  document.getElementById('s-pw-save').addEventListener('click', async () => {
    const msg = document.getElementById('s-pw-msg');
    const pw = document.getElementById('s-newpw').value, pw2 = document.getElementById('s-newpw2').value;
    if (!pw) { msg.textContent='Şifre boş olamaz'; return; }
    if (pw !== pw2) { msg.textContent='Şifreler eşleşmiyor'; return; }
    const hashHex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    await saveSetting('admin_password', hashHex, msg);
    adminToken = hashHex; sessionStorage.setItem('admin_token', adminToken);
    msg.style.color='var(--green)'; msg.textContent='Şifre güncellendi';
  });
  document.getElementById('s-footer-save').addEventListener('click', async () => {
    const msg = document.getElementById('s-footer-msg');
    await saveSetting('footer_copyright_text', document.getElementById('s-footer').value.trim(), msg);
    await saveSetting('footer_created_visible', document.getElementById('s-footer-created').checked?'1':'0', msg);
  });
  document.getElementById('s-kvkk-save').addEventListener('click', async () => {
    await saveSetting('kvkk_text', document.getElementById('s-kvkk').value.trim(), document.getElementById('s-kvkk-msg'));
  });
  document.getElementById('s-music-own-save').addEventListener('click', async () => {
    await saveSetting('music_own_rules', document.getElementById('s-music-own').value.trim(), document.getElementById('s-music-msg'));
  });
  document.getElementById('s-music-other-save').addEventListener('click', async () => {
    await saveSetting('music_other_rules', document.getElementById('s-music-other').value.trim(), document.getElementById('s-music-msg'));
  });
}
