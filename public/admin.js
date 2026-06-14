let adminToken = sessionStorage.getItem('admin_token') || '';
let currentSection = 'users';

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

if (adminToken) showPanel();

$('#admin-login-btn').addEventListener('click', tryLogin);
$('#admin-pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

async function tryLogin() {
  const pw = $('#admin-pw-input').value;
  if (!pw) return;
  const msgBuf = new TextEncoder().encode(pw);
  const hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  const hashHex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
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
  $('#admin-panel').style.display = 'block';
  loadSection('users');
}

$('#admin-logout-btn').addEventListener('click', () => {
  adminToken = ''; sessionStorage.removeItem('admin_token');
  location.reload();
});

$$('.sidebar-item').forEach(item => {
  item.addEventListener('click', () => {
    $$('.sidebar-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    loadSection(item.dataset.section);
  });
});

function loadSection(section) {
  currentSection = section;
  const main = $('#admin-main');
  main.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  const map = { users: renderUsers, forums: renderForums, books: renderBooks, groups: renderGroups, levels: renderLevels, tags: renderTags, logs: renderLogs, settings: renderSettings };
  if (map[section]) map[section](main);
}

async function renderUsers(main) {
  let users = [];
  try { users = await adminApi('/users'); } catch (e) { main.innerHTML = `<div class="page-title">Kullanıcılar</div><p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="section-bar">
      <div class="page-title" style="margin:0">Kullanıcılar <span style="font-size:14px;color:var(--text-muted)">(${users.length})</span></div>
      <input type="text" id="user-search" placeholder="Ara..." style="max-width:220px" />
    </div>
    <div class="card">
      <div class="table-wrap">
        <table id="users-table">
          <thead><tr><th>ID</th><th>Kullanıcı Adı</th><th>E-posta</th><th>Seviye</th><th>Forum</th><th>Kitap</th><th>Yorum</th><th>IP</th><th>Kayıt</th><th>Son Aktif</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody id="users-tbody"></tbody>
        </table>
      </div>
    </div>`;

  renderUsersTable(users);
  $('#user-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderUsersTable(users.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.ip || '').includes(q)));
  });
}

function renderUsersTable(users) {
  const tbody = $('#users-tbody'); if (!tbody) return;
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:32px">Kullanıcı bulunamadı</td></tr>'; return; }
  tbody.innerHTML = users.map(u => `<tr>
    <td style="color:var(--text-muted)">#${u.id}</td>
    <td><strong>${escHtml(u.username)}</strong> ${u.is_vip ? '<span class="badge badge-orange">VIP</span>' : ''} ${u.is_plus ? '<span class="badge badge-gray">Plus</span>' : ''}</td>
    <td style="color:var(--text-secondary)">${escHtml(u.email)}</td>
    <td>${u.level_id || 1}</td>
    <td>${u.forum_count}</td>
    <td>${u.book_count}</td>
    <td>${u.comment_count}</td>
    <td style="font-size:11px;color:var(--text-muted)">${escHtml(u.ip || '-')}</td>
    <td style="font-size:11px">${timeAgo(u.created_at)}</td>
    <td style="font-size:11px">${timeAgo(u.last_active)}</td>
    <td>${u.banned ? '<span class="badge badge-red"><i class="fas fa-ban"></i> Banlı</span>' : '<span class="badge badge-green">Aktif</span>'}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm edit-user-btn" data-id="${u.id}"><i class="fas fa-edit"></i></button>
        ${u.banned ? `<button class="btn btn-ghost btn-sm unban-user-btn" data-id="${u.id}" title="Ban Kaldır" style="color:#4ade80"><i class="fas fa-unlock"></i></button>` : `<button class="btn btn-ghost btn-sm ban-user-btn" data-id="${u.id}" title="Banla" style="color:var(--accent-red2)"><i class="fas fa-ban"></i></button>`}
        <button class="btn btn-danger btn-sm del-user-btn" data-id="${u.id}"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.edit-user-btn');
    const ban = e.target.closest('.ban-user-btn');
    const unban = e.target.closest('.unban-user-btn');
    const del = e.target.closest('.del-user-btn');

    if (edit) {
      const id = edit.dataset.id;
      const user = users.find(u => u.id == id);
      if (!user) return;
      showEditUserModal(user);
    }
    if (ban) {
      const id = ban.dataset.id;
      showBanModal(id);
    }
    if (unban) {
      const id = unban.dataset.id;
      if (!confirm('Ban kaldırılsın mı?')) return;
      try { await adminApi('/user/' + id + '/unban', { method: 'POST' }); toast('Ban kaldırıldı'); loadSection('users'); } catch (e) { toast(e.message, 'error'); }
    }
    if (del) {
      const id = del.dataset.id;
      if (!confirm('Kullanıcı kalıcı olarak silinsin mi?')) return;
      try { await adminApi('/user/' + id, { method: 'DELETE' }); toast('Kullanıcı silindi'); loadSection('users'); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

function showEditUserModal(user) {
  showModal('Kullanıcı Düzenle - ' + user.username, `
    <div class="form-row">
      <div class="form-group"><label>Kullanıcı Adı</label><input id="eu-username" type="text" value="${escHtml(user.username)}" /></div>
      <div class="form-group"><label>E-posta</label><input id="eu-email" type="email" value="${escHtml(user.email)}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Yeni Şifre (boş bırak = değişme)</label><input id="eu-pw" type="password" placeholder="••••••" /></div>
      <div class="form-group"><label>Seviye ID</label><input id="eu-level" type="number" value="${user.level_id || 1}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>İsim Rengi</label><input id="eu-color" type="color" value="${user.name_color || '#f5f5f5'}" style="height:38px;cursor:pointer" /></div>
      <div></div>
    </div>
    <div class="form-group">
      <label class="checkbox-label"><input type="checkbox" id="eu-vip" ${user.is_vip ? 'checked' : ''} /> VIP</label>
      <label class="checkbox-label" style="margin-top:6px"><input type="checkbox" id="eu-plus" ${user.is_plus ? 'checked' : ''} /> Plus</label>
    </div>
    <button class="btn btn-primary" id="eu-submit" style="width:100%">Kaydet</button>
    <div id="eu-error" class="form-error" style="margin-top:8px"></div>
  `);
  $('#eu-submit').addEventListener('click', async () => {
    const body = {
      username: $('#eu-username').value.trim(),
      email: $('#eu-email').value.trim(),
      is_vip: $('#eu-vip').checked,
      is_plus: $('#eu-plus').checked,
      name_color: $('#eu-color').value,
      level_id: parseInt($('#eu-level').value) || 1,
    };
    const pw = $('#eu-pw').value;
    if (pw) body.password = pw;
    try {
      await adminApi('/user/' + user.id, { method: 'PUT', body: JSON.stringify(body) });
      toast('Kullanıcı güncellendi'); hideModal(); loadSection('users');
    } catch (e) { $('#eu-error').textContent = e.message; }
  });
}

function showBanModal(userId) {
  showModal('Kullanıcıyı Banla', `
    <div class="form-group"><label>Ban Türü</label>
      <select id="ban-type">
        <option value="soft">Soft Ban (hesap kilitli)</option>
        <option value="ip">IP Ban (IP adresi engeli)</option>
      </select>
    </div>
    <button class="btn btn-danger" id="ban-submit" style="width:100%"><i class="fas fa-ban"></i> Banla</button>
    <div id="ban-error" class="form-error" style="margin-top:8px"></div>
  `);
  $('#ban-submit').addEventListener('click', async () => {
    const ban_type = $('#ban-type').value;
    try {
      await adminApi('/user/' + userId + '/ban', { method: 'POST', body: JSON.stringify({ ban_type }) });
      toast('Kullanıcı banlandı'); hideModal(); loadSection('users');
    } catch (e) { $('#ban-error').textContent = e.message; }
  });
}

async function renderForums(main) {
  let forums = [];
  try { forums = await adminApi('/forums'); } catch (e) { main.innerHTML = `<div class="page-title">Konular</div><p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="section-bar">
      <div class="page-title" style="margin:0">Konular <span style="font-size:14px;color:var(--text-muted)">(${forums.length})</span></div>
      <input type="text" id="forum-search" placeholder="Ara..." style="max-width:220px" />
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Başlık</th><th>Yazar</th><th>Görüntülenme</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="forums-tbody"></tbody>
        </table>
      </div>
    </div>`;

  renderForumsTable(forums);
  $('#forum-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderForumsTable(forums.filter(f => f.title.toLowerCase().includes(q) || (f.username || '').toLowerCase().includes(q)));
  });
}

function renderForumsTable(forums) {
  const tbody = $('#forums-tbody'); if (!tbody) return;
  if (!forums.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">Konu yok</td></tr>'; return; }
  tbody.innerHTML = forums.map(f => `<tr>
    <td style="color:var(--text-muted)">#${f.id}</td>
    <td><a href="/forum/${escHtml(f.slug)}" target="_blank" style="color:var(--accent-red2)">${escHtml(f.title.substring(0, 60))}${f.title.length > 60 ? '...' : ''}</a></td>
    <td>${escHtml(f.username || 'Silindi')}</td>
    <td>${f.views || 0}</td>
    <td style="font-size:11px">${timeAgo(f.created_at)}</td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-outline btn-sm edit-forum-btn" data-id="${f.id}"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm del-forum-btn" data-id="${f.id}"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.edit-forum-btn');
    const del = e.target.closest('.del-forum-btn');
    if (edit) {
      const id = edit.dataset.id;
      const forum = forums.find(f => f.id == id);
      if (!forum) return;
      showModal('Konu Düzenle', `
        <div class="form-group"><label>Başlık</label><input id="ef-title" type="text" value="${escHtml(forum.title)}" /></div>
        <div class="form-group"><label>İçerik</label><textarea id="ef-content" rows="8">${escHtml(forum.content)}</textarea></div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="ef-comments" ${forum.allow_comments ? 'checked' : ''} /> Yorumlara izin ver</label></div>
        <button class="btn btn-primary" id="ef-submit" style="width:100%">Kaydet</button>
        <div id="ef-error" class="form-error" style="margin-top:8px"></div>
      `);
      $('#ef-submit').addEventListener('click', async () => {
        try {
          await adminApi('/forum/' + id, { method: 'PUT', body: JSON.stringify({ title: $('#ef-title').value.trim(), content: $('#ef-content').value.trim(), allow_comments: $('#ef-comments').checked }) });
          toast('Konu güncellendi'); hideModal(); loadSection('forums');
        } catch (e) { $('#ef-error').textContent = e.message; }
      });
    }
    if (del) {
      if (!confirm('Konu silinsin mi?')) return;
      try { await adminApi('/forum/' + del.dataset.id, { method: 'DELETE' }); toast('Konu silindi'); loadSection('forums'); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

async function renderBooks(main) {
  let books = [];
  try { books = await adminApi('/books'); } catch (e) { main.innerHTML = `<div class="page-title">Kitaplar</div><p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="section-bar">
      <div class="page-title" style="margin:0">Kitaplar <span style="font-size:14px;color:var(--text-muted)">(${books.length})</span></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Başlık</th><th>Yazar</th><th>Sayfa</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="books-tbody"></tbody>
        </table>
      </div>
    </div>`;

  const tbody = $('#books-tbody');
  if (!books.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">Kitap yok</td></tr>'; return; }
  tbody.innerHTML = books.map(b => `<tr>
    <td style="color:var(--text-muted)">#${b.id}</td>
    <td><a href="/kitap/${escHtml(b.slug)}" target="_blank" style="color:var(--accent-red2)">${escHtml(b.title.substring(0, 60))}</a></td>
    <td>${escHtml(b.username || 'Silindi')}</td>
    <td>${b.page_count}</td>
    <td style="font-size:11px">${timeAgo(b.created_at)}</td>
    <td><button class="btn btn-danger btn-sm del-book-btn" data-id="${b.id}"><i class="fas fa-trash"></i></button></td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const del = e.target.closest('.del-book-btn');
    if (del) {
      if (!confirm('Kitap ve tüm sayfaları silinsin mi?')) return;
      try { await adminApi('/book/' + del.dataset.id, { method: 'DELETE' }); toast('Kitap silindi'); loadSection('books'); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

async function renderGroups(main) {
  let groups = [];
  try { groups = await adminApi('/groups'); } catch (e) { main.innerHTML = `<div class="page-title">Gruplar</div><p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="section-bar">
      <div class="page-title" style="margin:0">Gruplar <span style="font-size:14px;color:var(--text-muted)">(${groups.length})</span></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>İsim</th><th>Tür</th><th>Sahip</th><th>Üye</th><th>Tarih</th><th>İşlem</th></tr></thead>
          <tbody id="groups-tbody"></tbody>
        </table>
      </div>
    </div>`;

  const tbody = $('#groups-tbody');
  if (!groups.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px">Grup yok</td></tr>'; return; }
  tbody.innerHTML = groups.map(g => `<tr>
    <td style="color:var(--text-muted)">#${g.id}</td>
    <td><a href="/grup/${escHtml(g.slug)}" target="_blank" style="color:var(--accent-red2)">${escHtml(g.name)}</a></td>
    <td>${g.type === 'private' ? '<span class="badge badge-red">Özel</span>' : '<span class="badge badge-green">Açık</span>'}</td>
    <td>${escHtml(g.owner_name || 'Silindi')}</td>
    <td>${g.member_count}</td>
    <td style="font-size:11px">${timeAgo(g.created_at)}</td>
    <td><button class="btn btn-danger btn-sm del-group-btn" data-id="${g.id}"><i class="fas fa-trash"></i></button></td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const del = e.target.closest('.del-group-btn');
    if (del) {
      if (!confirm('Grup ve tüm içeriği silinsin mi?')) return;
      try { await adminApi('/group/' + del.dataset.id, { method: 'DELETE' }); toast('Grup silindi'); loadSection('groups'); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

async function renderLevels(main) {
  let levels = [];
  try { levels = await adminApi('/levels'); } catch (e) { main.innerHTML = `<p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="section-bar">
      <div class="page-title" style="margin:0">Seviyeler</div>
      <button class="btn btn-primary btn-sm" id="add-level-btn"><i class="fas fa-plus"></i> Ekle</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>İkon</th><th>İsim</th><th>Renk</th><th>Min Forum</th><th>Min Kitap</th><th>Min Yorum</th><th>Sıra</th><th>İşlem</th></tr></thead>
          <tbody id="levels-tbody"></tbody>
        </table>
      </div>
    </div>`;

  renderLevelsTable(levels);

  $('#add-level-btn').addEventListener('click', () => showLevelModal(null, () => loadSection('levels')));
}

function renderLevelsTable(levels) {
  const tbody = $('#levels-tbody'); if (!tbody) return;
  if (!levels.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:32px">Seviye yok</td></tr>'; return; }
  tbody.innerHTML = levels.map(l => `<tr>
    <td style="color:var(--text-muted)">#${l.id}</td>
    <td><i class="${escHtml(l.icon)}" style="color:${escHtml(l.color)};font-size:16px"></i></td>
    <td><strong style="color:${escHtml(l.color)}">${escHtml(l.name)}</strong></td>
    <td><div style="width:22px;height:22px;border-radius:50%;background:${escHtml(l.color)};display:inline-block"></div> ${escHtml(l.color)}</td>
    <td>${l.min_forums >= 9999999 ? '∞' : l.min_forums}</td>
    <td>${l.min_books >= 9999999 ? '∞' : l.min_books}</td>
    <td>${l.min_comments >= 9999999 ? '∞' : l.min_comments}</td>
    <td>${l.order_num}</td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-outline btn-sm edit-level-btn" data-id="${l.id}"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm del-level-btn" data-id="${l.id}"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.edit-level-btn');
    const del = e.target.closest('.del-level-btn');
    if (edit) {
      const level = levels.find(l => l.id == edit.dataset.id);
      if (level) showLevelModal(level, () => loadSection('levels'));
    }
    if (del) {
      if (!confirm('Seviye silinsin mi?')) return;
      try { await adminApi('/level/' + del.dataset.id, { method: 'DELETE' }); toast('Seviye silindi'); loadSection('levels'); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

const ALL_FA_ICONS = ['fas fa-star','fas fa-fire','fas fa-crown','fas fa-gem','fas fa-dragon','fas fa-shield-alt','fas fa-bolt','fas fa-seedling','fas fa-pen','fas fa-book','fas fa-trophy','fas fa-medal','fas fa-rocket','fas fa-skull','fas fa-chess-queen','fas fa-fist-raised','fas fa-leaf','fas fa-feather','fas fa-eye','fas fa-infinity','fas fa-atom','fas fa-brain','fas fa-heart','fas fa-sun','fas fa-moon','fas fa-dove','fas fa-paw','fas fa-anchor','fas fa-flask','fas fa-code','fas fa-terminal','fas fa-key','fas fa-hat-wizard','fas fa-sword','fas fa-magic','fas fa-wand-magic-sparkles','fas fa-chess-king','fas fa-chess-knight','fas fa-chess-rook','fas fa-chess-bishop','fas fa-chess-pawn','fas fa-ghost','fas fa-cat','fas fa-dog','fas fa-horse','fas fa-dragon','fas fa-crow','fas fa-spider','fas fa-fish','fas fa-frog','fas fa-hippo','fas fa-kiwi-bird','fas fa-otter','fas fa-mountain','fas fa-tree','fas fa-snowflake','fas fa-cloud','fas fa-cloud-bolt','fas fa-rainbow','fas fa-tornado','fas fa-wind','fas fa-fire-flame-curved','fas fa-volcano','fas fa-ice-cream','fas fa-pizza-slice','fas fa-coffee','fas fa-beer-mug-empty','fas fa-wine-glass','fas fa-mug-hot','fas fa-candy-cane','fas fa-lemon','fas fa-apple-whole','fas fa-carrot','fas fa-pepper-hot','fas fa-person','fas fa-person-running','fas fa-person-swimming','fas fa-person-biking','fas fa-person-skating','fas fa-person-skiing','fas fa-dumbbell','fas fa-baseball','fas fa-basketball','fas fa-football','fas fa-soccer-ball','fas fa-tennis-ball','fas fa-volleyball','fas fa-golf-ball-tee','fas fa-table-tennis-paddle-ball','fas fa-gamepad','fas fa-dice','fas fa-dice-d6','fas fa-dice-d20','fas fa-puzzle-piece','fas fa-chess','fas fa-guitar','fas fa-music','fas fa-headphones','fas fa-microphone','fas fa-drum','fas fa-piano','fas fa-trumpet','fas fa-violin','fas fa-palette','fas fa-paintbrush','fas fa-pencil','fas fa-eraser','fas fa-scissors','fas fa-ruler','fas fa-compass','fas fa-glasses','fas fa-binoculars','fas fa-telescope','fas fa-microscope','fas fa-flask-vial','fas fa-dna','fas fa-bacteria','fas fa-virus','fas fa-capsules','fas fa-pills','fas fa-syringe','fas fa-stethoscope','fas fa-heartbeat','fas fa-hospital','fas fa-cross','fas fa-hands-praying','fas fa-place-of-worship','fas fa-moon','fas fa-star-and-crescent','fas fa-yin-yang','fas fa-om','fas fa-khanda','fas fa-menorah','fas fa-torah','fas fa-church','fas fa-mosque','fas fa-synagogue','fas fa-robot','fas fa-microchip','fas fa-cpu','fas fa-laptop','fas fa-mobile','fas fa-tablet','fas fa-desktop','fas fa-keyboard','fas fa-mouse','fas fa-printer','fas fa-camera','fas fa-video','fas fa-tv','fas fa-radio','fas fa-satellite','fas fa-wifi','fas fa-signal','fas fa-bluetooth','fas fa-battery-full','fas fa-plug','fas fa-lightbulb','fas fa-flashlight','fas fa-magnifying-glass','fas fa-fingerprint','fas fa-lock','fas fa-unlock','fas fa-shield','fas fa-user-secret','fas fa-mask','fas fa-eye-slash','fas fa-user-ninja','fas fa-car','fas fa-truck','fas fa-bicycle','fas fa-motorcycle','fas fa-plane','fas fa-ship','fas fa-train','fas fa-bus','fas fa-helicopter','fas fa-rocket','fas fa-space-shuttle','fas fa-satellite-dish','fas fa-globe','fas fa-map','fas fa-location-dot','fas fa-compass-drafting','fas fa-flag','fas fa-flag-usa','fas fa-building','fas fa-house','fas fa-city','fas fa-bridge','fas fa-monument','fas fa-landmark','fas fa-university','fas fa-school','fas fa-store','fas fa-warehouse','fas fa-industry','fas fa-hammer','fas fa-wrench','fas fa-screwdriver','fas fa-gear','fas fa-gears','fas fa-toolbox','fas fa-box','fas fa-box-open','fas fa-boxes-stacked','fas fa-archive','fas fa-trash','fas fa-recycle','fas fa-coins','fas fa-dollar-sign','fas fa-euro-sign','fas fa-bitcoin-sign','fas fa-wallet','fas fa-credit-card','fas fa-money-bill','fas fa-piggy-bank','fas fa-chart-line','fas fa-chart-bar','fas fa-chart-pie','fas fa-trending-up','fas fa-arrow-up','fas fa-arrow-down','fas fa-arrows-alt','fas fa-expand','fas fa-compress','fas fa-plus','fas fa-minus','fas fa-times','fas fa-check','fas fa-question','fas fa-exclamation','fas fa-info','fas fa-bell','fas fa-envelope','fas fa-paper-plane','fas fa-comment','fas fa-comments','fas fa-quote-left','fas fa-quote-right','fas fa-hashtag','fas fa-at','fas fa-link','fas fa-share','fas fa-bookmark','fas fa-tag','fas fa-tags','fas fa-thumbs-up','fas fa-thumbs-down','fas fa-hand-peace','fas fa-hand-point-right','fas fa-handshake','fas fa-hands-helping','fas fa-clap','fas fa-award','fas fa-certificate','fas fa-graduation-cap','fas fa-user-graduate','fas fa-chalkboard-teacher','fas fa-book-open','fas fa-journal-whills','fas fa-scroll','fas fa-feather-alt','fas fa-quill','fas fa-pen-nib','fas fa-signature','fas fa-stamp','fas fa-newspaper','fas fa-photo-film','fas fa-film','fas fa-clapperboard','fas fa-masks-theater','fas fa-ticket','fas fa-calendar','fas fa-clock','fas fa-hourglass','fas fa-stopwatch','fas fa-timer','fas fa-history','fas fa-undo','fas fa-redo','fas fa-sync'];

function showLevelModal(level, cb) {
  const isInfMin = (val) => val === -1 || val === 9999999;
  const infVal = (v) => v === -1 || v === 9999999 ? '∞' : v;

  showModal(level ? 'Seviye Düzenle' : 'Yeni Seviye', `
    <div class="form-row">
      <div class="form-group"><label>İsim</label><input id="lv-name" type="text" value="${level ? escHtml(level.name) : ''}" /></div>
      <div class="form-group">
        <label>İkon</label>
        <input id="lv-icon" type="text" value="${level ? escHtml(level.icon) : 'fas fa-star'}" placeholder="fas fa-star" style="margin-bottom:6px" />
        <input id="lv-icon-search" type="text" placeholder="İkon ara... (star, fire, crown...)" style="margin-bottom:6px" />
        <div id="lv-icon-grid" style="display:flex;flex-wrap:wrap;gap:5px;max-height:180px;overflow-y:auto;background:var(--bg-card2);padding:8px;border-radius:8px;border:1px solid var(--border)"></div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Renk</label><input id="lv-color" type="color" value="${level ? level.color : '#dc2626'}" style="height:38px;cursor:pointer" /></div>
      <div class="form-group"><label>Sıra</label><input id="lv-order" type="number" value="${level ? level.order_num : 0}" /></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group">
        <label>Min Konu</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="lv-forums" type="number" min="0" value="${level ? (isInfMin(level.min_forums) ? '' : level.min_forums) : 0}" placeholder="0" style="flex:1" />
          <button type="button" id="lv-forums-inf" title="Sonsuz" style="background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text-secondary);font-size:16px;flex-shrink:0;transition:all 0.15s" class="${level && isInfMin(level.min_forums) ? 'inf-active' : ''}">∞</button>
        </div>
      </div>
      <div class="form-group">
        <label>Min Kitap</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="lv-books" type="number" min="0" value="${level ? (isInfMin(level.min_books) ? '' : level.min_books) : 0}" placeholder="0" style="flex:1" />
          <button type="button" id="lv-books-inf" title="Sonsuz" style="background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text-secondary);font-size:16px;flex-shrink:0;transition:all 0.15s" class="${level && isInfMin(level.min_books) ? 'inf-active' : ''}">∞</button>
        </div>
      </div>
      <div class="form-group">
        <label>Min Kitap Sayfası</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="lv-bookpages" type="number" min="0" value="${level ? (isInfMin(level.min_book_pages || 0) ? '' : (level.min_book_pages || 0)) : 0}" placeholder="0" style="flex:1" />
          <button type="button" id="lv-bookpages-inf" title="Sonsuz" style="background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text-secondary);font-size:16px;flex-shrink:0;transition:all 0.15s" class="${level && isInfMin(level.min_book_pages || 0) ? 'inf-active' : ''}">∞</button>
        </div>
      </div>
      <div class="form-group">
        <label>Min Yorum</label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="lv-comments" type="number" min="0" value="${level ? (isInfMin(level.min_comments) ? '' : level.min_comments) : 0}" placeholder="0" style="flex:1" />
          <button type="button" id="lv-comments-inf" title="Sonsuz" style="background:var(--bg-card2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text-secondary);font-size:16px;flex-shrink:0;transition:all 0.15s" class="${level && isInfMin(level.min_comments) ? 'inf-active' : ''}">∞</button>
        </div>
      </div>
      <div class="form-group" style="align-self:end">
        <label style="margin-bottom:8px">Koşul Türü</label>
        <label class="checkbox-label" style="font-size:13px">
          <input type="checkbox" id="lv-require-any" ${level && level.require_any ? 'checked' : ''} />
          Herhangi biri yeterli (VEYA)
        </label>
      </div>
    </div>
    <div style="margin-top:4px;padding:10px;background:rgba(220,38,38,0.05);border-radius:8px;border:1px solid rgba(220,38,38,0.15)">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;font-weight:600">Günlük Limit (Normal Üye / VIP / Plus) — -1 = Sınırsız</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div>
          <label style="font-size:11px">Konu / gün</label>
          <div style="display:flex;gap:4px">
            <input id="lv-dlimit-forums" type="number" min="-1" value="${level ? (level.daily_forums ?? -1) : -1}" placeholder="-1" title="Normal" />
            <input id="lv-dlimit-forums-vip" type="number" min="-1" value="${level ? (level.daily_forums_vip ?? -1) : -1}" placeholder="-1" title="VIP" style="border-color:rgba(251,191,36,0.4)" />
            <input id="lv-dlimit-forums-plus" type="number" min="-1" value="${level ? (level.daily_forums_plus ?? -1) : -1}" placeholder="-1" title="Plus" style="border-color:rgba(129,140,248,0.4)" />
          </div>
        </div>
        <div>
          <label style="font-size:11px">Kitap / gün</label>
          <div style="display:flex;gap:4px">
            <input id="lv-dlimit-books" type="number" min="-1" value="${level ? (level.daily_books ?? -1) : -1}" placeholder="-1" />
            <input id="lv-dlimit-books-vip" type="number" min="-1" value="${level ? (level.daily_books_vip ?? -1) : -1}" placeholder="-1" style="border-color:rgba(251,191,36,0.4)" />
            <input id="lv-dlimit-books-plus" type="number" min="-1" value="${level ? (level.daily_books_plus ?? -1) : -1}" placeholder="-1" style="border-color:rgba(129,140,248,0.4)" />
          </div>
        </div>
        <div>
          <label style="font-size:11px">Sayfa / gün</label>
          <div style="display:flex;gap:4px">
            <input id="lv-dlimit-pages" type="number" min="-1" value="${level ? (level.daily_book_pages ?? -1) : -1}" placeholder="-1" />
            <input id="lv-dlimit-pages-vip" type="number" min="-1" value="${level ? (level.daily_book_pages_vip ?? -1) : -1}" placeholder="-1" style="border-color:rgba(251,191,36,0.4)" />
            <input id="lv-dlimit-pages-plus" type="number" min="-1" value="${level ? (level.daily_book_pages_plus ?? -1) : -1}" placeholder="-1" style="border-color:rgba(129,140,248,0.4)" />
          </div>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-top:4px;font-size:10px;color:var(--text-muted)">
        <span>Normal (siyah)</span>
        <span style="color:#fbbf24">VIP (sarı)</span>
        <span style="color:#818cf8">Plus (mor)</span>
      </div>
    </div>
    <div style="margin-top:8px;padding:10px;background:var(--bg-card2);border-radius:8px;display:flex;align-items:center;gap:10px">
      <i id="lv-preview-icon" class="${level ? level.icon : 'fas fa-star'}" style="color:${level ? level.color : '#dc2626'};font-size:20px"></i>
      <span id="lv-preview-name" style="font-weight:600;color:${level ? level.color : '#dc2626'}">${level ? level.name : 'Önizleme'}</span>
    </div>
    <button class="btn btn-primary" id="lv-submit" style="width:100%;margin-top:16px">${level ? 'Güncelle' : 'Ekle'}</button>
    <div id="lv-error" class="form-error" style="margin-top:8px"></div>
  `);

  const style = document.createElement('style');
  style.textContent = '.inf-active { color: var(--accent-red2) !important; border-color: var(--accent-red) !important; background: rgba(220,38,38,0.12) !important; }';
  document.head.appendChild(style);

  function renderIconGrid(filter) {
    const grid = $('#lv-icon-grid'); if (!grid) return;
    const filtered = filter ? ALL_FA_ICONS.filter(ic => ic.includes(filter.toLowerCase())) : ALL_FA_ICONS;
    grid.innerHTML = filtered.map(ic =>
      `<button type="button" title="${ic}" style="background:none;border:1px solid var(--border);border-radius:6px;padding:6px 8px;cursor:pointer;color:var(--text-secondary);font-size:16px;transition:all 0.15s;min-width:36px" onclick="document.getElementById('lv-icon').value='${ic}';document.getElementById('lv-icon').dispatchEvent(new Event('input'))"><i class="${ic}"></i></button>`
    ).join('');
  }
  renderIconGrid('');

  $('#lv-icon-search').addEventListener('input', e => renderIconGrid(e.target.value.trim()));

  ['lv-name', 'lv-icon', 'lv-color'].forEach(id => {
    $('#' + id)?.addEventListener('input', () => {
      const icon = $('#lv-icon').value; const color = $('#lv-color').value; const name = $('#lv-name').value;
      $('#lv-preview-icon').className = icon; $('#lv-preview-icon').style.color = color;
      $('#lv-preview-name').textContent = name || 'Önizleme'; $('#lv-preview-name').style.color = color;
    });
  });

  ['forums','books','bookpages','comments'].forEach(f => {
    const btn = $(`#lv-${f}-inf`);
    const inp = $(`#lv-${f}`);
    if (!btn || !inp) return;
    btn.addEventListener('click', () => {
      if (btn.classList.contains('inf-active')) {
        btn.classList.remove('inf-active'); inp.disabled = false; inp.value = 0;
      } else {
        btn.classList.add('inf-active'); inp.disabled = true; inp.value = '';
      }
    });
  });

  $('#lv-submit').addEventListener('click', async () => {
    const getVal = (id) => {
      const btn = $(`#${id}-inf`);
      if (btn && btn.classList.contains('inf-active')) return 9999999;
      return parseInt($(`#${id}`).value) || 0;
    };
    const body = {
      name: $('#lv-name').value.trim(),
      icon: $('#lv-icon').value.trim(),
      color: $('#lv-color').value,
      min_forums: getVal('lv-forums'),
      min_books: getVal('lv-books'),
      min_book_pages: getVal('lv-bookpages'),
      min_comments: getVal('lv-comments'),
      require_any: $('#lv-require-any').checked ? 1 : 0,
      order_num: parseInt($('#lv-order').value) || 0,
      daily_forums: parseInt($('#lv-dlimit-forums').value) ?? -1,
      daily_books: parseInt($('#lv-dlimit-books').value) ?? -1,
      daily_book_pages: parseInt($('#lv-dlimit-pages').value) ?? -1,
      daily_forums_vip: parseInt($('#lv-dlimit-forums-vip').value) ?? -1,
      daily_books_vip: parseInt($('#lv-dlimit-books-vip').value) ?? -1,
      daily_book_pages_vip: parseInt($('#lv-dlimit-pages-vip').value) ?? -1,
      daily_forums_plus: parseInt($('#lv-dlimit-forums-plus').value) ?? -1,
      daily_books_plus: parseInt($('#lv-dlimit-books-plus').value) ?? -1,
      daily_book_pages_plus: parseInt($('#lv-dlimit-pages-plus').value) ?? -1,
    };
    if (!body.name) { $('#lv-error').textContent = 'İsim zorunlu'; return; }
    try {
      if (level) await adminApi('/level/' + level.id, { method: 'PUT', body: JSON.stringify(body) });
      else await adminApi('/levels', { method: 'POST', body: JSON.stringify(body) });
      toast(level ? 'Seviye güncellendi' : 'Seviye eklendi'); hideModal(); cb && cb();
    } catch (e) { $('#lv-error').textContent = e.message; }
  });
}

async function renderTags(main) {
  let tags = [];
  try { tags = await adminApi('/tags'); } catch (e) { main.innerHTML = `<p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="section-bar">
      <div class="page-title" style="margin:0">Konu Türleri</div>
      <button class="btn btn-primary btn-sm" id="add-tag-btn"><i class="fas fa-plus"></i> Ekle</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>İsim</th><th>Renk</th><th>Kullanım</th><th>İşlem</th></tr></thead>
          <tbody id="tags-tbody"></tbody>
        </table>
      </div>
    </div>`;

  renderTagsTable(tags);

  $('#add-tag-btn').addEventListener('click', () => showTagModal(null, () => loadSection('tags')));
}

function renderTagsTable(tags) {
  const tbody = $('#tags-tbody'); if (!tbody) return;
  if (!tags.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">Tag yok</td></tr>'; return; }
  tbody.innerHTML = tags.map(t => `<tr>
    <td style="color:var(--text-muted)">#${t.id}</td>
    <td><span class="badge" style="background:${escHtml(t.color)};padding:4px 10px;border-radius:4px">${escHtml(t.name)}</span></td>
    <td><div style="display:flex;align-items:center;gap:8px"><div style="width:22px;height:22px;border-radius:50%;background:${escHtml(t.color)}"></div>${escHtml(t.color)}</div></td>
    <td>${t.is_system ? '<span class="badge badge-green">Sistem</span>' : '<span class="badge badge-gray">Özel</span>'}</td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-outline btn-sm edit-tag-btn" data-id="${t.id}"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm del-tag-btn" data-id="${t.id}"><i class="fas fa-trash"></i></button>
      </div>
    </td>
  </tr>`).join('');

  tbody.addEventListener('click', async e => {
    const edit = e.target.closest('.edit-tag-btn');
    const del = e.target.closest('.del-tag-btn');
    if (edit) {
      const tag = tags.find(t => t.id == edit.dataset.id);
      if (tag) showTagModal(tag, () => loadSection('tags'));
    }
    if (del) {
      if (!confirm('Tag silinsin mi?')) return;
      try { await adminApi('/tag/' + del.dataset.id, { method: 'DELETE' }); toast('Tag silindi'); loadSection('tags'); } catch (e) { toast(e.message, 'error'); }
    }
  });
}

function showTagModal(tag, cb) {
  showModal(tag ? 'Tag Düzenle' : 'Yeni Tag', `
    <div class="form-row">
      <div class="form-group"><label>İsim</label><input id="tag-name" type="text" value="${tag ? escHtml(tag.name) : ''}" /></div>
      <div class="form-group"><label>Renk</label><input id="tag-color" type="color" value="${tag ? tag.color : '#dc2626'}" style="height:38px;cursor:pointer" /></div>
    </div>
    <div style="margin-top:12px;padding:12px;background:var(--bg-card2);border-radius:8px;display:flex;align-items:center;gap:10px">
      <span id="tag-preview" class="badge" style="background:${tag ? tag.color : '#dc2626'};padding:4px 10px;border-radius:4px;font-size:13px">${tag ? tag.name : 'Önizleme'}</span>
    </div>
    <button class="btn btn-primary" id="tag-submit" style="width:100%;margin-top:16px">${tag ? 'Güncelle' : 'Ekle'}</button>
    <div id="tag-error" class="form-error" style="margin-top:8px"></div>
  `);

  ['tag-name', 'tag-color'].forEach(id => {
    $('#' + id)?.addEventListener('input', () => {
      const name = $('#tag-name').value; const color = $('#tag-color').value;
      const preview = $('#tag-preview');
      preview.textContent = name || 'Önizleme';
      preview.style.background = color;
    });
  });

  $('#tag-submit').addEventListener('click', async () => {
    const body = { name: $('#tag-name').value.trim(), color: $('#tag-color').value };
    if (!body.name) { $('#tag-error').textContent = 'İsim zorunlu'; return; }
    try {
      if (tag) await adminApi('/tag/' + tag.id, { method: 'PUT', body: JSON.stringify(body) });
      else await adminApi('/tags', { method: 'POST', body: JSON.stringify(body) });
      toast(tag ? 'Tag güncellendi' : 'Tag eklendi'); hideModal(); cb && cb();
    } catch (e) { $('#tag-error').textContent = e.message; }
  });
}

async function renderLogs(main) {
  let logs = [];
  try { logs = await adminApi('/logs'); } catch (e) { main.innerHTML = `<p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="section-bar">
      <div class="page-title" style="margin:0">Sistem Logları <span style="font-size:14px;color:var(--text-muted)">(${logs.length})</span></div>
      <input type="text" id="log-search" placeholder="Ara..." style="max-width:220px" />
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tarih</th><th>Aktör</th><th>İşlem</th><th>Hedef</th><th>IP</th><th>Detay</th></tr></thead>
          <tbody id="logs-tbody"></tbody>
        </table>
      </div>
    </div>`;

  renderLogsTable(logs);
  $('#log-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderLogsTable(logs.filter(l => (l.actor || '').toLowerCase().includes(q) || (l.action || '').toLowerCase().includes(q) || (l.target || '').toLowerCase().includes(q)));
  });
}

function renderLogsTable(logs) {
  const tbody = $('#logs-tbody'); if (!tbody) return;
  if (!logs.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">Log yok</td></tr>'; return; }
  const actionColors = { ban_user: 'badge-red', delete_user: 'badge-red', delete_forum: 'badge-orange', delete_book: 'badge-orange', delete_group: 'badge-orange', login: 'badge-green', register: 'badge-green', create_forum: 'badge-gray', create_book: 'badge-gray', create_group: 'badge-gray' };
  tbody.innerHTML = logs.map(l => `<tr>
    <td style="font-size:11px;white-space:nowrap">${formatDate(l.created_at)}</td>
    <td><strong>${escHtml(l.actor || '-')}</strong></td>
    <td><span class="badge ${actionColors[l.action] || 'badge-gray'}">${escHtml(l.action)}</span></td>
    <td style="color:var(--text-secondary)">${escHtml(l.target || '-')}</td>
    <td style="font-size:11px;color:var(--text-muted)">${escHtml(l.ip || '-')}</td>
    <td style="color:var(--text-secondary);font-size:12px">${escHtml(l.detail || '-')}</td>
  </tr>`).join('');
}

async function renderSettings(main) {
  let settings = {};
  try { settings = await adminApi('/settings'); } catch (e) { main.innerHTML = `<p style="color:var(--accent-red2)">${e.message}</p>`; return; }

  main.innerHTML = `
    <div class="page-title">Ayarlar</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div class="card">
        <div class="card-header">Admin Şifresi</div>
        <div class="card-body">
          <div class="form-group"><label>Yeni Admin Şifresi</label><input type="password" id="new-admin-pw" placeholder="••••••" /></div>
          <div class="form-group"><label>Şifre Tekrar</label><input type="password" id="new-admin-pw2" placeholder="••••••" /></div>
          <button class="btn btn-primary" id="save-admin-pw">Değiştir</button>
          <div id="apw-msg" class="form-error" style="margin-top:8px"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">KVKK Metni</div>
        <div class="card-body">
          <div class="form-group"><label>KVKK Aydınlatma Metni</label><textarea id="kvkk-text" rows="12">${escHtml(settings.kvkk_text || '')}</textarea></div>
          <button class="btn btn-primary" id="save-kvkk">Kaydet</button>
          <div id="kvkk-msg" class="form-error" style="margin-top:8px"></div>
        </div>
      </div>
    </div>`;

  $('#save-admin-pw').addEventListener('click', async () => {
    const pw = $('#new-admin-pw').value;
    const pw2 = $('#new-admin-pw2').value;
    if (!pw) { $('#apw-msg').textContent = 'Şifre boş olamaz'; return; }
    if (pw !== pw2) { $('#apw-msg').textContent = 'Şifreler uyuşmuyor'; return; }
    if (pw.length < 6) { $('#apw-msg').textContent = 'En az 6 karakter'; return; }
    try {
      await adminApi('/settings', { method: 'POST', body: JSON.stringify({ key: 'admin_password', value: pw }) });
      const msgBuf = new TextEncoder().encode(pw);
      const hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      adminToken = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('admin_token', adminToken);
      toast('Admin şifresi güncellendi');
      $('#new-admin-pw').value = ''; $('#new-admin-pw2').value = '';
      $('#apw-msg').style.color = '#4ade80'; $('#apw-msg').textContent = 'Güncellendi ✓';
    } catch (e) { $('#apw-msg').textContent = e.message; }
  });

  $('#save-kvkk').addEventListener('click', async () => {
    const text = $('#kvkk-text').value;
    try {
      await adminApi('/settings', { method: 'POST', body: JSON.stringify({ key: 'kvkk_text', value: text }) });
      toast('KVKK metni güncellendi');
      $('#kvkk-msg').style.color = '#4ade80'; $('#kvkk-msg').textContent = 'Kaydedildi ✓';
    } catch (e) { $('#kvkk-msg').textContent = e.message; }
  });
}
